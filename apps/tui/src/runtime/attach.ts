import { execFile, type ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { ExecutionEnvironmentDescriptor } from "@t3tools/contracts";
import {
  bootstrapBearerSession,
  fetchEnvironmentDescriptor,
  fetchSessionState,
  resolveAuthenticatedWebSocketUrl,
  type EnvironmentFetchOptions,
} from "@t3tools/client-runtime/environment";
import type { WsRpcProtocolSocketUrlProvider } from "@t3tools/client-runtime/ws";
import { BoundedFetchTimeoutError } from "./boundedFetch.js";
import { redactText, redactUnknown } from "./redaction.js";

const MIN_COMPATIBLE_VERSION = "0.0.21";

export interface AttachTarget {
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
  readonly bearerToken: string;
  readonly descriptor: ExecutionEnvironmentDescriptor;
  readonly sessionRole?: string;
  readonly webSocketUrlProvider: WsRpcProtocolSocketUrlProvider;
}

export interface AttachRuntimeOptions {
  readonly fetchOptions?: EnvironmentFetchOptions;
  readonly descriptorFetchOptions?: EnvironmentFetchOptions;
  readonly bootstrapFetchOptions?: EnvironmentFetchOptions;
  readonly sessionFetchOptions?: EnvironmentFetchOptions;
  readonly wsTokenFetchOptions?: EnvironmentFetchOptions;
}

export interface LocalAttachOptions extends AttachRuntimeOptions {
  readonly baseDir: string;
  readonly devUrl?: string;
  readonly serverEntry?: string;
  readonly serverCommand?: ServerCommandSpec;
  readonly execFile?: typeof execFile;
  readonly ownerSessionCommandTimeoutMs?: number;
}

export interface ServerCommandSpec {
  readonly executable: string;
  readonly entryArgs: readonly string[];
}

export interface ServerStatePaths {
  readonly stateDir: string;
  readonly environmentIdPath: string;
  readonly runtimeStatePath: string;
}

export interface PersistedRuntimeState {
  readonly version: 1;
  readonly pid: number;
  readonly host?: string;
  readonly port: number;
  readonly origin: string;
  readonly startedAt: string;
}

export class LocalAttachMissError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalAttachMissError";
  }
}

export class LocalAttachStaleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalAttachStaleError";
  }
}

export class LocalAttachIncompatibleError extends Error {
  constructor(message = "Attached server is not compatible with this X1Shell TUI.") {
    super(message);
    this.name = "LocalAttachIncompatibleError";
  }
}

class LocalOwnerSessionTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Local owner session command timed out after ${timeoutMs}ms.`);
    this.name = "LocalOwnerSessionTimeoutError";
  }
}

export function normalizeAttachBaseUrl(baseUrl: string | URL): {
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
} {
  const url = new URL(baseUrl);
  assertSafeAttachUrl(url);
  url.search = "";
  url.hash = "";
  if (url.protocol === "ws:" || url.protocol === "wss:") {
    const http = new URL(url);
    http.protocol = url.protocol === "wss:" ? "https:" : "http:";
    return { httpBaseUrl: http.toString(), wsBaseUrl: url.toString() };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported attach URL protocol: ${url.protocol}`);
  }
  const ws = new URL(url);
  ws.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return { httpBaseUrl: url.toString(), wsBaseUrl: ws.toString() };
}

export async function resolveBearerAttachTarget(input: {
  readonly baseUrl: string | URL;
  readonly bearerToken: string;
  readonly options?: AttachRuntimeOptions;
}): Promise<AttachTarget> {
  const urls = normalizeAttachBaseUrl(input.baseUrl);
  const descriptor = await fetchEnvironmentDescriptor({
    httpBaseUrl: urls.httpBaseUrl,
    ...optionalOptions(fetchOptionsFor(input.options, "descriptor")),
  });
  assertCompatibleDescriptor(descriptor);
  const session = await fetchSessionState({
    httpBaseUrl: urls.httpBaseUrl,
    bearerToken: input.bearerToken,
    ...optionalOptions(fetchOptionsFor(input.options, "session")),
  });
  if (!session.authenticated) {
    throw new Error("Attach bearer session is not authenticated.");
  }
  return makeAttachTarget({
    ...urls,
    bearerToken: input.bearerToken,
    descriptor,
    ...(session.role ? { sessionRole: session.role } : {}),
    ...optionalFetchOptions(fetchOptionsFor(input.options, "ws-token")),
  });
}

