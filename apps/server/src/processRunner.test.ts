import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Ref from "effect/Ref";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";
import { ChildProcessSpawner } from "effect/unstable/process";

import {
  isWindowsCommandNotFound,
  ProcessOutputLimitError,
  ProcessRunner,
  ProcessTimeoutError,
  layer as ProcessRunnerLive,
  type ProcessRunInput,
} from "./processRunner.ts";

type ChildProcessCommand = {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
};

// Accesses private properties of ChildProcessCommand for testing purposes
function asChildProcessCommand(command: unknown): ChildProcessCommand {
  return command as ChildProcessCommand;
}

function makeHandle(input: {
  readonly stdout?: string | Stream.Stream<Uint8Array>;
  readonly stderr?: string | Stream.Stream<Uint8Array>;
  readonly code?: number;
  readonly stdin?: ChildProcessSpawner.ChildProcessHandle["stdin"];
  readonly exitCode?: Effect.Effect<ChildProcessSpawner.ExitCode>;
  readonly isRunning?: ChildProcessSpawner.ChildProcessHandle["isRunning"];
  readonly kill?: ChildProcessSpawner.ChildProcessHandle["kill"];
}) {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: input.exitCode ?? Effect.succeed(ChildProcessSpawner.ExitCode(input.code ?? 0)),
    isRunning: input.isRunning ?? Effect.succeed(false),
    kill: input.kill ?? (() => Effect.void),
    unref: Effect.succeed(Effect.void),
    stdin: input.stdin ?? Sink.drain,
    stdout:
      typeof input.stdout === "string"
        ? Stream.encodeText(Stream.make(input.stdout))
        : (input.stdout ?? Stream.empty),
    stderr:
      typeof input.stderr === "string"
        ? Stream.encodeText(Stream.make(input.stderr))
        : (input.stderr ?? Stream.empty),
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}

function makeKillTrackedHandle(
  input: Parameters<typeof makeHandle>[0],
  killCalls: Ref.Ref<number>,
) {
  return makeHandle({
    ...input,
    isRunning: input.isRunning ?? Effect.succeed(true),
    kill: () => Ref.update(killCalls, (current) => current + 1),
  });
}

function makeSpawner(
  f: (command: ChildProcessCommand) => Effect.Effect<ChildProcessSpawner.ChildProcessHandle>,
) {
  return ChildProcessSpawner.make((command) => f(asChildProcessCommand(command)));
}

const runWith =
  (spawner: ChildProcessSpawner.ChildProcessSpawner["Service"]) => (input: ProcessRunInput) =>
    Effect.service(ProcessRunner).pipe(
      Effect.flatMap((runner) =>
        runner.run({
          ...input,
          shell: input.shell ?? false,
        }),
      ),
      Effect.provide(
        ProcessRunnerLive.pipe(
          Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)),
        ),
      ),
    );

