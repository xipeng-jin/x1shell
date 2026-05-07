import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import net from "node:net";
import path from "node:path";
import type { Writable } from "node:stream";
import {
  fetchEnvironmentDescriptor,
  type EnvironmentFetchOptions,
} from "@t3tools/client-runtime/environment";
import type { AttachTarget, ServerCommandSpec } from "./attach.js";
import { resolveBootstrapAttachTarget, resolveLocalAttachTarget } from "./attach.js";
import type { Logger } from "./log.js";
import { safeOutputUnknown } from "./log.js";
import { resolveServerCommand, type ServerCommandResolution } from "./serverCommand.js";
import { redactText } from "./redaction.js";

export type LocalServerExitClassification =
  | "requested"
  | "restartable"
  | "auth-failure"
  | "bind-failure"
  | "fatal-startup-error";

export interface LocalManagedSupervisor {
  readonly target: AttachTarget;
  readonly owned: boolean;
  readonly commandResolution: ServerCommandResolution;
  readonly child: ChildProcess | null;
  readonly stop: () => Promise<void>;
  readonly onRestarted: (listener: (target: AttachTarget) => void | Promise<void>) => () => void;
  readonly classifyExit: (exit: {
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
    readonly stderr?: string;
  }) => LocalServerExitClassification;
}

export interface StartLocalManagedSupervisorOptions {
  readonly baseDir: string;
  readonly devUrl?: string;
  readonly serverEntry?: string;
  readonly newServer?: boolean;
  readonly cwd?: string;
  readonly logger?: Logger;
  readonly fetchOptions?: EnvironmentFetchOptions;
  readonly spawnProcess?: typeof spawn;
  readonly execFile?: typeof execFile;
  readonly resolvePort?: () => Promise<number>;
  readonly maxBindRetries?: number;
}

class BindFailureStartupError extends Error {
  readonly stderr: string;

  constructor(stderr: string) {
    super("Local server failed to bind its loopback port.");
    this.stderr = stderr;
  }
}

export async function startLocalManagedSupervisor(
  options: StartLocalManagedSupervisorOptions,
): Promise<LocalManagedSupervisor> {
  const logger = options.logger;
  const commandResolution = await resolveServerCommand({
    cwd: options.cwd ?? process.cwd(),
    ...(options.serverEntry ? { explicitEntry: options.serverEntry } : {}),
  });
  logger?.info("resolved local server command", {
    kind: commandResolution.kind,
    executable: commandResolution.command.executable,
    entryArgs: commandResolution.command.entryArgs,
  });

  if (!options.newServer) {
    const existing = await tryAttachExisting({ ...options, command: commandResolution.command });
    if (existing) {
      logger?.info("attached to existing local server", { origin: existing.httpBaseUrl });
      return {
        target: existing,
        owned: false,
        commandResolution,
        child: null,
        stop: async () => {},
        onRestarted: () => () => {},
        classifyExit,
      };
    }
  }

  let stopped = false;
  let restarting = false;
  let current = await startOwnedServerWithRetries({
    options,
    command: commandResolution.command,
  });
  const restartListeners = new Set<(target: AttachTarget) => void | Promise<void>>();

  const supervisorTarget: AttachTarget = {
    ...current.target,
    webSocketUrlProvider: async () => await resolveTargetWebSocketUrl(current.target),
  };

  const attachExitListener = (child: ChildProcess) => {
    child.once("exit", (code, signal) => {
      if (stopped) return;
      const classification = classifyExit({
        code,
        signal,
        stderr: current.stderr(),
      });
      if (classification !== "restartable" && classification !== "bind-failure") {
        logger?.warn("local server exited without restart", { classification });
        return;
      }
      if (restarting) return;
      restarting = true;
      void restartOwnedServer({ options, command: commandResolution.command })
        .catch((error) => {
          logger?.error("local server restart failed", safeOutputUnknown(error));
        })
        .finally(() => {
          restarting = false;
        });
    });
  };

  const restartOwnedServer = async (input: {
    readonly options: StartLocalManagedSupervisorOptions;
    readonly command: ServerCommandSpec;
  }) => {
    logger?.warn("local server exited; restarting from authoritative snapshots");
    const next = await startOwnedServerWithRetries(input);
    current = next;
    Object.assign(supervisorTarget, {
      httpBaseUrl: next.target.httpBaseUrl,
      wsBaseUrl: next.target.wsBaseUrl,
      bearerToken: next.target.bearerToken,
      descriptor: next.target.descriptor,
      sessionRole: next.target.sessionRole,
    });
    attachExitListener(next.child);
    for (const listener of restartListeners) {
      await listener(supervisorTarget);
    }
  };

  attachExitListener(current.child);

  return {
    target: supervisorTarget,
    owned: true,
    commandResolution,
    get child() {
      return current.child;
    },
    stop: async () => {
      stopped = true;
      await stopChild(current.child);
    },
    onRestarted: (listener) => {
      restartListeners.add(listener);
      return () => {
        restartListeners.delete(listener);
      };
    },
    classifyExit,
  };
}