function assertSafeAttachUrl(url: URL): void {
  if (url.username || url.password) {
    throw new Error("Attach URLs must not contain embedded credentials.");
  }
  for (const key of url.searchParams.keys()) {
    if (isSensitiveAttachUrlKey(key)) {
      throw new Error(`Attach URLs must not contain credential parameter '${key}'.`);
    }
  }
  const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  for (const key of hashParams.keys()) {
    if (isSensitiveAttachUrlKey(key)) {
      throw new Error(`Attach URLs must not contain credential fragment '${key}'.`);
    }
  }
}

function isSensitiveAttachUrlKey(key: string): boolean {
  return /^(?:ws[-_]?token|token|credential|pairing|bootstrap|auth[-_]?token|session|cookie)$/i.test(
    key,
  );
}

export async function resolveBootstrapAttachTarget(input: {
  readonly baseUrl: string | URL;
  readonly credential: string;
  readonly options?: AttachRuntimeOptions;
}): Promise<AttachTarget> {
  const urls = normalizeAttachBaseUrl(input.baseUrl);
  const descriptor = await fetchEnvironmentDescriptor({
    httpBaseUrl: urls.httpBaseUrl,
    ...optionalOptions(fetchOptionsFor(input.options, "descriptor")),
  });
  assertCompatibleDescriptor(descriptor);
  const bootstrap = await bootstrapBearerSession({
    httpBaseUrl: urls.httpBaseUrl,
    credential: input.credential,
    ...optionalOptions(fetchOptionsFor(input.options, "bootstrap")),
  });
  return resolveBearerAttachTarget({
    baseUrl: urls.httpBaseUrl,
    bearerToken: bootstrap.sessionToken,
    ...(input.options ? { options: input.options } : {}),
  });
}

export function deriveLocalServerStatePaths(input: {
  readonly baseDir: string;
  readonly devUrl?: string;
}): ServerStatePaths {
  const stateDir = path.join(input.baseDir, input.devUrl ? "dev" : "userdata");
  return {
    stateDir,
    environmentIdPath: path.join(stateDir, "environment-id"),
    runtimeStatePath: path.join(stateDir, "server-runtime.json"),
  };
}

export async function resolveLocalAttachTarget(input: LocalAttachOptions): Promise<AttachTarget> {
  const paths = deriveLocalServerStatePaths(input);
  if (!(await fileIsReadable(paths.environmentIdPath))) {
    throw new LocalAttachMissError(
      "No local environment-id was found for the intended state root.",
    );
  }
  let localEnvironmentId: string;
  try {
    localEnvironmentId = await readRequiredTrimmedFile(paths.environmentIdPath);
  } catch (error) {
    throw new LocalAttachMissError(error instanceof Error ? error.message : String(error));
  }
  const runtimeState = await readRuntimeState(paths.runtimeStatePath);
  if (!runtimeState) {
    throw new LocalAttachMissError(
      "No local server runtime state was found for the intended state root.",
    );
  }

  const staleReason = await validateRuntimeState({
    runtimeState,
    localEnvironmentId,
    ...optionalFetchOptions(input.fetchOptions),
  });
  if (staleReason) {
    if (staleReason === "environment descriptor is not compatible") {
      throw new LocalAttachIncompatibleError();
    }
    await compareBeforeDeleteRuntimeState(paths.runtimeStatePath, runtimeState);
    throw new LocalAttachStaleError(
      `Local server runtime state is stale: ${redactText(staleReason)}.`,
    );
  }

  try {
    const bearerToken = await issueLocalOwnerBearerSession(input);
    const target = await resolveBearerAttachTarget({
      baseUrl: runtimeState.origin,
      bearerToken,
      ...(input.fetchOptions ? { options: { fetchOptions: input.fetchOptions } } : {}),
    });
    await resolveAttachTargetWebSocketUrl(target);
    return target;
  } catch (error) {
    if (isRecoverableLocalAttachTimeout(error)) {
      throw new LocalAttachStaleError(
        `Local server runtime state is stale: ${redactUnknown(error)}.`,
      );
    }
    throw error;
  }
}