describe("runProcess", () => {
  it.effect("collects stdout through an injected ChildProcessSpawner", () =>
    Effect.gen(function* () {
      const spawner = makeSpawner((command) =>
        Effect.sync(() => {
          expect(command.command).toBe("fake");
          expect(command.args).toEqual(["stdout-bytes", "32"]);
          return makeHandle({ stdout: "x".repeat(32) });
        }),
      );

      const result = yield* runWith(spawner)({
        command: "fake",
        args: ["stdout-bytes", "32"],
      });

      expect(result.code).toBe(0);
      expect(result.stdout).toBe("x".repeat(32));
      expect(result.timedOut).toBe(false);
    }),
  );

  it.effect("does not kill a normally completed process", () =>
    Effect.gen(function* () {
      const killCalls = yield* Ref.make(0);
      const spawner = makeSpawner(() =>
        Effect.succeed(
          makeKillTrackedHandle(
            {
              stdout: "ok",
              isRunning: Effect.succeed(false),
            },
            killCalls,
          ),
        ),
      );

      const result = yield* runWith(spawner)({
        command: "fake",
        args: ["ok"],
      });

      expect(result.stdout).toBe("ok");
      expect(yield* Ref.get(killCalls)).toBe(0);
    }),
  );

  it.effect("runs through the ProcessRunner service", () => {
    const spawner = makeSpawner((command) =>
      Effect.sync(() => {
        expect(command.command).toBe("fake");
        expect(command.args).toEqual(["--service"]);
        return makeHandle({ stdout: "service ok" });
      }),
    );
    const layer = ProcessRunnerLive.pipe(
      Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)),
    );

    return Effect.gen(function* () {
      const runner = yield* ProcessRunner;
      const result = yield* runner.run({
        command: "fake",
        args: ["--service"],
      });

      expect(result.stdout).toBe("service ok");
    }).pipe(Effect.provide(layer));
  });

  it.effect("fails when output exceeds max buffer in default mode", () =>
    Effect.gen(function* () {
      const spawner = makeSpawner(() => Effect.succeed(makeHandle({ stdout: "x".repeat(2048) })));

      const error = yield* runWith(spawner)({
        command: "fake",
        args: ["stdout-bytes", "2048"],
        maxOutputBytes: 128,
      }).pipe(Effect.flip);

      expect(error).toBeInstanceOf(ProcessOutputLimitError);
    }),
  );

  it.effect("kills the process when output exceeds max buffer in default mode", () =>
    Effect.gen(function* () {
      const killCalls = yield* Ref.make(0);
      const spawner = makeSpawner(() =>
        Effect.succeed(
          makeKillTrackedHandle(
            {
              stdout: "x".repeat(2048),
            },
            killCalls,
          ),
        ),
      );

      const error = yield* runWith(spawner)({
        command: "fake",
        args: ["stdout-bytes", "2048"],
        maxOutputBytes: 128,
      }).pipe(Effect.flip);

      expect(error).toBeInstanceOf(ProcessOutputLimitError);
      expect(yield* Ref.get(killCalls)).toBe(1);
    }),
  );

  it.effect("fails fast on output limit before timeout for long-running output", () =>
    Effect.gen(function* () {
      const textChunk = "x".repeat(64);
      const spawner = makeSpawner(() =>
        Effect.succeed(
          makeHandle({
            stdout: Stream.fromIterable(Array.from({ length: 10 }, () => textChunk)).pipe(
              Stream.encodeText,
            ),
            exitCode: Effect.never,
          }),
        ),
      );

      const error = yield* runWith(spawner)({
        command: "fake",
        args: ["spam-stdout"],
        maxOutputBytes: 128,
        timeout: "2 seconds",
      }).pipe(Effect.flip);

      expect(error).toBeInstanceOf(ProcessOutputLimitError);
    }),
  );

  it.effect("truncates output when outputMode is truncate", () =>
    Effect.gen(function* () {
      const spawner = makeSpawner(() => Effect.succeed(makeHandle({ stdout: "x".repeat(2048) })));

      const result = yield* runWith(spawner)({
        command: "fake",
        args: ["stdout-bytes", "2048"],
        maxOutputBytes: 128,
        outputMode: "truncate",
      });

      expect(result.code).toBe(0);
      expect(result.stdout.length).toBeLessThanOrEqual(128);
      expect(result.stdoutTruncated).toBe(true);
      expect(result.stderrTruncated).toBe(false);
    }),
  );

  it.effect("writes stdin before waiting for exit", () =>
    Effect.gen(function* () {
      const stdinWritten = yield* Deferred.make<void>();
      const decoder = new TextDecoder();
      const spawner = makeSpawner(() =>
        Effect.succeed(
          makeHandle({
            stdout: "stdin payload",
            stdin: Sink.forEach((chunk: Uint8Array) => {
              const text = decoder.decode(chunk, { stream: true });
              return text.includes("stdin payload")
                ? Deferred.succeed(stdinWritten, undefined)
                : Effect.void;
            }),
            exitCode: Deferred.await(stdinWritten).pipe(Effect.as(ChildProcessSpawner.ExitCode(0))),
          }),
        ),
      );

      const result = yield* runWith(spawner)({
        command: "fake",
        args: ["stdin-echo"],
        stdin: "stdin payload",
      });

      expect(result.stdout).toBe("stdin payload");
      expect(result.code).toBe(0);
    }),
  );

  it.effect("returns output for non-zero exit codes", () =>
    Effect.gen(function* () {
      const spawner = makeSpawner(() => Effect.succeed(makeHandle({ stderr: "boom", code: 2 })));

      const result = yield* runWith(spawner)({
        command: "fake",
        args: ["stderr-exit", "boom", "2"],
      });

      expect(result.code).toBe(2);
      expect(result.stderr).toBe("boom");
    }),
  );

  it.effect("fails on timeout", () =>
    Effect.gen(function* () {
      const spawner = makeSpawner(() =>
        Effect.succeed(
          makeHandle({
            exitCode: Effect.never,
          }),
        ),
      );
      const errorFiber = yield* runWith(spawner)({
        command: "fake",
        args: ["sleep"],
        timeout: "50 millis",
      }).pipe(Effect.flip, Effect.forkScoped);

      yield* Effect.yieldNow;
      yield* TestClock.adjust(Duration.millis(50));
      const error = yield* Fiber.join(errorFiber);

      expect(error).toBeInstanceOf(ProcessTimeoutError);
    }),
  );

  it.effect("kills the process when timeoutBehavior is error", () =>
    Effect.gen(function* () {
      const killCalls = yield* Ref.make(0);
      const killOptions = yield* Ref.make<unknown>(null);
      const spawner = makeSpawner(() =>
        Effect.succeed(
          makeHandle({
            exitCode: Effect.never,
            isRunning: Effect.succeed(true),
            kill: (options) =>
              Ref.set(killOptions, options).pipe(
                Effect.andThen(Ref.update(killCalls, (current) => current + 1)),
              ),
          }),
        ),
      );
      const errorFiber = yield* runWith(spawner)({
        command: "fake",
        args: ["sleep"],
        timeout: "50 millis",
      }).pipe(Effect.flip, Effect.forkScoped);

      yield* Effect.yieldNow;
      yield* TestClock.adjust(Duration.millis(50));
      const error = yield* Fiber.join(errorFiber);

      expect(error).toBeInstanceOf(ProcessTimeoutError);
      expect(yield* Ref.get(killCalls)).toBe(1);
      expect(yield* Ref.get(killOptions)).toEqual({ forceKillAfter: "1 second" });
    }),
  );

  it.effect("kills the process when checking whether it is running fails", () =>
    Effect.gen(function* () {
      const killCalls = yield* Ref.make(0);
      const spawner = makeSpawner(() =>
        Effect.succeed(
          makeKillTrackedHandle(
            {
              exitCode: Effect.never,
              isRunning: Effect.fail(
                PlatformError.systemError({
                  _tag: "Unknown",
                  module: "ChildProcess",
                  method: "isRunning",
                  description: "liveness check failed",
                }),
              ),
            },
            killCalls,
          ),
        ),
      );
      const errorFiber = yield* runWith(spawner)({
        command: "fake",
        args: ["sleep"],
        timeout: "50 millis",
      }).pipe(Effect.flip, Effect.forkScoped);

      yield* Effect.yieldNow;
      yield* TestClock.adjust(Duration.millis(50));
      const error = yield* Fiber.join(errorFiber);

      expect(error).toBeInstanceOf(ProcessTimeoutError);
      expect(yield* Ref.get(killCalls)).toBe(1);
    }),
  );

  it.effect("returns a synthetic timed out result when timeoutBehavior is timedOutResult", () =>
    Effect.gen(function* () {
      const spawner = makeSpawner(() =>
        Effect.succeed(
          makeHandle({
            exitCode: Effect.never,
          }),
        ),
      );
      const resultFiber = yield* runWith(spawner)({
        command: "fake",
        args: ["sleep"],
        timeout: "50 millis",
        timeoutBehavior: "timedOutResult",
      }).pipe(Effect.forkScoped);

      yield* Effect.yieldNow;
      yield* TestClock.adjust(Duration.millis(50));
      const result = yield* Fiber.join(resultFiber);

      expect(result).toMatchObject({
        stdout: "",
        stderr: "",
        code: null,
        timedOut: true,
        stdoutTruncated: false,
        stderrTruncated: false,
      });
    }),
  );

  it.effect("kills the process when timeoutBehavior is timedOutResult", () =>
    Effect.gen(function* () {
      const killCalls = yield* Ref.make(0);
      const spawner = makeSpawner(() =>
        Effect.succeed(
          makeKillTrackedHandle(
            {
              exitCode: Effect.never,
            },
            killCalls,
          ),
        ),
      );
      const resultFiber = yield* runWith(spawner)({
        command: "fake",
        args: ["sleep"],
        timeout: "50 millis",
        timeoutBehavior: "timedOutResult",
      }).pipe(Effect.forkScoped);

      yield* Effect.yieldNow;
      yield* TestClock.adjust(Duration.millis(50));
      const result = yield* Fiber.join(resultFiber);

      expect(result.timedOut).toBe(true);
      expect(yield* Ref.get(killCalls)).toBe(1);
    }),
  );

  it.effect("kills the process when the run fiber is interrupted", () =>
    Effect.gen(function* () {
      const killCalls = yield* Ref.make(0);
      const spawner = makeSpawner(() =>
        Effect.succeed(
          makeKillTrackedHandle(
            {
              exitCode: Effect.never,
            },
            killCalls,
          ),
        ),
      );
      const fiber = yield* runWith(spawner)({
        command: "fake",
        args: ["sleep"],
      }).pipe(Effect.forkScoped);

      yield* Effect.yieldNow;
      yield* Fiber.interrupt(fiber);

      expect(yield* Ref.get(killCalls)).toBe(1);
    }),
  );
});

describe("isWindowsCommandNotFound", () => {
  it("matches the localized German cmd.exe error text", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });

    try {
      expect(
        isWindowsCommandNotFound(
          1,
          "wird nicht als interner oder externer Befehl, betriebsfahiges Programm oder Batch-Datei erkannt",
        ),
      ).toBe(true);
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    }
  });
});
