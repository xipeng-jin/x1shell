import type {
  OrchestrationEvent,
  OrchestrationMessage,
  OrchestrationThread,
  OrchestrationThreadActivity,
  OrchestrationThreadDetailSnapshot,
  OrchestrationThreadStreamItem,
  ThreadId,
} from "@t3tools/contracts";

export interface ThreadDetailEntry {
  readonly threadId: ThreadId;
  readonly thread: OrchestrationThread | null;
  readonly lastAppliedSequence: number;
}

export interface ThreadDetailState {
  readonly entries: Readonly<Record<string, ThreadDetailEntry>>;
}

export type ThreadDetailListener = (state: ThreadDetailState) => void;
type ThreadEventItem = { readonly kind: "event"; readonly event: OrchestrationEvent };

export function createThreadDetailStore(initial?: Partial<ThreadDetailState>) {
  let state: ThreadDetailState = { entries: {}, ...initial };
  const listeners = new Set<ThreadDetailListener>();
  const emit = () => {
    for (const listener of listeners) listener(state);
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: ThreadDetailListener) => {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    applyThreadItem: (threadId: ThreadId, item: OrchestrationThreadStreamItem) => {
      const next = applyThreadItem(state, threadId, item);
      if (next === state) return;
      state = next;
      emit();
    },
    applyThreadItems: (threadId: ThreadId, items: readonly OrchestrationThreadStreamItem[]) => {
      let next = state;
      for (const item of coalesceThreadItems(threadId, next, items)) {
        next = applyThreadItem(next, threadId, item);
      }
      if (next === state) return;
      state = next;
      emit();
    },
    getThread: (threadId: ThreadId | null | undefined) =>
      threadId ? (state.entries[threadId]?.thread ?? null) : null,
    clearThread: (threadId: ThreadId) => {
      if (!state.entries[threadId]) return;
      const { [threadId]: _removed, ...entries } = state.entries;
      state = { entries };
      emit();
    },
  };
}

export function applyThreadItem(
  state: ThreadDetailState,
  threadId: ThreadId,
  item: OrchestrationThreadStreamItem,
): ThreadDetailState {
  if (item.kind === "snapshot") {
    return applyThreadSnapshot(state, item.snapshot);
  }
  if (item.event.aggregateKind !== "thread" || item.event.aggregateId !== threadId) {
    return state;
  }
  const current = state.entries[threadId];
  if (!current?.thread || item.event.sequence <= current.lastAppliedSequence) {
    return state;
  }
  if (isSnapshotRequiredThreadEvent(item)) {
    return state;
  }
  return {
    entries: {
      ...state.entries,
      [threadId]: {
        threadId,
        lastAppliedSequence: item.event.sequence,
        thread: applyThreadEvent(current.thread, item.event),
      },
    },
  };
}

export function coalesceThreadItems(
  threadId: ThreadId,
  state: ThreadDetailState,
  items: readonly OrchestrationThreadStreamItem[],
): OrchestrationThreadStreamItem[] {
  const output: OrchestrationThreadStreamItem[] = [];
  let pending: OrchestrationThreadStreamItem | null = null;
  let lastSequence = state.entries[threadId]?.lastAppliedSequence ?? 0;

  const flushPending = () => {
    if (pending) {
      output.push(pending);
      pending = null;
    }
  };

  for (const item of items) {
    if (item.kind === "snapshot") {
      flushPending();
      if (item.snapshot.snapshotSequence < lastSequence) {
        continue;
      }
      output.push(item);
      lastSequence = item.snapshot.snapshotSequence;
      continue;
    }
    const eventItem = item as ThreadEventItem;
    if (eventItem.event.aggregateKind !== "thread" || eventItem.event.aggregateId !== threadId) {
      continue;
    }
    if (eventItem.event.sequence <= lastSequence) continue;
    if (!isAssistantStreamingMessageEvent(eventItem)) {
      flushPending();
      output.push(eventItem);
      lastSequence = eventItem.event.sequence;
      continue;
    }
    if (pending && isSameStreamingMessage(pending, eventItem)) {
      pending = mergeStreamingMessageEvent(pending, eventItem);
    } else {
      flushPending();
      pending = eventItem;
    }
    lastSequence = eventItem.event.sequence;
  }
  flushPending();
  return output;
}

function applyThreadSnapshot(
  state: ThreadDetailState,
  snapshot: OrchestrationThreadDetailSnapshot,
): ThreadDetailState {
  const current = state.entries[snapshot.thread.id];
  if (current && snapshot.snapshotSequence < current.lastAppliedSequence) {
    return state;
  }
  if (
    current?.lastAppliedSequence === snapshot.snapshotSequence &&
    structuralEqual(current.thread, snapshot.thread)
  ) {
    return state;
  }
  return {
    entries: {
      ...state.entries,
      [snapshot.thread.id]: {
        threadId: snapshot.thread.id,
        thread: snapshot.thread,
        lastAppliedSequence: snapshot.snapshotSequence,
      },
    },
  };
}

