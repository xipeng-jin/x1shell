import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import net from "node:net";
import path from "node:path";
import type { Writable } from "node:stream";
import {
  fetchEnvironmentDescriptor,
  type EnvironmentFetchOptions,
} from "@t3tools/client-runtime/environment";
import type { DesktopBackendBootstrap } from "@t3tools/contracts";
import type { AttachTarget, ServerCommandSpec } from "./attach.js";
import {
  LocalAttachMissError,
  LocalAttachStaleError,
  resolveBootstrapAttachTarget,
  resolveLocalAttachTarget,
} from "./attach.js";
import { boundedFetchOptions } from "./boundedFetch.js";
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
  readonly fetchTimeouts?: Partial<LocalManagedFetchTimeouts>;
}

class BindFailureStartupError extends Error {
  readonly stderr: string;

  constructor(stderr: string) {
    super("Local server failed to bind its loopback port.");
    this.stderr = stderr;
  }
}

interface LocalManagedFetchTimeouts {
  readonly readinessRequestMs: number;
  readonly readinessDeadlineMs: number;
  readonly attachRequestMs: number;
  readonly bootstrapRequestMs: number;
  readonly sessionRequestMs: number;
  readonly wsTokenRequestMs: number;
}

const DEFAULT_FETCH_TIMEOUTS: LocalManagedFetchTimeouts = {
  readinessRequestMs: 1_000,
  readinessDeadlineMs: 15_000,
  attachRequestMs: 5_000,
  bootstrapRequestMs: 5_000,
  sessionRequestMs: 5_000,
  wsTokenRequestMs: 5_000,
};

export async function startLocalManagedSupervisor(
  options: StartLocalManagedSupervisorOptions,
): Promise<LocalManagedSupervisor> {
  const logger = options.logger;
  const fetchTimeouts = resolveFetchTimeouts(options.fetchTimeouts);
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
    const existing = await tryAttachExisting({
      ...options,
      command: commandResolution.command,
      fetchTimeouts,
    });
    if (existing) {
      logger?.info("local attach target ready", { origin: existing.httpBaseUrl });
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
    fetchTimeouts,
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
      void restartOwnedServer({ options, command: commandResolution.command, fetchTimeouts })
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
    readonly fetchTimeouts: LocalManagedFetchTimeouts;
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
  options: StartLocalManagedSupervisorOptions & {
    readonly command: ServerCommandSpec;
    readonly fetchTimeouts: LocalManagedFetchTimeouts;
  },
): Promise<AttachTarget | null> {
  try {
    options.logger?.info("checking existing local server runtime state");
    return await resolveLocalAttachTarget({
      baseDir: options.baseDir,
      ...(options.devUrl ? { devUrl: options.devUrl } : {}),
      serverCommand: options.command,
      ...(options.execFile ? { execFile: options.execFile } : {}),
      ownerSessionCommandTimeoutMs: options.fetchTimeouts.attachRequestMs,
      fetchOptions: boundedFetchOptions({
        options: options.fetchOptions,
        timeoutMs: options.fetchTimeouts.attachRequestMs,
        phase: "local attach validation",
      }),
    });
  } catch (error) {
    if (error instanceof LocalAttachMissError || error instanceof LocalAttachStaleError) {
      options.logger?.warn("local attach-first did not find a reusable server", error.message);
      return null;
    }
    throw error;
  }
}

async function startOwnedServerWithRetries(input: {
  readonly options: StartLocalManagedSupervisorOptions;
  readonly command: ServerCommandSpec;
  readonly fetchTimeouts: LocalManagedFetchTimeouts;
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
  readonly fetchTimeouts: LocalManagedFetchTimeouts;
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
    options.logger?.info("local server descriptor polling started", { origin });
    await waitForEnvironmentDescriptor({
      origin,
      fetchOptions: options.fetchOptions,
      fetchTimeouts: input.fetchTimeouts,
      child,
      stderr: () => stderrChunks.join(""),
    });
    options.logger?.info("local server descriptor ready", { origin });
    options.logger?.info("local server bootstrap exchange started", { origin });
    const target = await resolveBootstrapAttachTarget({
      baseUrl: origin,
      credential: bootstrapToken,
      options: {
        descriptorFetchOptions: boundedFetchOptions({
          options: options.fetchOptions,
          timeoutMs: input.fetchTimeouts.bootstrapRequestMs,
          phase: "local startup descriptor fetch",
        }),
        bootstrapFetchOptions: boundedFetchOptions({
          options: options.fetchOptions,
          timeoutMs: input.fetchTimeouts.bootstrapRequestMs,
          phase: "local owner session creation",
        }),
        sessionFetchOptions: boundedFetchOptions({
          options: options.fetchOptions,
          timeoutMs: input.fetchTimeouts.sessionRequestMs,
          phase: "local connection validation",
        }),
        wsTokenFetchOptions: boundedFetchOptions({
          options: options.fetchOptions,
          timeoutMs: input.fetchTimeouts.wsTokenRequestMs,
          phase: "local websocket access issuance",
        }),
      },
    });
    options.logger?.info("local server bootstrap exchange finished", { origin });
    options.logger?.info("local attach target ready", { origin: target.httpBaseUrl });
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
    noBrowser: true,
    tailscaleServeEnabled: false,
    tailscaleServePort: 443,
    desktopBootstrapToken: input.bootstrapToken,
  } satisfies DesktopBackendBootstrap;
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

async function waitForEnvironmentDescriptor(input: {
  readonly origin: string;
  readonly fetchOptions: EnvironmentFetchOptions | undefined;
  readonly fetchTimeouts: LocalManagedFetchTimeouts;
  readonly child: ChildProcess;
  readonly stderr: () => string;
}): Promise<void> {
  const deadline = Date.now() + input.fetchTimeouts.readinessDeadlineMs;
  let lastError: unknown;
  let exited: {
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
  } | null = null;
  input.child.once("exit", (code, signal) => {
    exited = { code, signal };
  });
  while (Date.now() < deadline) {
    if (exited === null && (input.child.exitCode !== null || input.child.signalCode !== null)) {
      exited = { code: input.child.exitCode, signal: input.child.signalCode };
    }
    if (exited !== null) {
      const exit = exited as {
        readonly code: number | null;
        readonly signal: NodeJS.Signals | null;
      };
      const capturedStderr = input.stderr();
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
        httpBaseUrl: input.origin,
        options: boundedFetchOptions({
          options: input.fetchOptions,
          timeoutMs: input.fetchTimeouts.readinessRequestMs,
          phase: "local readiness descriptor fetch",
        }),
      });
      return;
    } catch (error) {
      lastError = error;
      await wait(100);
    }
  }
  throw new Error(`Local server did not become ready: ${safeOutputUnknown(lastError)}`);
}

function resolveFetchTimeouts(
  overrides: Partial<LocalManagedFetchTimeouts> | undefined,
): LocalManagedFetchTimeouts {
  return { ...DEFAULT_FETCH_TIMEOUTS, ...overrides };
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
