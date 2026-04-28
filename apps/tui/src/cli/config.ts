import os from "node:os";
import { createHash } from "node:crypto";
import path from "node:path";

export interface TuiPaths {
  configDir: string;
  dataDir: string;
  cacheDir: string;
  logDir: string;
  imageCacheDir: string;
  prefsFile: string;
  logFile: string;
  headlessFrameFile: string;
}

export interface CliConfig {
  paths: TuiPaths;
  attach: AttachConfig;
  headless: {
    enabled: boolean;
    width: number;
    height: number;
    settleMs: number;
    framePath: string;
  };
  theme?: string;
  verbose: boolean;
}

export interface AttachConfig {
  readonly mode: "remote" | "local-managed";
  readonly url?: string;
  readonly bearerStdin: boolean;
  readonly credentialStdin: boolean;
  readonly baseDir: string;
  readonly explicitBaseDir: boolean;
  readonly devUrl?: string;
  readonly serverEntry?: string;
  readonly newServer: boolean;
}

export function resolveCliConfig(
  args: readonly string[] = [],
  env: NodeJS.ProcessEnv = process.env,
): CliConfig {
  const paths = resolveTuiPaths(env);
  const headlessEnabled =
    readBoolean(readFlag(args, "--headless") ?? env.X1SHELL_HEADLESS) ?? false;
  const framePath =
    readFlag(args, "--headless-frame") ??
    readEnvString(env.X1SHELL_HEADLESS_FRAME_PATH) ??
    paths.headlessFrameFile;
  const theme = readFlag(args, "--theme") ?? readEnvString(env.X1SHELL_THEME);
  const attachUrl = readFlag(args, "--attach");
  validateAttachArgs(args, attachUrl);
  const cliBaseDir = readFlag(args, "--base-dir");
  const envBaseDir = readEnvString(env.T3CODE_HOME);
  const explicitBaseDir = cliBaseDir ?? envBaseDir;
  const requestedNewServer = hasFlag(args, "--new-server");
  const defaultServerBaseDir = envBaseDir ?? path.join(homeDir(env), ".t3");
  if (requestedNewServer && cliBaseDir && sameResolvedPath(cliBaseDir, defaultServerBaseDir, env)) {
    throw new Error(
      "--new-server requires an isolated --base-dir; the default server state root cannot be reused.",
    );
  }
  const baseDir = requestedNewServer
    ? resolveNewServerBaseDir({
        explicitBaseDir: cliBaseDir,
        cwd: env.PWD ?? process.cwd(),
        dataDir: paths.dataDir,
      })
    : (explicitBaseDir ?? defaultServerBaseDir);
  const devUrl = readFlag(args, "--dev-url");
  const serverEntry = readFlag(args, "--server-entry") ?? readEnvString(env.X1SHELL_SERVER_ENTRY);
  if (serverEntry && !path.isAbsolute(serverEntry)) {
    throw new Error("--server-entry must be an absolute path.");
  }

  return {
    paths,
    attach: {
      mode: attachUrl ? "remote" : "local-managed",
      ...(attachUrl ? { url: attachUrl } : {}),
      bearerStdin: hasFlag(args, "--attach-bearer-stdin"),
      credentialStdin: hasFlag(args, "--attach-credential-stdin"),
      baseDir,
      explicitBaseDir: explicitBaseDir !== undefined,
      ...(devUrl ? { devUrl } : {}),
      ...(serverEntry ? { serverEntry } : {}),
      newServer: requestedNewServer,
    },
    headless: {
      enabled: headlessEnabled,
      width: readPositiveInt(readFlag(args, "--headless-width") ?? env.X1SHELL_HEADLESS_WIDTH, 120),
      height: readPositiveInt(
        readFlag(args, "--headless-height") ?? env.X1SHELL_HEADLESS_HEIGHT,
        36,
      ),
      settleMs: readPositiveInt(
        readFlag(args, "--headless-settle-ms") ?? env.X1SHELL_HEADLESS_SETTLE_MS,
        25,
      ),
      framePath,
    },
    ...(theme === undefined ? {} : { theme }),
    verbose: readBoolean(readFlag(args, "--verbose") ?? env.X1SHELL_VERBOSE) ?? false,
  };
}