async function tryAttachExisting(
  options: StartLocalManagedSupervisorOptions & { readonly command: ServerCommandSpec },
): Promise<AttachTarget | null> {
  try {
    return await resolveLocalAttachTarget({
      baseDir: options.baseDir,
      ...(options.devUrl ? { devUrl: options.devUrl } : {}),
      serverCommand: options.command,
      ...(options.execFile ? { execFile: options.execFile } : {}),
      ...(options.fetchOptions ? { fetchOptions: options.fetchOptions } : {}),
    });
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    if (isAttachMissOrStale(message)) {
      options.logger?.warn("local attach-first did not find a reusable server", message);
      return null;
    }
    throw error;
  }
}

function isAttachMissOrStale(message: string): boolean {
  return (
    /No local environment-id/.test(message) ||
    /No local server runtime state/.test(message) ||
    /runtime state is stale/.test(message) ||
    /Required local server file/.test(message)
  );
}

async function startOwnedServerWithRetries(input: {
  readonly options: StartLocalManagedSupervisorOptions;
  readonly command: ServerCommandSpec;
}): Promise<{
  readonly child: ChildProcess;
  readonly target: AttachTarget;
  readonly stderr: () => string;
}> {
  const attempts = (input.options.maxBindRetries ?? 2) + 1;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await startOwnedServerAttempt(input);
    } catch (error) {
      lastError = error;
      if (!(error instanceof BindFailureStartupError) || attempt === attempts - 1) {
        throw error;
      }
      input.options.logger?.warn("local server bind failed; retrying with a fresh port", {
        attempt: attempt + 1,
        detail: redactText(error.stderr),
      });
    }
  }
  throw lastError;
}

async function startOwnedServerAttempt(input: {
  readonly options: StartLocalManagedSupervisorOptions;
  readonly command: ServerCommandSpec;
}): Promise<{
  readonly child: ChildProcess;
  readonly target: AttachTarget;
  readonly stderr: () => string;
}> {
  const options = input.options;
  const port = await (options.resolvePort ?? findAvailableLoopbackPort)();
  const bootstrapToken = randomUUID();
  const origin = `http://127.0.0.1:${port}`;
  const stderrChunks: string[] = [];
  const child = spawnOwnedServer({
    command: input.command,
    port,
    baseDir: options.baseDir,
    ...(options.devUrl ? { devUrl: options.devUrl } : {}),
    bootstrapToken,
    cwd: options.cwd ?? process.cwd(),
    ...(options.logger ? { logger: options.logger } : {}),
    stderrChunks,
    spawnProcess: options.spawnProcess ?? spawn,
  });

  try {
    await waitForEnvironmentDescriptor(origin, options.fetchOptions, child, () =>
      stderrChunks.join(""),
    );
    const target = await resolveBootstrapAttachTarget({
      baseUrl: origin,
      credential: bootstrapToken,
      ...(options.fetchOptions ? { options: { fetchOptions: options.fetchOptions } } : {}),
    });
    return {
      child,
      target,
      stderr: () => stderrChunks.join(""),
    };
  } catch (error) {
    await stopChild(child);
    throw error;
  }
}

