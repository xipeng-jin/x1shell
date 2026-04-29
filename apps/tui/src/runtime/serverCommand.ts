import { access, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { ServerCommandSpec } from "./attach.js";

const execFileAsync = promisify(execFile);

export type ServerCommandResolution = {
  readonly kind: "repo-built" | "repo-source" | "packaged" | "packaged-bundled";
  readonly repoRoot?: string;
  readonly entryPath: string;
  readonly command: ServerCommandSpec;
};

export interface ResolveServerCommandOptions {
  readonly cwd: string;
  readonly explicitEntry?: string;
  readonly preferBuilt?: boolean;
  readonly requireBuilt?: boolean;
  readonly nodeExecutable?: string;
  readonly nodeVersion?: string;
  readonly accessFile?: (filePath: string) => Promise<boolean>;
  readonly readTextFile?: (filePath: string) => Promise<string>;
  readonly readNodeVersion?: (nodeExecutable: string) => Promise<string>;
}

export async function resolveServerCommand(
  options: ResolveServerCommandOptions,
): Promise<ServerCommandResolution> {
  const accessFile = options.accessFile ?? fileExists;
  const nodeExecutable = options.nodeExecutable ?? defaultNodeExecutable();
  const createNodeCommand = (entryPath: string): ServerCommandSpec => ({
    executable: nodeExecutable,
    entryArgs: [entryPath],
  });
  if (options.explicitEntry) {
    if (!path.isAbsolute(options.explicitEntry)) {
      throw new Error("--server-entry must be an absolute path.");
    }
    if (!(await accessFile(options.explicitEntry))) {
      throw new Error(`Configured server entry does not exist: ${options.explicitEntry}`);
    }
    rejectLegacyEntryPath(options.explicitEntry);
    return {
      kind: "packaged",
      entryPath: options.explicitEntry,
      command: createNodeCommand(options.explicitEntry),
    };
  }

  const repoRoot = await findRepoRoot(options.cwd, {
    accessFile,
    readTextFile: options.readTextFile ?? readFileUtf8,
  });
  if (!repoRoot) {
    const packagedEntry = await findPackagedServerEntry({
      start: path.dirname(fileURLToPath(import.meta.url)),
      accessFile,
      readTextFile: options.readTextFile ?? readFileUtf8,
    });
    if (packagedEntry) {
      return {
        kind: "packaged-bundled",
        entryPath: packagedEntry,
        command: createNodeCommand(packagedEntry),
      };
    }

    throw new Error(
      "Could not resolve a t3 server entry from this workspace or packaged TUI. Pass an explicit absolute --server-entry.",
    );
  }

  const builtEntry = path.join(repoRoot, "apps/server/dist/bin.mjs");
  const sourceEntry = path.join(repoRoot, "apps/server/src/bin.ts");
  const builtAvailable = await accessFile(builtEntry);
  const sourceAvailable = await accessFile(sourceEntry);

  if ((options.preferBuilt ?? true) && builtAvailable) {
    return {
      kind: "repo-built",
      repoRoot,
      entryPath: builtEntry,
      command: createNodeCommand(builtEntry),
    };
  }

  if (options.requireBuilt) {
    throw new Error(`Built server CLI entry is required but missing: ${builtEntry}`);
  }
  if (!sourceAvailable) {
    throw new Error(`Source server CLI entry is missing: ${sourceEntry}`);
  }
  const nodeVersion =
    options.nodeVersion ??
    (await (options.readNodeVersion ?? readNodeExecutableVersion)(nodeExecutable));
  if (!supportsNodeSourceEntry(nodeVersion)) {
    throw new Error(
      `Node ${nodeVersion} cannot run the source server entry. Build apps/server first or use Node ^22.16, ^23.11, or >=24.10.`,
    );
  }
  return {
    kind: "repo-source",
    repoRoot,
    entryPath: sourceEntry,
    command: createNodeCommand(sourceEntry),
  };
}

function defaultNodeExecutable(): string {
  return "bun" in process.versions ? "node" : process.execPath;
}

async function readNodeExecutableVersion(nodeExecutable: string): Promise<string> {
  const { stdout } = await execFileAsync(nodeExecutable, ["--version"], { windowsHide: true });
  const version = String(stdout).trim().replace(/^v/, "");
  if (!version) {
    throw new Error(`Could not determine Node version for ${nodeExecutable}.`);
  }
  return version;
}

export function supportsNodeSourceEntry(version: string): boolean {
  const [major = 0, minor = 0] = version.split(".").map((part) => Number.parseInt(part, 10) || 0);
  return (
    (major === 22 && minor >= 16) ||
    (major === 23 && minor >= 11) ||
    major > 24 ||
    (major === 24 && minor >= 10)
  );
}

async function findRepoRoot(
  start: string,
  io: {
    readonly accessFile: (filePath: string) => Promise<boolean>;
    readonly readTextFile: (filePath: string) => Promise<string>;
  },
): Promise<string | null> {
  let current = path.resolve(start);
  while (true) {
    const packagePath = path.join(current, "apps/server/package.json");
    const tuiPackagePath = path.join(current, "apps/tui/package.json");
    if ((await io.accessFile(packagePath)) && (await io.accessFile(tuiPackagePath))) {
      const raw = await io.readTextFile(packagePath);
      const parsed = JSON.parse(raw) as { readonly name?: string; readonly bin?: unknown };
      if (parsed.name === "t3" && parsed.bin && typeof parsed.bin === "object") {
        return current;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function findPackagedServerEntry(input: {
  readonly start: string;
  readonly accessFile: (filePath: string) => Promise<boolean>;
  readonly readTextFile: (filePath: string) => Promise<string>;
}): Promise<string | null> {
  let current = path.resolve(input.start);
  while (true) {
    const packagePath = path.join(current, "package.json");
    if (await input.accessFile(packagePath)) {
      const raw = await input.readTextFile(packagePath);
      const parsed = JSON.parse(raw) as { readonly name?: string };
      if (parsed.name === "@x1shell/tui") {
        const entry = path.join(current, "dist/server/bin.mjs");
        return (await input.accessFile(entry)) ? entry : null;
      }
    }

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function rejectLegacyEntryPath(entryPath: string): void {
  const normalized = entryPath.replaceAll(path.sep, "/");
  if (
    normalized.endsWith("/apps/server/src/index.ts") ||
    normalized.endsWith("/apps/server/dist/index.mjs")
  ) {
    throw new Error(
      "Legacy server entry paths are not supported. Use apps/server/src/bin.ts or apps/server/dist/bin.mjs.",
    );
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function readFileUtf8(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}
