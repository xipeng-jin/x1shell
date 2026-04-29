import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureProcessListeners,
  removeAddedProcessListeners,
} from "./runtime/processListeners.js";

describe("renderer lifecycle", () => {
  const cleanup: (() => void)[] = [];

  afterEach(() => {
    while (cleanup.length > 0) {
      cleanup.pop()?.();
    }
  });

  it("removes raw unhandled-error listeners installed during renderer startup", () => {
    const preservedUncaught = vi.fn();
    const rawUncaught = vi.fn();
    const rawRejection = vi.fn();

    process.on("uncaughtException", preservedUncaught);
    cleanup.push(() => process.removeListener("uncaughtException", preservedUncaught));

    const beforeRendererStartup = captureProcessListeners([
      "uncaughtException",
      "unhandledRejection",
    ]);

    process.on("uncaughtException", rawUncaught);
    process.on("unhandledRejection", rawRejection);
    cleanup.push(() => process.removeListener("uncaughtException", rawUncaught));
    cleanup.push(() => process.removeListener("unhandledRejection", rawRejection));

    removeAddedProcessListeners(beforeRendererStartup);

    expect(process.rawListeners("uncaughtException")).toContain(preservedUncaught);
    expect(process.rawListeners("uncaughtException")).not.toContain(rawUncaught);
    expect(process.rawListeners("unhandledRejection")).not.toContain(rawRejection);
  });

  it("keeps OpenTUI input and resize listeners bounded across store updates", () => {
    const output = execFileSync("bun", ["run", "src/test/openTuiListenerLeakSmoke.tsx"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: "pipe",
    });
    expect(output).not.toContain("Possible EventTarget memory leak");

    const result = JSON.parse(output.trim()) as {
      baseline: Record<"keypress" | "resize" | "selection", number>;
      after: Record<"keypress" | "resize" | "selection", number>;
    };
    expect(result.after).toEqual(result.baseline);
  });
});
