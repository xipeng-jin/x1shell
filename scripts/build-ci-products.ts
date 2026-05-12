import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { ChildProcess } from "effect/unstable/process";

const args = [
  "turbo",
  "run",
  "build",
  "--filter=@t3tools/web",
  "--filter=@t3tools/marketing",
  "--filter=t3",
  "--filter=@t3tools/desktop",
  "--filter=@x1shell/tui",
];

class BuildCiProductsError extends Data.TaggedError("BuildCiProductsError")<{
  readonly message: string;
}> {}

const program = Effect.gen(function* () {
  const child = yield* ChildProcess.make("bun", args, {
    env: {
      ...process.env,
      ASTRO_TELEMETRY_DISABLED: "1",
      TELEMETRY_DISABLED: "1",
    },
    extendEnv: false,
    shell: process.platform === "win32",
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = yield* child.exitCode;
  if (exitCode !== 0) {
    return yield* new BuildCiProductsError({
      message: `CI product build exited with code ${exitCode}`,
    });
  }
});

if (import.meta.main) {
  program.pipe(Effect.scoped, Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}
