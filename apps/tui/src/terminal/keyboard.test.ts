import { describe, expect, it } from "vitest";
import { resolveKeyboardPolicy, shouldUseKittyKeyboard } from "./keyboard.js";

describe("keyboard policy", () => {
  it("detects Kitty keyboard capable terminals", () => {
    expect(shouldUseKittyKeyboard({ TERM_PROGRAM: "Ghostty" })).toBe(true);
    expect(shouldUseKittyKeyboard({ TERM: "xterm-kitty" })).toBe(true);
    expect(shouldUseKittyKeyboard({ TERM_PROGRAM: "plain" })).toBe(false);
  });

  it("keeps Ctrl+C app-controlled through renderer policy defaults", () => {
    const policy = resolveKeyboardPolicy({});

    expect(policy.useMouse).toBe(true);
    expect(policy.enableMouseMovement).toBe(false);
  });
});
