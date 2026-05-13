import type {
  ExecutionEnvironmentPlatformOs,
  FilesystemBrowseEntry,
  FilesystemBrowseInput,
} from "@t3tools/contracts";
import {
  getBrowseLeafPathSegment,
  hasTrailingPathSeparator,
  isExplicitRelativeProjectPath,
  isFilesystemBrowseQuery,
} from "@t3tools/shared/projectPaths";
import type { TuiPaletteItem } from "./paletteViewModel.js";

export const RELATIVE_BROWSE_REQUIRES_PROJECT_MESSAGE =
  "Relative filesystem browse paths require a current project.";
export const BROWSE_UP_ITEM_VALUE = "browse-up";

export type TuiBrowsePaletteItem = Extract<
  TuiPaletteItem,
  { readonly kind: "browse-directory" | "browse-up" }
>;

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

export function browseFilterQueryFromPath(query: string): string {
  return hasTrailingPathSeparator(query) ? "" : getBrowseLeafPathSegment(query);
}

export function browseItemValue(item: TuiBrowsePaletteItem): string {
  return item.kind === "browse-up" ? BROWSE_UP_ITEM_VALUE : `browse:${item.fullPath}`;
}

export function filterBrowseEntries(input: {
  readonly browseEntries: readonly FilesystemBrowseEntry[];
  readonly browseFilterQuery: string;
  readonly isDirectoryMode: boolean;
  readonly highlightedItemValue: string | null;
}): {
  readonly filteredEntries: FilesystemBrowseEntry[];
  readonly highlightedEntry: FilesystemBrowseEntry | null;
} {
  const lowerFilter = input.browseFilterQuery.toLowerCase();
  const showHidden = input.isDirectoryMode || input.browseFilterQuery.startsWith(".");

  const filteredEntries = input.browseEntries.filter(
    (entry) =>
      entry.name.toLowerCase().startsWith(lowerFilter) &&
      (showHidden || !entry.name.startsWith(".")),
  );

  const highlightedPath = input.highlightedItemValue?.startsWith("browse:")
    ? input.highlightedItemValue.slice("browse:".length)
    : null;
  const highlightedEntry = highlightedPath
    ? (filteredEntries.find((entry) => entry.fullPath === highlightedPath) ?? null)
    : null;

  return { filteredEntries, highlightedEntry };
}

export function moveBrowseHighlight(input: {
  readonly items: readonly TuiBrowsePaletteItem[];
  readonly highlightedItemValue: string | null;
  readonly direction: 1 | -1;
}): string | null {
  if (input.items.length === 0) return null;

  const currentIndex =
    input.highlightedItemValue === null
      ? -1
      : input.items.findIndex((item) => browseItemValue(item) === input.highlightedItemValue);
  const nextIndex =
    currentIndex < 0
      ? input.direction > 0
        ? 0
        : input.items.length - 1
      : Math.max(0, Math.min(currentIndex + input.direction, input.items.length - 1));

  const nextItem = input.items[nextIndex];
  return nextItem ? browseItemValue(nextItem) : null;
}

export function browseWindowStartForHighlight(input: {
  readonly items: readonly TuiBrowsePaletteItem[];
  readonly highlightedItemValue: string | null;
  readonly currentStart: number;
  readonly windowSize: number;
}): number {
  const windowSize = Math.max(1, input.windowSize);
  const maxStart = Math.max(0, input.items.length - windowSize);
  const currentStart = Math.max(0, Math.min(input.currentStart, maxStart));
  if (input.highlightedItemValue === null) return currentStart;

  const highlightedIndex = input.items.findIndex(
    (item) => browseItemValue(item) === input.highlightedItemValue,
  );
  if (highlightedIndex < 0) return currentStart;
  if (highlightedIndex < currentStart) return highlightedIndex;
  if (highlightedIndex >= currentStart + windowSize) {
    return Math.max(0, Math.min(highlightedIndex - windowSize + 1, maxStart));
  }
  return currentStart;
}
