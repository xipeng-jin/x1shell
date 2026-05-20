import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { TUI_ACTIONS } from "../domain/keybindings.js";
import {
  buildActionPaletteView,
  buildAddProjectBrowsePaletteView,
  buildAddProjectSourcesPaletteView,
} from "../app/paletteViewModel.js";

const TUI_PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("CommandPalette", () => {
  it("keeps Add Project source selection separate from normal actions", () => {
    const actions = buildActionPaletteView({ actions: TUI_ACTIONS, query: "" });
    const sources = buildAddProjectSourcesPaletteView();

    expect(
      actions.items.some((item) => item.kind === "action" && item.title === "New thread"),
    ).toBe(true);
    expect(sources.title).toBe("Add project");
    expect(sources.groupLabel).toBe("Sources");
    expect(sources.items).toEqual([
      {
        kind: "add-project-source",
        source: "local",
        title: "Local folder",
        description: "Browse a folder on disk",
      },
    ]);
  });

  it("preserves raw Add Project browse values for render-time sanitization", () => {
    const rawQuery =
      "~/Code/token=valid-path\u001b]8;;https://evil.example/path?token=secret\u0007link\u001b]8;;\u0007";
    const rawDirectoryName =
      "repo-token=secret\u001b]8;;https://evil.example/path?token=secret\u0007name\u001b]8;;\u0007";
    const view = buildAddProjectBrowsePaletteView({
      query: rawQuery,
      items: [
        {
          kind: "browse-directory",
          name: rawDirectoryName,
          fullPath: "/home/me/Code/repo-token=secret",
        },
      ],
    });

    expect(view.query).toBe(rawQuery);
    expect(view.items[0]).toMatchObject({ name: rawDirectoryName });
  });

  it("renders action, source, browse, and sanitized error frames through OpenTUI Solid", () => {
    const framePath = join(mkdtempSync(join(tmpdir(), "x1shell-palette-")), "frames.txt");
    execFileSync("bun", ["run", "src/test/openTuiCommandPaletteSmoke.tsx", framePath], {
      cwd: TUI_PACKAGE_DIR,
      stdio: "pipe",
    });
    const frame = readFileSync(framePath, "utf8");

    expect(frame).toContain("Command Palette");
    expect(frame).toContain("New thread");
    expect(frame).toContain("Sources");
    expect(frame).toContain("Local folder");
    expect(frame).toContain("~/Code/");
    expect(frame).toContain("workspace");
    expect(frame).toContain("Failed");
    expect(frame).not.toContain("token=secret");
    expect(frame).not.toContain("\u001b]8");
    expect(frame).not.toContain("evil.example");
  });
});
