import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { containsUnsafeTerminalControl } from "./safeTextStream.js";
import { createSafeMarkdownStream, renderSafeMarkdown } from "./safeMarkdown.js";

const TUI_PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("safeMarkdown", () => {
  it("neutralizes markdown links, images, and bare URLs as inert text", () => {
    const output = renderSafeMarkdown(
      "see [label](https://example.com/a) ![alt](https://image.test/x.png) https://bare.test/path",
    );

    expect(output).toContain("label");
    expect(output).toContain("[image: alt]");
    expect(output).not.toContain("](https://example.com");
    expect(output).not.toContain("![alt](");
    expect(output).not.toContain("https://bare.test");
    expect(containsUnsafeTerminalControl(output)).toBe(false);
  });

  it("handles links split across streamed chunks without preserving link metadata", () => {
    const stream = createSafeMarkdownStream();

    const partial = stream.push("before [lab").snapshot;
    const completed = stream.push("el](https://example.com)").snapshot;
    const output = stream.flush().snapshot;

    expect(partial).toBe("before [lab");
    expect(containsUnsafeTerminalControl(partial)).toBe(false);
    expect(completed).toBe("before label");
    expect(containsUnsafeTerminalControl(completed)).toBe(false);
    expect(output).toBe("before label");
    expect(containsUnsafeTerminalControl(output)).toBe(false);
  });

  it("renders through OpenTUI text without OSC 8 or control output", () => {
    const dir = createTempDir("x1shell-safe-markdown-");
    const framePath = join(dir, "frame.txt");

    execFileSync("bun", ["run", "src/test/openTuiSafeMarkdownSmoke.tsx", framePath], {
      cwd: TUI_PACKAGE_DIR,
      stdio: "pipe",
    });

    const frame = readFileSync(framePath, "utf8");

    expect(frame).toContain("label");
    expect(frame).toContain("[image: alt]");
    expect(frame).not.toContain("\x1b]8");
    expect(containsUnsafeTerminalControl(frame)).toBe(false);
  });

  it("renders streamed split links through OpenTUI text without OSC 8 or control output", () => {
    const dir = createTempDir("x1shell-safe-markdown-stream-");
    const framePath = join(dir, "frame.txt");

    execFileSync("bun", ["run", "src/test/openTuiSafeMarkdownSmoke.tsx", framePath, "split"], {
      cwd: TUI_PACKAGE_DIR,
      stdio: "pipe",
    });

    const frame = readFileSync(framePath, "utf8");

    expect(frame).toContain("before [lab");
    expect(frame).toContain("before label");
    expect(frame).not.toContain("\x1b]8");
    expect(containsUnsafeTerminalControl(frame)).toBe(false);
  });

  it("renders common markdown blocks as visible terminal content", () => {
    const dir = createTempDir("x1shell-safe-markdown-blocks-");
    const framePath = join(dir, "frame.txt");

    execFileSync("bun", ["run", "src/test/openTuiSafeMarkdownSmoke.tsx", framePath, "blocks"], {
      cwd: TUI_PACKAGE_DIR,
      stdio: "pipe",
    });

    const frame = readFileSync(framePath, "utf8");

    expect(frame).toContain("Heading");
    expect(frame).toContain("•");
    expect(frame).toContain("bold item");
    expect(frame).toContain("1. italic item");
    expect(frame).toContain("quoted text");
    expect(frame).toContain("safe_markdown.test.ts");
    expect(frame).toContain("foo_bar_baz");
    expect(frame).toContain("const value = 1;");
    expect(containsUnsafeTerminalControl(frame)).toBe(false);
  });

  it("neutralizes large markdown inputs without leaking link destinations", () => {
    const input = Array.from(
      { length: 500 },
      (_, index) =>
        `- [label ${index}](https://example.com/${index}) and https://bare.test/${index} with safe_markdown_${index}`,
    ).join("\n");

    const output = renderSafeMarkdown(input);

    expect(output).toContain("label 0");
    expect(output).toContain("safe_markdown_499");
    expect(output).not.toContain("](https://example.com");
    expect(output).not.toContain("https://bare.test");
    expect(containsUnsafeTerminalControl(output)).toBe(false);
  });
});

function createTempDir(prefix: string): string {
  const parent = process.env.TMPDIR ?? resolve(process.cwd(), "../../.tmp/tui-tests");
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(join(parent, prefix));
}
