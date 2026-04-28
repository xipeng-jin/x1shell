import { describe, expect, it } from "vitest";
import type { ThreadDetailState } from "./threadDetailStore.js";
import {
  applyThreadItem,
  createThreadDetailStore,
  isSnapshotRequiredThreadEvent,
} from "./threadDetailStore.js";

describe("TUI thread detail store", () => {
  it("applies snapshots and filtered raw events with independent stale drops", () => {
    let state: ThreadDetailState = { entries: {} };
    state = applyThreadItem(
      state,
      "thread-a" as never,
      {
        kind: "snapshot",
        snapshot: { snapshotSequence: 5, thread: threadDetail("thread-a") },
      } as never,
    );
    state = applyThreadItem(
      state,
      "thread-a" as never,
      {
        kind: "event",
        event: messageEvent(9, "thread-b", "ignored"),
      } as never,
    );
    expect(state.entries["thread-a"]?.thread?.messages).toHaveLength(0);

    state = applyThreadItem(
      state,
      "thread-a" as never,
      {
        kind: "event",
        event: messageEvent(11, "thread-a", "hello"),
      } as never,
    );
    expect(state.entries["thread-a"]?.lastAppliedSequence).toBe(11);
    expect(state.entries["thread-a"]?.thread?.messages[0]?.text).toBe("hello");

    const afterMessage = state;
    state = applyThreadItem(
      state,
      "thread-a" as never,
      {
        kind: "event",
        event: messageEvent(7, "thread-a", "stale"),
      } as never,
    );
    expect(state).toBe(afterMessage);

    state = applyThreadItem(
      state,
      "thread-a" as never,
      {
        kind: "event",
        event: activityEvent(14, "thread-a", "Ran tool"),
      } as never,
    );
    expect(state.entries["thread-a"]?.thread?.activities[0]?.summary).toBe("Ran tool");
  });

  it("does not emit for stale filtered events", () => {
    const store = createThreadDetailStore();
    let emissions = 0;
    store.subscribe(() => {
      emissions += 1;
    });
    store.applyThreadItem(
      "thread-a" as never,
      {
        kind: "snapshot",
        snapshot: { snapshotSequence: 5, thread: threadDetail("thread-a") },
      } as never,
    );
    store.applyThreadItem(
      "thread-a" as never,
      {
        kind: "event",
        event: messageEvent(4, "thread-a", "stale"),
      } as never,
    );

    expect(emissions).toBe(2);
    expect(store.getSnapshot().entries["thread-a"]?.thread?.messages).toHaveLength(0);
  });

  it("ignores stale thread snapshots after newer live events", () => {
    const store = createThreadDetailStore();
    store.applyThreadItem(
      "thread-a" as never,
      {
        kind: "snapshot",
        snapshot: { snapshotSequence: 5, thread: threadDetail("thread-a") },
      } as never,
    );
    store.applyThreadItem(
      "thread-a" as never,
      {
        kind: "event",
        event: messageEvent(9, "thread-a", "fresh"),
      } as never,
    );
    store.applyThreadItem(
      "thread-a" as never,
      {
        kind: "snapshot",
        snapshot: {
          snapshotSequence: 6,
          thread: Object.assign(threadDetail("thread-a"), {
            messages: [
              {
                id: "message-stale",
                role: "assistant",
                text: "stale",
                attachments: [],
                turnId: null,
                streaming: false,
                createdAt: "2026-04-28T00:00:00.000Z",
                updatedAt: "2026-04-28T00:00:00.000Z",
              },
            ],
          }),
        },
      } as never,
    );

    expect(store.getSnapshot().entries["thread-a"]?.lastAppliedSequence).toBe(9);
    expect(store.getSnapshot().entries["thread-a"]?.thread?.messages).toMatchObject([
      { id: "message-9", text: "fresh" },
    ]);
  });

  it("accumulates streaming message deltas and preserves text on empty final events", () => {
    let state: ThreadDetailState = { entries: {} };
    state = applyThreadItem(
      state,
      "thread-a" as never,
      {
        kind: "snapshot",
        snapshot: { snapshotSequence: 5, thread: threadDetail("thread-a") },
      } as never,
    );

    state = applyThreadItem(
      state,
      "thread-a" as never,
      {
        kind: "event",
        event: messageEvent(6, "thread-a", "hel", {
          messageId: "message-stream",
          role: "assistant",
          streaming: true,
        }),
      } as never,
    );
    state = applyThreadItem(
      state,
      "thread-a" as never,
      {
        kind: "event",
        event: messageEvent(7, "thread-a", "lo", {
          messageId: "message-stream",
          role: "assistant",
          streaming: true,
        }),
      } as never,
    );
    state = applyThreadItem(
      state,
      "thread-a" as never,
      {
        kind: "event",
        event: messageEvent(8, "thread-a", "", {
          messageId: "message-stream",
          role: "assistant",
          streaming: false,
        }),
      } as never,
    );

    expect(state.entries["thread-a"]?.thread?.messages).toMatchObject([
      {
        id: "message-stream",
        role: "assistant",
        text: "hello",
        streaming: false,
      },
    ]);
  });

  it("applies high-frequency batches with one emission and coalesced assistant deltas", () => {
    const store = createThreadDetailStore();
    let emissions = 0;
    store.subscribe(() => {
      emissions += 1;
    });
    store.applyThreadItem(
      "thread-a" as never,
      {
        kind: "snapshot",
        snapshot: { snapshotSequence: 5, thread: threadDetail("thread-a") },
      } as never,
    );
    store.applyThreadItems(
      "thread-a" as never,
      [
        {
          kind: "event",
          event: messageEvent(6, "thread-a", "hel", {
            messageId: "message-stream",
            role: "assistant",
            streaming: true,
          }),
        },
        {
          kind: "event",
          event: messageEvent(8, "thread-a", "lo", {
            messageId: "message-stream",
            role: "assistant",
            streaming: true,
          }),
        },
        {
          kind: "event",
          event: messageEvent(7, "thread-a", "stale", {
            messageId: "message-stale",
            role: "assistant",
            streaming: true,
          }),
        },
        {
          kind: "event",
          event: activityEvent(11, "thread-a", "Ran tool"),
        },
      ] as never,
    );

    expect(emissions).toBe(3);
    expect(store.getSnapshot().entries["thread-a"]?.lastAppliedSequence).toBe(11);
    expect(store.getSnapshot().entries["thread-a"]?.thread?.messages).toMatchObject([
      {
        id: "message-stream",
        text: "hello",
      },
    ]);
    expect(store.getSnapshot().entries["thread-a"]?.thread?.activities[0]?.summary).toBe(
      "Ran tool",
    );
  });

  it("does not locally reduce events that require a replacement snapshot", () => {
    let state: ThreadDetailState = { entries: {} };
    state = applyThreadItem(
      state,
      "thread-a" as never,
      {
        kind: "snapshot",
        snapshot: {
          snapshotSequence: 5,
          thread: Object.assign(threadDetail("thread-a"), {
            messages: [
              {
                id: "message-after-checkpoint",
                role: "assistant",
                text: "should stay until replacement snapshot",
                attachments: [],
                turnId: "turn-after-checkpoint",
                streaming: false,
                createdAt: "2026-04-28T00:00:00.000Z",
                updatedAt: "2026-04-28T00:00:00.000Z",
              },
            ],
          }),
        },
      } as never,
    );
    const beforeRevert = state;
    const revertItem = {
      kind: "event",
      event: {
        sequence: 9,
        eventId: "event-reverted",
        aggregateKind: "thread",
        aggregateId: "thread-a",
        occurredAt: "2026-04-28T00:00:01.000Z",
        commandId: null,
        causationEventId: null,
        correlationId: null,
        metadata: {},
        type: "thread.reverted",
        payload: {
          threadId: "thread-a",
          turnCount: 0,
          revertedAt: "2026-04-28T00:00:01.000Z",
        },
      },
    } as never;

    expect(isSnapshotRequiredThreadEvent(revertItem)).toBe(true);
    state = applyThreadItem(state, "thread-a" as never, revertItem);

    expect(state).toBe(beforeRevert);
  });
});

