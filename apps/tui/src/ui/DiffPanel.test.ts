import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sanitizeDiffText } from "../domain/diff.js";

const TUI_PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("DiffPanel", () => {
  it("keeps duplicate sanitized diff lines for rendering", () => {
    const text = sanitizeDiffText("+same\n+same\n-context");

    expect(text.split("\n")).toEqual(["+same", "+same", "-context"]);
  });

  it("renders duplicate diff lines through OpenTUI Solid", () => {
    const framePath = join(mkdtempSync(join(tmpdir(), "x1shell-diff-")), "frame.txt");
    execFileSync("bun", ["run", "src/test/openTuiDiffPanelSmoke.tsx", framePath], {
      cwd: TUI_PACKAGE_DIR,
      stdio: "pipe",
    });
    const frame = readFileSync(framePath, "utf8");

    expect(frame.match(/\+same/g)?.length).toBe(2);
    expect(frame).toContain("-context");
  });
});