export async function validateRuntimeState(input: {
  readonly runtimeState: PersistedRuntimeState;
  readonly localEnvironmentId: string;
  readonly fetchOptions?: EnvironmentFetchOptions;
}): Promise<string | null> {
  const originValidationError = validateLocalRuntimeOrigin(input.runtimeState);
  if (originValidationError) {
    return originValidationError;
  }
  if (!isPidLive(input.runtimeState.pid)) {
    return "server pid is not live";
  }
  let descriptor: ExecutionEnvironmentDescriptor;
  try {
    descriptor = await fetchEnvironmentDescriptor({
      httpBaseUrl: input.runtimeState.origin,
      ...optionalOptions(input.fetchOptions),
    });
  } catch (error) {
    return redactUnknown(error);
  }
  if (descriptor.environmentId !== input.localEnvironmentId) {
    return "environment descriptor does not match local environment-id";
  }
  if (!isCompatibleDescriptor(descriptor)) {
    return "environment descriptor is not compatible";
  }
  return null;
}

function validateLocalRuntimeOrigin(runtimeState: PersistedRuntimeState): string | null {
  let origin: URL;
  try {
    origin = new URL(runtimeState.origin);
  } catch {
    return "server origin is not a valid URL";
  }

  if (origin.protocol !== "http:" && origin.protocol !== "https:") {
    return "server origin uses an unsupported protocol";
  }
  if (!isLocalHost(origin.hostname)) {
    return "server origin is not local";
  }
  if (origin.username || origin.password || origin.search || origin.hash) {
    return "server origin contains unsupported credential or query data";
  }

  const originPort = Number.parseInt(origin.port || defaultPortForProtocol(origin.protocol), 10);
  if (!Number.isInteger(runtimeState.port) || runtimeState.port <= 0) {
    return "server port is invalid";
  }
  if (originPort !== runtimeState.port) {
    return "server origin port does not match runtime state port";
  }
  if (runtimeState.host && normalizeHost(runtimeState.host) !== normalizeHost(origin.hostname)) {
    return "server origin host does not match runtime state host";
  }
  return null;
}

function isLocalHost(hostname: string): boolean {
  const normalized = normalizeHost(hostname);
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function normalizeHost(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
}

function defaultPortForProtocol(protocol: string): string {
  return protocol === "https:" ? "443" : "80";
}

export async function compareBeforeDeleteRuntimeState(
  runtimeStatePath: string,
  staleState: PersistedRuntimeState,
): Promise<boolean> {
  const current = await readRuntimeState(runtimeStatePath);
  if (!current || JSON.stringify(current) !== JSON.stringify(staleState)) {
    return false;
  }
  await rm(runtimeStatePath, { force: true });
  return true;
}

export async function issueLocalOwnerBearerSession(input: LocalAttachOptions): Promise<string> {
  const command = resolveServerCommand(input);
  const args = [
    ...command.entryArgs,
    "auth",
    "session",
    "issue",
    "--token-only",
    "--role",
    "owner",
    "--base-dir",
    input.baseDir,
    ...(input.devUrl ? ["--dev-url", input.devUrl] : []),
  ];
  const { stdout } = await runLocalOwnerBearerSessionCommand({
    command,
    args,
    ...(input.execFile ? { execFile: input.execFile } : {}),
    ...(input.ownerSessionCommandTimeoutMs
      ? { timeoutMs: input.ownerSessionCommandTimeoutMs }
      : {}),
  });
  const token = String(stdout).trim();
  if (!token) {
    throw new Error("Local owner session command did not return a bearer token.");
  }
  return token;
}

function runLocalOwnerBearerSessionCommand(input: {
  readonly command: ServerCommandSpec;
  readonly args: readonly string[];
  readonly execFile?: typeof execFile;
  readonly timeoutMs?: number;
}): Promise<{ stdout: string | Buffer }> {
  return new Promise<{ stdout: string | Buffer }>((resolve, reject) => {
    let settled = false;
    let child: ChildProcess | undefined;
    const timeoutMs = input.timeoutMs;
    const timer = timeoutMs
      ? setTimeout(() => {
          if (settled) return;
          settled = true;
          child?.kill();
          reject(new LocalOwnerSessionTimeoutError(timeoutMs));
        }, timeoutMs)
      : undefined;
    timer?.unref();

    try {
      child = (input.execFile ?? execFile)(
        input.command.executable,
        input.args,
        { windowsHide: true },
        (error, stdout) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          if (error) {
            reject(sanitizeLocalAuthCommandError(error));
            return;
          }
          resolve({ stdout });
        },
      );
    } catch (error) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(sanitizeLocalAuthCommandError(error));
    }
  });
}

function isRecoverableLocalAttachTimeout(error: unknown): boolean {
  return (
    error instanceof BoundedFetchTimeoutError ||
    error instanceof LocalOwnerSessionTimeoutError ||
    hasBoundedFetchTimeoutCause(error)
  );
}

