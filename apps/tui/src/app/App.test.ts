import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("App headless smoke", () => {
  it("captures a static boot frame", () => {
    const dir = createTempDir("x1shell-tui-headless-");
    const framePath = join(dir, "frame.txt");

    execFileSync(
      "bun",
      [
        "run",
        "src/index.tsx",
        "--headless",
        "--headless-width=110",
        "--headless-height=24",
        `--headless-frame=${framePath}`,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          X1SHELL_CONFIG_HOME: join(dir, "X1SHELL_TOKEN=secret", "config"),
          X1SHELL_DATA_HOME: join(dir, "data"),
          X1SHELL_CACHE_HOME: join(dir, "cache"),
          X1SHELL_STATE_HOME: join(dir, "state"),
        },
        stdio: "pipe",
      },
    );

    const frame = readFileSync(framePath, "utf8");

    expect(frame).toContain("X1Shell");
    expect(frame).toContain("110x24");
    expect(frame).toContain("Renderer Ready");
    expect(frame).not.toContain("secret");
    expect(frame).toContain("X1SHELL_TOKEN=[REDACTED]");
  });
});

function createTempDir(prefix: string): string {
  const parent = process.env.TMPDIR ?? resolve(process.cwd(), "../../.tmp/tui-tests");
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(join(parent, prefix));
}
