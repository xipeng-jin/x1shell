import {
  appendBrowsePathSegment,
  canNavigateUp,
  ensureBrowseDirectoryPath,
  getBrowseDirectoryPath,
  getBrowseLeafPathSegment,
  getBrowseParentPath,
  isFilesystemBrowseQuery,
} from "@t3tools/shared/projectPaths";
import { describe, expect, it } from "vitest";

describe("TUI Add Project path helpers", () => {
  it("uses shared browse path construction semantics", () => {
    expect(ensureBrowseDirectoryPath("~/Development")).toBe("~/Development/");
    expect(ensureBrowseDirectoryPath("C:\\Work")).toBe("C:\\Work\\");
    expect(appendBrowsePathSegment("~/Development/", "x1shell")).toBe("~/Development/x1shell/");
    expect(appendBrowsePathSegment("C:\\Work\\", "x1shell")).toBe("C:\\Work\\x1shell\\");
  });

  it("uses shared browse directory, leaf, and parent semantics", () => {
    expect(getBrowseDirectoryPath("~/Development/x1shell")).toBe("~/Development/");
    expect(getBrowseLeafPathSegment("~/Development/x1shell")).toBe("x1shell");
    expect(canNavigateUp("~/Development/")).toBe(true);
    expect(canNavigateUp("~/Development")).toBe(false);
    expect(getBrowseParentPath("~/Development/")).toBe("~/");
  });

  it("recognizes only filesystem-style browse queries for TUI local folder mode", () => {
    expect(isFilesystemBrowseQuery("~/Development")).toBe(true);
    expect(isFilesystemBrowseQuery("./fixtures")).toBe(true);
    expect(isFilesystemBrowseQuery("../fixtures")).toBe(true);
    expect(isFilesystemBrowseQuery("fixtures")).toBe(false);
  });
});
