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
});
