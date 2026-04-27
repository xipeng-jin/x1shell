import { describe, expect, it } from "vitest";
import {
  containsUnsafeTerminalControl,
  createSafeTextStream,
  sanitizeText,
} from "./safeTextStream.js";

describe("safeTextStream", () => {
  it("strips CSI, OSC, DCS, APC, PM, C1 controls, and unsafe C0 controls", () => {
    const input = [
      "ok",
      "\x1b[31mred\x1b[0m",
      "\x1b]0;title\x07",
      "\x1bPpayload\x1b\\",
      "\x1bXpayload\x1b\\",
      "\x1b^payload\x1b\\",
      "\x1b_payload\x1b\\",
      "\x9b?2004h",
      "\x98sos\x9c",
      "\x9d2;clipboard\x9c",
      "\x00\x7f",
      "\n",
    ].join("");

    const output = sanitizeText(input);

    expect(output).toBe("okred\n");
    expect(containsUnsafeTerminalControl(output)).toBe(false);
  });

  it("strips OSC 8 hyperlinks and clipboard/title mutations split across chunks", () => {
    const stream = createSafeTextStream();
    const output = [
      stream.push("before "),
      stream.push("\x1b]8;;https://example.com"),
      stream.push("\x07label\x1b]8;;\x07 after "),
      stream.push("\x1b]52;c;Y2xpcA=="),
      stream.push("\x07 done"),
      stream.flush(),
    ].join("");

    expect(output).toBe("before label after  done");
    expect(containsUnsafeTerminalControl(output)).toBe(false);
  });

  it("strips private mode and input mode changes split across chunks", () => {
    const stream = createSafeTextStream();
    const output = [
      stream.push("a"),
      stream.push("\x1b[?"),
      stream.push("2004h"),
      stream.push("b\x1b[>"),
      stream.push("4;1m"),
      stream.push("c"),
      stream.flush(),
    ].join("");

    expect(output).toBe("abc");
    expect(containsUnsafeTerminalControl(output)).toBe(false);
  });

  it("does not leak partial unterminated controls on flush", () => {
    const stream = createSafeTextStream();
    const output = stream.push("safe\x1b]0;unterminated") + stream.flush();

    expect(output).toBe("safe");
    expect(containsUnsafeTerminalControl(output)).toBe(false);
  });

  it("strips unsupported C1 control bytes", () => {
    const output = sanitizeText("a\x84b\x85c\x91d");

    expect(output).toBe("abcd");
    expect(containsUnsafeTerminalControl(output)).toBe(false);
  });

  it("treats carriage returns and tabs as unsafe for display and log streams", () => {
    const output = sanitizeText("line one\rrewritten\tindented\nline two");

    expect(output).toBe("line onerewrittenindented\nline two");
    expect(containsUnsafeTerminalControl("\r")).toBe(true);
    expect(containsUnsafeTerminalControl("\t")).toBe(true);
    expect(containsUnsafeTerminalControl(output)).toBe(false);
  });

  it("bounds unterminated CSI sequences across chunks", () => {
    const stream = createSafeTextStream();
    const output = [
      stream.push("before\x1b["),
      stream.push("?".repeat(4096)),
      stream.push("?".repeat(4097)),
      stream.push(" after"),
      stream.flush(),
    ].join("");

    expect(output).toBe("before after");
    expect(containsUnsafeTerminalControl(output)).toBe(false);
  });

  it("resumes after split string terminators across chunks", () => {
    const cases = [
      ["\x1bP", "DCS"],
      ["\x1bX", "SOS"],
      ["\x1b]", "OSC"],
      ["\x1b^", "APC"],
      ["\x1b_", "PM"],
      ["\x98", "C1 SOS"],
    ] as const;

    for (const [prefix, name] of cases) {
      const stream = createSafeTextStream();
      const output = stream.push(`a${prefix}payload\x1b`) + stream.push("\\b") + stream.flush();

      expect(output, name).toBe("ab");
      expect(containsUnsafeTerminalControl(output), name).toBe(false);
    }
  });

  it("keeps PM and APC strings open across embedded BEL until ST", () => {
    const cases = [
      ["\x1b_", "PM"],
      ["\x1b^", "APC"],
      ["\x9e", "C1 PM"],
      ["\x9f", "C1 APC"],
    ] as const;

    for (const [prefix, name] of cases) {
      const output = sanitizeText(`a${prefix}payload\x07hidden\x1b\\b`);

      expect(output, name).toBe("ab");
      expect(containsUnsafeTerminalControl(output), name).toBe(false);
    }
  });
});
