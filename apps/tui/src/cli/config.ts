import os from "node:os";
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

  return {
    paths,
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