function threadDetail(id: string) {
  return {
    id,
    projectId: "project-a",
    title: "Thread",
    modelSelection: { provider: "codex", model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "main",
    worktreePath: "/repo/project",
    latestTurn: null,
    createdAt: "2026-04-28T00:00:00.000Z",
    updatedAt: "2026-04-28T00:00:00.000Z",
    archivedAt: null,
    deletedAt: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
  } as never;
}

function messageEvent(
  sequence: number,
  threadId: string,
  text: string,
  options?: {
    readonly messageId?: string;
    readonly role?: "user" | "assistant";
    readonly streaming?: boolean;
  },
) {
  return {
    sequence,
    eventId: `event-${sequence}`,
    aggregateKind: "thread",
    aggregateId: threadId,
    occurredAt: "2026-04-28T00:00:00.000Z",
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type: "thread.message-sent",
    payload: {
      threadId,
      messageId: options?.messageId ?? `message-${sequence}`,
      role: options?.role ?? "user",
      text,
      attachments: [],
      turnId: null,
      streaming: options?.streaming ?? false,
      createdAt: "2026-04-28T00:00:00.000Z",
      updatedAt: "2026-04-28T00:00:00.000Z",
    },
  };
}

function activityEvent(sequence: number, threadId: string, summary: string) {
  return {
    ...messageEvent(sequence, threadId, summary),
    type: "thread.activity-appended",
    payload: {
      threadId,
      activity: {
        id: `event-${sequence}`,
        tone: "tool",
        kind: "tool",
        summary,
        payload: {},
        turnId: null,
        sequence,
        createdAt: "2026-04-28T00:00:00.000Z",
      },
    },
  };
}