function validateAttachArgs(args: readonly string[], attachUrl: string | undefined): void {
  const positional = collectPositionalArgs(args);
  if (positional.length > 0) {
    throw new Error("X1Shell does not accept positional credentials or arguments.");
  }
  if (hasFlag(args, "--attach-bearer-stdin") && hasFlag(args, "--attach-credential-stdin")) {
    throw new Error("Use only one attach credential stdin channel.");
  }
  if (attachUrl) {
    const url = new URL(attachUrl);
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
}

function isSensitiveAttachUrlKey(key: string): boolean {
  return /^(?:ws[-_]?token|token|credential|pairing|bootstrap|auth[-_]?token|session|cookie)$/i.test(
    key,
  );
}

function collectPositionalArgs(args: readonly string[]): string[] {
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    if (arg.includes("=") || isBooleanFlag(arg)) {
      continue;
    }
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      index += 1;
    }
  }
  return positional;
}

function isBooleanFlag(arg: string): boolean {
  return [
    "--headless",
    "--verbose",
    "--attach-bearer-stdin",
    "--attach-credential-stdin",
    "--new-server",
  ].includes(arg);
}

function resolveNewServerBaseDir(input: {
  readonly explicitBaseDir: string | undefined;
  readonly cwd: string;
  readonly dataDir: string;
}): string {
  if (input.explicitBaseDir) return input.explicitBaseDir;
  const resolvedCwd = path.resolve(input.cwd);
  const basename = path.basename(resolvedCwd).replace(/[^A-Za-z0-9._-]+/g, "-") || "workspace";
  const digest = createHash("sha256").update(resolvedCwd).digest("hex").slice(0, 12);
  return path.join(input.dataDir, "servers", `${basename}-${digest}`);
}

function sameResolvedPath(left: string, right: string, env: NodeJS.ProcessEnv): boolean {
  return path.resolve(expandHome(left, env)) === path.resolve(expandHome(right, env));
}

function expandHome(value: string, env: NodeJS.ProcessEnv): string {
  if (value === "~") return homeDir(env);
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(homeDir(env), value.slice(2));
  }
  return value;
}

export function resolveTuiPaths(env: NodeJS.ProcessEnv = process.env): TuiPaths {
  const home = env.HOME || os.homedir();
  const platform = process.platform;
  const configRoot =
    readEnvString(env.X1SHELL_CONFIG_HOME) ??
    readEnvString(env.XDG_CONFIG_HOME) ??
    (platform === "darwin"
      ? path.join(home, "Library", "Application Support")
      : path.join(home, ".config"));
  const dataRoot =
    readEnvString(env.X1SHELL_DATA_HOME) ??
    readEnvString(env.XDG_DATA_HOME) ??
    (platform === "darwin"
      ? path.join(home, "Library", "Application Support")
      : path.join(home, ".local", "share"));
  const cacheRoot =
    readEnvString(env.X1SHELL_CACHE_HOME) ??
    readEnvString(env.XDG_CACHE_HOME) ??
    (platform === "darwin" ? path.join(home, "Library", "Caches") : path.join(home, ".cache"));
  const stateRoot =
    readEnvString(env.X1SHELL_STATE_HOME) ??
    readEnvString(env.XDG_STATE_HOME) ??
    (platform === "darwin"
      ? path.join(home, "Library", "Logs")
      : path.join(home, ".local", "state"));

  const configDir = path.join(configRoot, "x1shell");
  const dataDir = path.join(dataRoot, "x1shell");
  const cacheDir = path.join(cacheRoot, "x1shell");
  const logDir = path.join(stateRoot, "x1shell", "logs");

  return {
    configDir,
    dataDir,
    cacheDir,
    logDir,
    imageCacheDir: path.join(cacheDir, "images"),
    prefsFile: path.join(configDir, "prefs.json"),
    logFile: path.join(logDir, "x1shell-tui.log"),
    headlessFrameFile: path.join(cacheDir, "headless-frame.txt"),
  };
}

function readFlag(args: readonly string[], name: string): string | undefined {
  const equalsPrefix = `${name}=`;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;
    if (arg === name) {
      const next = args[index + 1];
      return next && !next.startsWith("--") ? next : "true";
    }
    if (arg.startsWith(equalsPrefix)) return arg.slice(equalsPrefix.length);
  }
  return undefined;
}

function hasFlag(args: readonly string[], name: string): boolean {
  return args.some((arg) => arg === name || arg.startsWith(`${name}=`));
}

function homeDir(env: NodeJS.ProcessEnv): string {
  return env.HOME || os.homedir();
}

function readBoolean(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readEnvString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
