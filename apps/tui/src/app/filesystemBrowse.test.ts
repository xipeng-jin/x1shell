import { describe, expect, it } from "vitest";
import {
  buildTuiFilesystemBrowseRequest,
  browseItemsForQuery,
  browseEntriesToPaletteItems,
  browseItemValue,
  browseWindowStartForHighlight,
  executeBrowseItem,
  filterBrowseEntries,
  browsePlatformFromEnvironmentOs,
  isPrimaryEnterModifier,
  moveBrowseHighlight,
  RELATIVE_BROWSE_REQUIRES_PROJECT_MESSAGE,
  resolveBrowseSubmitPath,
} from "./filesystemBrowse.js";

describe("TUI filesystem browse helpers", () => {
  it("maps server environment OS values to browser-style browse platforms", () => {
    expect(browsePlatformFromEnvironmentOs("darwin")).toBe("MacIntel");
    expect(browsePlatformFromEnvironmentOs("linux")).toBe("Linux");
    expect(browsePlatformFromEnvironmentOs("windows")).toBe("Win32");
    expect(browsePlatformFromEnvironmentOs("unknown")).toBe("");
    expect(browsePlatformFromEnvironmentOs(null)).toBe("");
  });

  it("builds server browse requests from filesystem-style queries", () => {
    expect(
      buildTuiFilesystemBrowseRequest({
        query: "~/Code/x1shell",
        platform: "Linux",
      }),
    ).toEqual({
      kind: "browse",
      request: { partialPath: "~/Code/x1shell" },
    });

    expect(
      buildTuiFilesystemBrowseRequest({
        query: "~/Code/",
        platform: "Linux",
        activeProjectWorkspaceRoot: "/repo/current",
      }),
    ).toEqual({
      kind: "browse",
      request: { partialPath: "~/Code/", cwd: "/repo/current" },
    });
  });

  it("skips non-filesystem browse queries", () => {
    expect(
      buildTuiFilesystemBrowseRequest({
        query: "repo",
        platform: "Linux",
      }),
    ).toEqual({ kind: "skip" });
  });

  it("rejects explicit relative browse queries without an active project", () => {
    expect(
      buildTuiFilesystemBrowseRequest({
        query: "./src",
        platform: "Linux",
      }),
    ).toEqual({
      kind: "error",
      message: RELATIVE_BROWSE_REQUIRES_PROJECT_MESSAGE,
    });
  });

  it("allows Windows absolute paths only on Windows browse platform", () => {
    expect(
      buildTuiFilesystemBrowseRequest({
        query: "C:\\Work\\Repo",
        platform: "Linux",
      }),
    ).toEqual({ kind: "skip" });

    expect(
      buildTuiFilesystemBrowseRequest({
        query: "C:\\Work\\Repo",
        platform: "Win32",
      }),
    ).toEqual({
      kind: "browse",
      request: { partialPath: "C:\\Work\\Repo" },
    });
  });

  it("converts browse entries into palette directory items", () => {
    expect(
      browseEntriesToPaletteItems([
        { name: "x1shell", fullPath: "/repo/x1shell" },
        { name: "opentui", fullPath: "/repo/opentui" },
      ]),
    ).toEqual([
      { kind: "browse-directory", name: "x1shell", fullPath: "/repo/x1shell" },
      { kind: "browse-directory", name: "opentui", fullPath: "/repo/opentui" },
    ]);
  });

  it("filters browse entries with web prefix and hidden-directory semantics", () => {
    const entries = [
      { name: "src", fullPath: "/repo/src" },
      { name: "src-ui", fullPath: "/repo/src-ui" },
      { name: "my-src", fullPath: "/repo/my-src" },
      { name: ".src-cache", fullPath: "/repo/.src-cache" },
    ];

    expect(
      filterBrowseEntries({
        browseEntries: entries,
        browseFilterQuery: "src",
        isDirectoryMode: false,
        highlightedItemValue: null,
      }).filteredEntries.map((entry) => entry.name),
    ).toEqual(["src", "src-ui"]);

    expect(
      filterBrowseEntries({
        browseEntries: entries,
        browseFilterQuery: ".s",
        isDirectoryMode: false,
        highlightedItemValue: null,
      }).filteredEntries.map((entry) => entry.name),
    ).toEqual([".src-cache"]);
  });

  it("preserves server-returned dot directories in directory browse mode", () => {
    const entries = [
      { name: ".config", fullPath: "/repo/.config" },
      { name: "config", fullPath: "/repo/config" },
    ];

    expect(
      filterBrowseEntries({
        browseEntries: entries,
        browseFilterQuery: "",
        isDirectoryMode: true,
        highlightedItemValue: null,
      }).filteredEntries.map((entry) => entry.name),
    ).toEqual([".config", "config"]);
  });

  it("does not impose a fixed filtering result limit", () => {
    const entries = Array.from({ length: 12 }, (_, index) => ({
      name: `src-${index}`,
      fullPath: `/repo/src-${index}`,
    }));

    expect(
      filterBrowseEntries({
        browseEntries: entries,
        browseFilterQuery: "src",
        isDirectoryMode: false,
        highlightedItemValue: null,
      }).filteredEntries,
    ).toHaveLength(12);
  });

  it("resolves browse highlight by stable full path", () => {
    const entries = [
      { name: "src", fullPath: "/repo/src" },
      { name: "scripts", fullPath: "/repo/scripts" },
    ];

    expect(
      filterBrowseEntries({
        browseEntries: entries,
        browseFilterQuery: "s",
        isDirectoryMode: false,
        highlightedItemValue: "browse:/repo/scripts",
      }).highlightedEntry,
    ).toEqual({ name: "scripts", fullPath: "/repo/scripts" });

    expect(
      filterBrowseEntries({
        browseEntries: entries,
        browseFilterQuery: "src",
        isDirectoryMode: false,
        highlightedItemValue: "browse:/repo/scripts",
      }).highlightedEntry,
    ).toBeNull();
  });

  it("moves browse highlight manually through the full item list", () => {
    const items = browseEntriesToPaletteItems(
      Array.from({ length: 12 }, (_, index) => ({
        name: `repo-${index}`,
        fullPath: `/repo/repo-${index}`,
      })),
    );

    expect(
      moveBrowseHighlight({
        items,
        highlightedItemValue: null,
        direction: 1,
      }),
    ).toBe("browse:/repo/repo-0");
    expect(
      moveBrowseHighlight({
        items,
        highlightedItemValue: null,
        direction: -1,
      }),
    ).toBe("browse:/repo/repo-11");
    expect(
      moveBrowseHighlight({
        items,
        highlightedItemValue: "browse:/repo/repo-9",
        direction: 1,
      }),
    ).toBe("browse:/repo/repo-10");
  });

  it("keeps highlighted browse rows visible in the rendered window", () => {
    const items = browseEntriesToPaletteItems(
      Array.from({ length: 12 }, (_, index) => ({
        name: `repo-${index}`,
        fullPath: `/repo/repo-${index}`,
      })),
    );

    expect(
      browseWindowStartForHighlight({
        items,
        highlightedItemValue: browseItemValue(items[8]!),
        currentStart: 0,
        windowSize: 5,
      }),
    ).toBe(4);
    expect(
      browseWindowStartForHighlight({
        items,
        highlightedItemValue: browseItemValue(items[2]!),
        currentStart: 4,
        windowSize: 5,
      }),
    ).toBe(2);
  });

  it("adds browse-up only when the browse directory can navigate upward", () => {
    expect(
      browseItemsForQuery({
        query: "~/Code/",
        entries: [{ name: "x1shell", fullPath: "/home/me/Code/x1shell" }],
      }),
    ).toEqual([
      { kind: "browse-up" },
      { kind: "browse-directory", name: "x1shell", fullPath: "/home/me/Code/x1shell" },
    ]);

    expect(
      browseItemsForQuery({
        query: "~/Code",
        entries: [{ name: "Code", fullPath: "/home/me/Code" }],
      }),
    ).toEqual([{ kind: "browse-directory", name: "Code", fullPath: "/home/me/Code" }]);
  });

  it("executes browse directory and browse-up items with shared path semantics", () => {
    expect(
      executeBrowseItem({
        query: "~/Code/",
        item: { kind: "browse-directory", name: "x1shell", fullPath: "/home/me/Code/x1shell" },
      }),
    ).toBe("~/Code/x1shell/");

    expect(executeBrowseItem({ query: "~/Code/x1shell/", item: { kind: "browse-up" } })).toBe(
      "~/Code/",
    );
    expect(executeBrowseItem({ query: "/", item: { kind: "browse-up" } })).toBeNull();
  });

  it("resolves Add Project submit paths from browse data before dispatch handoff", () => {
    expect(
      resolveBrowseSubmitPath({
        query: "~/Code/x1shell/",
        browseResult: { parentPath: "/home/me/Code/x1shell", entries: [] },
        filteredEntries: [],
      }),
    ).toBe("/home/me/Code/x1shell");

    expect(
      resolveBrowseSubmitPath({
        query: "~/Code/x1",
        browseResult: {
          parentPath: "/home/me/Code",
          entries: [{ name: "x1", fullPath: "/home/me/Code/x1" }],
        },
        filteredEntries: [{ name: "x1", fullPath: "/home/me/Code/x1" }],
      }),
    ).toBe("/home/me/Code/x1");

    expect(
      resolveBrowseSubmitPath({
        query: "./docs/",
        browseResult: null,
        filteredEntries: [],
        currentProjectWorkspaceRoot: "/repo/app",
      }),
    ).toBe("/repo/app/docs");
  });

  it("uses the TUI host platform for modified Enter submit", () => {
    expect(isPrimaryEnterModifier({ key: { ctrl: true }, hostPlatform: "linux" })).toBe(true);
    expect(isPrimaryEnterModifier({ key: { meta: true }, hostPlatform: "linux" })).toBe(false);
    expect(isPrimaryEnterModifier({ key: { meta: true }, hostPlatform: "darwin" })).toBe(true);
    expect(isPrimaryEnterModifier({ key: { ctrl: true }, hostPlatform: "darwin" })).toBe(false);
    expect(isPrimaryEnterModifier({ key: { ctrl: true, meta: true }, hostPlatform: "linux" })).toBe(
      false,
    );
  });
});