function spawnOwnedServer(input: {
  readonly command: ServerCommandSpec;
  readonly port: number;
  readonly baseDir: string;
  readonly devUrl?: string;
  readonly bootstrapToken: string;
  readonly cwd: string;
  readonly logger?: Logger;
  readonly stderrChunks?: string[];
  readonly spawnProcess: typeof spawn;
}): ChildProcess {
  const args = [
    ...input.command.entryArgs,
    "start",
    "--mode",
    "desktop",
    "--host",
    "127.0.0.1",
    "--port",
    String(input.port),
    "--base-dir",
    input.baseDir,
    "--no-browser",
    "--auto-bootstrap-project-from-cwd",
    "--bootstrap-fd",
    "3",
    ...(input.devUrl ? ["--dev-url", input.devUrl] : []),
  ];
  assertNoLegacySpawnFlags(args);
  input.logger?.info("spawning local server", {
    executable: input.command.executable,
    argv: args,
    cwd: input.cwd,
  });
  const child = input.spawnProcess(input.command.executable, args, {
    cwd: input.cwd,
    stdio: ["ignore", "pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const bootstrapPipe = child.stdio[3] as Writable | null | undefined;
  if (!bootstrapPipe || typeof bootstrapPipe.write !== "function") {
    child.kill();
    throw new Error("Failed to create bootstrap fd 3 pipe for local server.");
  }
  const envelope = {
    mode: "desktop",
    host: "127.0.0.1",
    port: input.port,
    t3Home: input.baseDir,
    ...(input.devUrl ? { devUrl: input.devUrl } : {}),
    noBrowser: true,
    autoBootstrapProjectFromCwd: true,
    desktopBootstrapToken: input.bootstrapToken,
  };
  bootstrapPipe.end(`${JSON.stringify(envelope)}\n`);
  child.stdout?.on("data", (chunk) => {
    input.logger?.info("local server stdout", redactText(String(chunk)));
  });
  child.stderr?.on("data", (chunk) => {
    const text = String(chunk);
    input.stderrChunks?.push(text);
    input.logger?.warn("local server stderr", redactText(text));
  });
  return child;
}

export function assertNoLegacySpawnFlags(args: readonly string[]): void {
  const joined = ` ${args.join(" ")} `;
  for (const forbidden of [" serve ", " --mode tui ", " --auth-token ", " --home-dir "]) {
    if (joined.includes(forbidden)) {
      throw new Error(`Forbidden legacy server spawn flag detected: ${forbidden.trim()}`);
    }
  }
}

async function waitForEnvironmentDescriptor(
  origin: string,
  fetchOptions: EnvironmentFetchOptions | undefined,
  child: ChildProcess,
  stderr: () => string,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  let lastError: unknown;
  let exited: {
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
  } | null = null;
  child.once("exit", (code, signal) => {
    exited = { code, signal };
  });
  while (Date.now() < deadline) {
    if (exited === null && (child.exitCode !== null || child.signalCode !== null)) {
      exited = { code: child.exitCode, signal: child.signalCode };
    }
    if (exited !== null) {
      const exit = exited as {
        readonly code: number | null;
        readonly signal: NodeJS.Signals | null;
      };
      const capturedStderr = stderr();
      if (
        classifyExit({
          code: exit.code,
          signal: exit.signal,
          stderr: capturedStderr,
        }) === "bind-failure"
      ) {
        throw new BindFailureStartupError(capturedStderr);
      }
      throw new Error(
        `Local server exited before readiness: ${classifyExit({
          code: exit.code,
          signal: exit.signal,
          stderr: capturedStderr,
        })}`,
      );
    }
    try {
      await fetchEnvironmentDescriptor({
        httpBaseUrl: origin,
        ...(fetchOptions ? { options: fetchOptions } : {}),
      });
      return;
    } catch (error) {
      lastError = error;
      await wait(100);
    }
  }
  throw new Error(`Local server did not become ready: ${safeOutputUnknown(lastError)}`);
}

function resolveTargetWebSocketUrl(target: AttachTarget): Promise<string | URL> | string | URL {
  return typeof target.webSocketUrlProvider === "function"
    ? target.webSocketUrlProvider()
    : target.webSocketUrlProvider;
}

function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 2_000);
    timer.unref();
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

export function classifyExit(input: {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderr?: string;
}): LocalServerExitClassification {
  if (input.signal === "SIGTERM" || input.signal === "SIGINT") return "requested";
  const stderr = input.stderr ?? "";
  if (/EADDRINUSE|address already in use|listen .* in use/i.test(stderr)) return "bind-failure";
  if (/bootstrap|auth|credential|token/i.test(stderr)) return "auth-failure";
  if (input.code === 0) return "requested";
  if (input.code === null || input.code === 1) return "fatal-startup-error";
  return "restartable";
}

async function findAvailableLoopbackPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function localStateRootForDebug(baseDir: string, devUrl?: string): string {
  return path.join(baseDir, devUrl ? "dev" : "userdata");
}
