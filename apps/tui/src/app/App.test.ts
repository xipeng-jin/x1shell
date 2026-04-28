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
    expect(frame).toContain("Waiting for shell snapshot.");
    expect(frame).not.toContain("secret");
    expect(frame).toContain("X1SHELL_TOKEN=[");
    expect(frame).toContain("REDACTED]/config");
  });

  it("renders shell projects, threads, detail, composer, and sanitized text", () => {
    const dir = createTempDir("x1shell-tui-phase6-");
    const framePath = join(dir, "frame.txt");

    execFileSync(
      "bun",
      [
        "run",
        "src/index.tsx",
        "--headless",
        "--headless-width=120",
        "--headless-height=28",
        `--headless-frame=${framePath}`,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          X1SHELL_HEADLESS_PHASE6_FIXTURE: "1",
          X1SHELL_CONFIG_HOME: join(dir, "config"),
          X1SHELL_DATA_HOME: join(dir, "data"),
          X1SHELL_CACHE_HOME: join(dir, "cache"),
          X1SHELL_STATE_HOME: join(dir, "state"),
        },
        stdio: "pipe",
      },
    );

    const frame = readFileSync(framePath, "utf8");
    expect(frame).toContain("Project");
    expect(frame).toContain("Thread Shell Fresh");
    expect(frame).not.toContain("Thread Detail Stale");
    expect(frame).toContain("assistant");
    expect(frame).toContain("hello link");
    expect(frame).toContain("Plan with");
    expect(frame).toContain("draft");
    expect(frame).not.toContain("\u001b]8");
    expect(frame).not.toContain("evil.example");
    expect(frame).not.toContain("plan-secret");
  });
});

function createTempDir(prefix: string): string {
  const parent = process.env.TMPDIR ?? resolve(process.cwd(), "../../.tmp/tui-tests");
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(join(parent, prefix));
}