export function applyThreadEvent(
  thread: OrchestrationThread,
  event: OrchestrationEvent,
): OrchestrationThread {
  switch (event.type) {
    case "thread.deleted":
      return { ...thread, deletedAt: event.payload.deletedAt };
    case "thread.archived":
      return {
        ...thread,
        archivedAt: event.payload.archivedAt,
        updatedAt: event.payload.updatedAt,
      };
    case "thread.unarchived":
      return { ...thread, archivedAt: null, updatedAt: event.payload.updatedAt };
    case "thread.meta-updated":
      return {
        ...thread,
        ...(event.payload.title !== undefined ? { title: event.payload.title } : {}),
        ...(event.payload.modelSelection !== undefined
          ? { modelSelection: event.payload.modelSelection }
          : {}),
        ...(event.payload.branch !== undefined ? { branch: event.payload.branch } : {}),
        ...(event.payload.worktreePath !== undefined
          ? { worktreePath: event.payload.worktreePath }
          : {}),
        updatedAt: event.payload.updatedAt,
      };
    case "thread.runtime-mode-set":
      return {
        ...thread,
        runtimeMode: event.payload.runtimeMode,
        updatedAt: event.payload.updatedAt,
      };
    case "thread.interaction-mode-set":
      return {
        ...thread,
        interactionMode: event.payload.interactionMode,
        updatedAt: event.payload.updatedAt,
      };
    case "thread.message-sent":
      return {
        ...thread,
        messages: upsertMessage(thread.messages, {
          id: event.payload.messageId,
          role: event.payload.role,
          text: event.payload.text,
          attachments: event.payload.attachments ?? [],
          turnId: event.payload.turnId,
          streaming: event.payload.streaming,
          createdAt: event.payload.createdAt,
          updatedAt: event.payload.updatedAt,
        }),
        updatedAt: event.payload.updatedAt,
      };
    case "thread.session-set":
      return { ...thread, session: event.payload.session, updatedAt: event.occurredAt };
    case "thread.session-stop-requested":
      return thread.session
        ? {
            ...thread,
            session: { ...thread.session, status: "stopped", updatedAt: event.payload.createdAt },
          }
        : thread;
    case "thread.proposed-plan-upserted":
      return {
        ...thread,
        proposedPlans: upsertById(thread.proposedPlans, event.payload.proposedPlan),
      };
    case "thread.turn-diff-completed":
      return {
        ...thread,
        checkpoints: upsertByTurnId(thread.checkpoints, {
          turnId: event.payload.turnId,
          checkpointTurnCount: event.payload.checkpointTurnCount,
          checkpointRef: event.payload.checkpointRef,
          status: event.payload.status,
          files: event.payload.files,
          assistantMessageId: event.payload.assistantMessageId,
          completedAt: event.payload.completedAt,
        }),
      };
    case "thread.activity-appended":
      return {
        ...thread,
        activities: upsertActivity(thread.activities, event.payload.activity),
      };
    default:
      return thread;
  }
}

export function isSnapshotRequiredThreadEvent(item: OrchestrationThreadStreamItem): boolean {
  return item.kind === "event" && item.event.type === "thread.reverted";
}

function upsertById<
  T extends OrchestrationMessage | { readonly id: string; readonly createdAt: string },
>(values: readonly T[], value: T): T[] {
  const existing = values.find((entry) => entry.id === value.id);
  if (existing && structuralEqual(existing, value)) return values as T[];
  return [...values.filter((entry) => entry.id !== value.id), value].toSorted((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

function upsertMessage(
  values: readonly OrchestrationMessage[],
  value: OrchestrationMessage,
): OrchestrationMessage[] {
  const existing = values.find((entry) => entry.id === value.id);
  if (!existing) return upsertById(values, value);
  const next: OrchestrationMessage = {
    ...existing,
    text: value.streaming
      ? `${existing.text}${value.text}`
      : value.text.length > 0
        ? value.text
        : existing.text,
    streaming: value.streaming,
    turnId: value.turnId,
    attachments: value.attachments,
    updatedAt: value.updatedAt,
  };
  if (structuralEqual(existing, next)) return values as OrchestrationMessage[];
  return upsertById(values, next);
}

function upsertByTurnId<T extends { readonly turnId: string; readonly completedAt: string }>(
  values: readonly T[],
  value: T,
): T[] {
  return [...values.filter((entry) => entry.turnId !== value.turnId), value].toSorted(
    (left, right) => left.completedAt.localeCompare(right.completedAt),
  );
}

function upsertActivity(
  values: readonly OrchestrationThreadActivity[],
  value: OrchestrationThreadActivity,
): OrchestrationThreadActivity[] {
  const existing = values.find((entry) => entry.id === value.id);
  if (existing && structuralEqual(existing, value)) return values as OrchestrationThreadActivity[];
  return [...values.filter((entry) => entry.id !== value.id), value].toSorted((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

function isAssistantStreamingMessageEvent(
  item: OrchestrationThreadStreamItem | ThreadEventItem,
): boolean {
  return (
    item.kind === "event" &&
    item.event.type === "thread.message-sent" &&
    item.event.payload.role === "assistant" &&
    item.event.payload.streaming === true
  );
}

function isSameStreamingMessage(
  left: OrchestrationThreadStreamItem | ThreadEventItem,
  right: ThreadEventItem,
): left is ThreadEventItem {
  const leftPayload = left.kind === "event" ? (left.event.payload as Record<string, unknown>) : {};
  const rightPayload = right.event.payload as Record<string, unknown>;
  return isAssistantStreamingMessageEvent(left) && leftPayload.messageId === rightPayload.messageId;
}

function mergeStreamingMessageEvent(
  left: ThreadEventItem,
  right: ThreadEventItem,
): OrchestrationThreadStreamItem {
  const leftPayload = left.event.payload as Record<string, unknown>;
  const rightPayload = right.event.payload as Record<string, unknown>;
  return {
    kind: "event",
    event: {
      ...right.event,
      payload: {
        ...rightPayload,
        text: `${String(leftPayload.text ?? "")}${String(rightPayload.text ?? "")}`,
      },
    },
  } as OrchestrationThreadStreamItem;
}

function structuralEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  return JSON.stringify(left) === JSON.stringify(right);
}
