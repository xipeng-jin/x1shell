import { describe, expect, it } from "vitest";
import { buildFullThreadDiffInput, buildTurnDiffInput, sanitizeDiffText } from "./diff.js";

describe("TUI diff helpers", () => {
  it("uses web-equivalent turn and full-thread ranges", () => {
    const thread = {
      id: "thread-a",
      checkpoints: [{ checkpointTurnCount: 3 }],
    } as never;

    expect(buildTurnDiffInput(thread)).toEqual({
      threadId: "thread-a",
      fromTurnCount: 2,
      toTurnCount: 3,
    });
    expect(buildFullThreadDiffInput(thread)).toEqual({
      threadId: "thread-a",
      toTurnCount: 3,
    });
  });

  it("sanitizes and redacts diff text", () => {
    expect(sanitizeDiffText("+ token=secret\u001b]8;;https://evil\u0007x")).not.toContain("secret");
  });
});
