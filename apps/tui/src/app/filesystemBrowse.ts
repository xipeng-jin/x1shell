import type {
  ExecutionEnvironmentPlatformOs,
  FilesystemBrowseEntry,
  FilesystemBrowseInput,
} from "@t3tools/contracts";
import {
  isExplicitRelativeProjectPath,
  isFilesystemBrowseQuery,
} from "@t3tools/shared/projectPaths";

export const RELATIVE_BROWSE_REQUIRES_PROJECT_MESSAGE =
  "Relative filesystem browse paths require a current project.";

export function browsePlatformFromEnvironmentOs(
  os: ExecutionEnvironmentPlatformOs | null | undefined,
): string {
  if (os === "windows") return "Win32";
  if (os === "darwin") return "MacIntel";
  if (os === "linux") return "Linux";
  return "";
}

export function buildTuiFilesystemBrowseRequest(input: {
  readonly query: string;
  readonly platform: string;
  readonly activeProjectWorkspaceRoot?: string | null;
}):
  | {
      readonly kind: "browse";
      readonly request: FilesystemBrowseInput;
    }
  | {
      readonly kind: "error";
      readonly message: string;
    }
  | {
      readonly kind: "skip";
    } {
  const query = input.query.trim();
  if (!isFilesystemBrowseQuery(query, input.platform)) return { kind: "skip" };

  if (isExplicitRelativeProjectPath(query) && !input.activeProjectWorkspaceRoot) {
    return {
      kind: "error",
      message: RELATIVE_BROWSE_REQUIRES_PROJECT_MESSAGE,
    };
  }

  return {
    kind: "browse",
    request: {
      partialPath: query,
      ...(input.activeProjectWorkspaceRoot ? { cwd: input.activeProjectWorkspaceRoot } : {}),
    },
  };
}

export function browseEntriesToPaletteItems(entries: readonly FilesystemBrowseEntry[]): readonly {
  readonly kind: "browse-directory";
  readonly name: string;
  readonly fullPath: string;
}[] {
  return entries.map((entry) => ({
    kind: "browse-directory" as const,
    name: entry.name,
    fullPath: entry.fullPath,
  }));
}
