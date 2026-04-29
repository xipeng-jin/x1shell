import { describe, expect, it } from "vitest";
import { createDebugBuffer } from "./debug.js";

describe("TUI debug buffer", () => {
  it("bounds entries and redacts secrets", () => {
    const buffer = createDebugBuffer({ capacity: 2 });
    buffer.push("info", "one");
    buffer.push("warn", "two", { token: "secret" });
    buffer.push("error", "three");

    const entries = buffer.getSnapshot();
    expect(entries).toHaveLength(2);
    expect(entries[0]?.message).not.toContain("secret");
    expect(entries[0]?.message).toContain("[REDACTED]");
  });
});