function resolveAttachTargetWebSocketUrl(
  target: AttachTarget,
): Promise<string | URL> | string | URL {
  return typeof target.webSocketUrlProvider === "function"
    ? target.webSocketUrlProvider()
    : target.webSocketUrlProvider;
}

function hasBoundedFetchTimeoutCause(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "BoundedFetchTimeoutError") return true;
  if (error.message.includes("BoundedFetchTimeoutError:")) return true;
  return hasBoundedFetchTimeoutCause(error.cause);
}

function resolveServerCommand(input: LocalAttachOptions): ServerCommandSpec {
  if (input.serverCommand) return input.serverCommand;
  if (input.serverEntry) return { executable: input.serverEntry, entryArgs: [] };
  throw new Error("A deterministic server command is required for local owner auth.");
}

function sanitizeLocalAuthCommandError(error: unknown): Error {
  const message =
    error instanceof Error && error.message.trim().length > 0
      ? error.message
      : "Local owner session command failed.";
  return new Error(`Local owner session command failed: ${redactText(message)}`);
}

function makeAttachTarget(input: {
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
  readonly bearerToken: string;
  readonly descriptor: ExecutionEnvironmentDescriptor;
  readonly sessionRole?: string;
  readonly fetchOptions?: EnvironmentFetchOptions;
}): AttachTarget {
  return {
    httpBaseUrl: input.httpBaseUrl,
    wsBaseUrl: input.wsBaseUrl,
    bearerToken: input.bearerToken,
    descriptor: input.descriptor,
    ...(input.sessionRole ? { sessionRole: input.sessionRole } : {}),
    webSocketUrlProvider: () =>
      resolveAuthenticatedWebSocketUrl({
        httpBaseUrl: input.httpBaseUrl,
        wsBaseUrl: input.wsBaseUrl,
        bearerToken: input.bearerToken,
        ...optionalOptions(input.fetchOptions),
      }),
  };
}

function optionalOptions(options: EnvironmentFetchOptions | undefined): {
  readonly options?: EnvironmentFetchOptions;
} {
  return options ? { options } : {};
}

function optionalFetchOptions(fetchOptions: EnvironmentFetchOptions | undefined): {
  readonly fetchOptions?: EnvironmentFetchOptions;
} {
  return fetchOptions ? { fetchOptions } : {};
}

function fetchOptionsFor(
  options: AttachRuntimeOptions | undefined,
  phase: "descriptor" | "bootstrap" | "session" | "ws-token",
): EnvironmentFetchOptions | undefined {
  if (!options) return undefined;
  switch (phase) {
    case "descriptor":
      return options.descriptorFetchOptions ?? options.fetchOptions;
    case "bootstrap":
      return options.bootstrapFetchOptions ?? options.fetchOptions;
    case "session":
      return options.sessionFetchOptions ?? options.fetchOptions;
    case "ws-token":
      return options.wsTokenFetchOptions ?? options.fetchOptions;
  }
}

async function readRequiredTrimmedFile(filePath: string): Promise<string> {
  const value = (await readFile(filePath, "utf8")).trim();
  if (!value) {
    throw new Error(`Required local server file is empty: ${filePath}`);
  }
  return value;
}

async function readRuntimeState(filePath: string): Promise<PersistedRuntimeState | null> {
  try {
    const raw = (await readFile(filePath, "utf8")).trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedRuntimeState;
    if (
      parsed.version !== 1 ||
      typeof parsed.pid !== "number" ||
      typeof parsed.port !== "number" ||
      typeof parsed.origin !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isPidLive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function assertCompatibleDescriptor(descriptor: ExecutionEnvironmentDescriptor): void {
  if (!isCompatibleDescriptor(descriptor)) {
    throw new LocalAttachIncompatibleError();
  }
}

export function isCompatibleDescriptor(descriptor: ExecutionEnvironmentDescriptor): boolean {
  return (
    descriptor.capabilities.repositoryIdentity === true &&
    compareSemver(descriptor.serverVersion, MIN_COMPATIBLE_VERSION) >= 0
  );
}

function compareSemver(left: string, right: string): number {
  const a = normalizeSemver(left);
  const b = normalizeSemver(right);
  for (let index = 0; index < 3; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function normalizeSemver(value: string): number[] {
  return value
    .replace(/^v/, "")
    .split(/[.-]/)
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0);
}

export async function fileIsReadable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
