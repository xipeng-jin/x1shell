import { describe, expect, it } from "vitest";
import { containsUnsafeTerminalControl } from "../terminal/safeTextStream.js";
import { createConversationDisplayCache } from "./display.js";

describe("TUI conversation display selectors", () => {
  it("keeps canonical text raw while deriving sanitized inert display output", () => {
    const raw = "hello \u001b]8;;https://example.com\u0007link\u001b]8;;\u0007 [x](https://x.test)";
    const thread = threadDetail("thread-a", [{ id: "message-a", text: raw }]);
    const cache = createConversationDisplayCache();
    const timeline = cache.buildTimeline(thread as never);

    expect(thread.messages[0]?.text).toBe(raw);
    expect(timeline[0]).toMatchObject({ kind: "message" });
    const markdown = timeline[0]?.kind === "message" ? timeline[0].markdown : "";
    expect(containsUnsafeTerminalControl(markdown)).toBe(false);
    expect(markdown).not.toContain("https://example.com");
    expect(markdown).not.toContain("](https://x.test)");
  });

  it("bounds timeline rendering to the latest display window", () => {
    const messages = Array.from({ length: 55 }, (_, index) => ({
      id: `message-${index}`,
      text: `message ${index}`,
      createdAt: `2026-04-28T00:00:${String(index).padStart(2, "0")}.000Z`,
    }));
    const cache = createConversationDisplayCache({ windowSize: 10 });
    const timeline = cache.buildTimeline(threadDetail("thread-a", messages) as never);

    expect(timeline).toHaveLength(10);
    expect(timeline[0]?.key).toBe("message:message-45");
    expect(timeline.at(-1)?.key).toBe("message:message-54");
  });
});

function threadDetail(
  id: string,
  messages: ReadonlyArray<{
    readonly id: string;
    readonly text: string;
    readonly createdAt?: string;
  }>,
) {
  return {
    id,
    projectId: "project-a",
    title: "Thread",
    modelSelection: { instanceId: "codex", model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "main",
    worktreePath: "/repo/project",
    latestTurn: null,
    createdAt: "2026-04-28T00:00:00.000Z",
    updatedAt: "2026-04-28T00:00:00.000Z",
    archivedAt: null,
    deletedAt: null,
    messages: messages.map((message, index) => ({
      id: message.id,
      role: "assistant",
      text: message.text,
      attachments: [],
      turnId: null,
      streaming: false,
      createdAt: message.createdAt ?? `2026-04-28T00:00:${String(index).padStart(2, "0")}.000Z`,
      updatedAt: message.createdAt ?? `2026-04-28T00:00:${String(index).padStart(2, "0")}.000Z`,
    })),
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
  };
}
