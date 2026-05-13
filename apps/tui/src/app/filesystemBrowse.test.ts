import { describe, expect, it } from "vitest";
import {
  buildTuiFilesystemBrowseRequest,
  browseEntriesToPaletteItems,
  browsePlatformFromEnvironmentOs,
  RELATIVE_BROWSE_REQUIRES_PROJECT_MESSAGE,
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
});
