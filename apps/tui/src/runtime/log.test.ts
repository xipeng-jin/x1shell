import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createLogger, safeOutputUnknown } from "./log.js";
import { containsUnsafeTerminalControl } from "../terminal/safeTextStream.js";

describe("logger", () => {
  it("drains pending writes before close resolves", async () => {
    const dir = await createTempDir();
    const logFile = join(dir, "x1shell.log");
    const logger = createLogger({ logFile });

    logger.info("headless frame written", { framePath: "/tmp/frame.txt" });
    await logger.close();

    const contents = await readFile(logFile, "utf8");
    expect(contents).toContain("headless frame written");
    expect(contents).toContain("/tmp/frame.txt");
  });

  it("does not throw or drop writes when details contain BigInt", async () => {
    const dir = await createTempDir();
    const logFile = join(dir, "x1shell.log");
    const logger = createLogger({ logFile });
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      expect(() => logger.error("unhandled rejection", 42n)).not.toThrow();
      await logger.close();
    } finally {
      stderrWrite.mockRestore();
    }

    const contents = await readFile(logFile, "utf8");
    expect(contents).toContain("unhandled rejection");
    expect(contents).toContain('"details":"42"');
  });

  it("sanitizes terminal controls and secrets before writing stderr and file logs", async () => {
    const dir = await createTempDir();
    const logFile = join(dir, "x1shell.log");
    const logger = createLogger({ logFile });
    let stderr = "";
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });

    try {
      logger.error("bad \x1b]52;c;Y2xpcA==\x07 token=secret", {
        nested: "red\x1b[31m token=hidden",
        url: "ws://127.0.0.1/ws?wsToken=socket-secret",
      });
      await logger.close();
    } finally {
      stderrWrite.mockRestore();
    }

    const contents = await readFile(logFile, "utf8");
    const parsed = JSON.parse(contents.trim()) as {
      message: string;
      details: { nested: string; url: string };
    };

    for (const output of [
      stderr,
      contents,
      parsed.message,
      parsed.details.nested,
      parsed.details.url,
    ]) {
      expect(containsUnsafeTerminalControl(output)).toBe(false);
      expect(output).not.toContain("secret");
      expect(output).not.toContain("hidden");
      expect(output).not.toContain("Y2xpcA");
    }
    expect(parsed.message).toBe("bad  token=[REDACTED]");
    expect(parsed.details.nested).toBe("red token=[REDACTED]");
    expect(parsed.details.url).toContain("wsToken=%5BREDACTED%5D");
  });

  it("sanitizes unknown errors for direct terminal output", () => {
    const error = new Error("failed \x1b]0;title\x07 token=secret");
    const output = safeOutputUnknown(error);

    expect(containsUnsafeTerminalControl(output)).toBe(false);
    expect(output).not.toContain("secret");
    expect(output).not.toContain("title");
    expect(output).toContain("token=[REDACTED]");
  });
});

async function createTempDir(): Promise<string> {
  const parent = process.env.TMPDIR ?? resolve(process.cwd(), "../../.tmp/tui-tests");
  await mkdir(parent, { recursive: true });
  return mkdtemp(join(parent, "x1shell-log-"));
}
