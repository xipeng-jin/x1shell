import { describe, expect, it } from "vitest";
import type { OrchestrationShellStreamItem } from "@t3tools/contracts";
import { applyShellItem, createOrchestrationStore } from "./orchestrationStore.js";

describe("TUI shell orchestration store", () => {
  it("applies snapshots, non-contiguous upserts/removes, and drops stale duplicates", () => {
    let state = createOrchestrationStore().getSnapshot();
    state = applyShellItem(state, { kind: "snapshot", snapshot: shellSnapshot(10, ["thread-a"]) });
    expect(state.lastAppliedSequence).toBe(10);
    expect(state.threads.map((thread) => thread.id)).toEqual(["thread-a"]);

    state = applyShellItem(state, {
      kind: "thread-upserted",
      sequence: 15,
      thread: threadShell("thread-b", "project-a", "Thread B"),
    });
    expect(state.lastAppliedSequence).toBe(15);
    expect(state.threads.map((thread) => thread.id).toSorted()).toEqual(["thread-a", "thread-b"]);

    const afterUpsert = state;
    state = applyShellItem(state, {
      kind: "thread-upserted",
      sequence: 15,
      thread: threadShell("thread-b", "project-a", "Duplicate"),
    });
    expect(state).toBe(afterUpsert);

    state = applyShellItem(state, {
      kind: "thread-removed",
      sequence: 23,
      threadId: "thread-a" as never,
    });
    expect(state.lastAppliedSequence).toBe(23);
    expect(state.threads.map((thread) => thread.id)).toEqual(["thread-b"]);

    state = applyShellItem(state, {
      kind: "project-removed",
      sequence: 21,
      projectId: "project-a" as never,
    });
    expect(state.threads.map((thread) => thread.id)).toEqual(["thread-b"]);
  });

  it("preserves draft state when reconnect snapshots replace shell state", () => {
    const store = createOrchestrationStore();
    store.applyShellItem({ kind: "snapshot", snapshot: shellSnapshot(1, ["thread-a"]) });
    store.setDraft("project-a" as never, "keep me");
    store.applyShellItem({ kind: "snapshot", snapshot: shellSnapshot(2, ["thread-b"]) });

    expect(store.getSnapshot().draftByProjectId["project-a"]).toBe("keep me");
    expect(store.getSnapshot().threads.map((thread) => thread.id)).toEqual(["thread-b"]);
  });

  it("ignores stale shell snapshots after newer live events", () => {
    const store = createOrchestrationStore();
    store.applyShellItem({ kind: "snapshot", snapshot: shellSnapshot(10, ["thread-a"]) });
    store.applyShellItem({
      kind: "thread-upserted",
      sequence: 15,
      thread: threadShell("thread-b", "project-a", "Thread B"),
    });
    store.applyShellItem({ kind: "snapshot", snapshot: shellSnapshot(12, ["thread-stale"]) });

    expect(store.getSnapshot().lastAppliedSequence).toBe(15);
    expect(
      store
        .getSnapshot()
        .threads.map((thread) => thread.id)
        .toSorted(),
    ).toEqual(["thread-a", "thread-b"]);
  });

  it("does not emit for stale shell events", () => {
    const store = createOrchestrationStore();
    let emissions = 0;
    store.subscribe(() => {
      emissions += 1;
    });
    store.applyShellItem({ kind: "snapshot", snapshot: shellSnapshot(10, ["thread-a"]) });
    store.applyShellItem({
      kind: "thread-upserted",
      sequence: 9,
      thread: threadShell("thread-a", "project-a", "stale"),
    });

    expect(emissions).toBe(2);
    expect(store.getSnapshot().threads[0]?.title).toBe("thread-a");
  });

  it("applies multiple shell items with one batch emission", () => {
    const store = createOrchestrationStore();
    let emissions = 0;
    store.subscribe(() => {
      emissions += 1;
    });
    store.applyShellItem({ kind: "snapshot", snapshot: shellSnapshot(10, ["thread-a"]) });
    store.applyShellItems([
      {
        kind: "thread-upserted",
        sequence: 12,
        thread: threadShell("thread-b", "project-a", "Thread B"),
      },
      {
        kind: "thread-upserted",
        sequence: 11,
        thread: threadShell("thread-stale", "project-a", "Stale"),
      },
      {
        kind: "thread-upserted",
        sequence: 17,
        thread: threadShell("thread-c", "project-a", "Thread C"),
      },
    ]);

    expect(emissions).toBe(3);
    expect(store.getSnapshot().lastAppliedSequence).toBe(17);
    expect(
      store
        .getSnapshot()
        .threads.map((thread) => thread.id)
        .toSorted(),
    ).toEqual(["thread-a", "thread-b", "thread-c"]);
  });

  it("reuses structurally equal shell upserts", () => {
    const store = createOrchestrationStore();
    store.applyShellItem({ kind: "snapshot", snapshot: shellSnapshot(10, ["thread-a"]) });
    const beforeThreads = store.getSnapshot().threads;
    store.applyShellItem({
      kind: "thread-upserted",
      sequence: 12,
      thread: threadShell("thread-a", "project-a", "thread-a"),
    });

    expect(store.getSnapshot().threads).toBe(beforeThreads);
  });

  it("keeps an explicit project draft selection on a new thread", () => {
    const store = createOrchestrationStore();
    store.applyShellItem({ kind: "snapshot", snapshot: shellSnapshot(1, ["thread-a"]) });
    store.createProjectDraft("project-a" as never);

    expect(store.getSnapshot()).toMatchObject({
      selectedProjectId: "project-a",
      selectedThreadId: null,
    });
  });

  it("selects a launch-cwd project draft on the first matching shell snapshot", () => {
    const store = createOrchestrationStore({ launchCwd: "/repo/project-b" });
    store.applyShellItem({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        updatedAt: "2026-04-28T00:00:00.000Z",
        projects: [
          projectShell("project-a", "/repo/project-a"),
          projectShell("project-b", "/repo/project-b"),
        ],
        threads: [
          threadShell("thread-a", "project-a", "Thread A"),
          threadShell("thread-b", "project-b", "Thread B"),
        ],
      },
    });

    expect(store.getSnapshot()).toMatchObject({
      selectedProjectId: "project-b",
      selectedThreadId: null,
    });
  });

  it("still prefers the launch-cwd project when live shell events arrive before the first snapshot", () => {
    const store = createOrchestrationStore({ launchCwd: "/repo/project-b" });
    store.applyShellItem({
      kind: "thread-upserted",
      sequence: 1,
      thread: threadShell("thread-a", "project-a", "Thread A"),
    });
    store.applyShellItem({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 2,
        updatedAt: "2026-04-28T00:00:00.000Z",
        projects: [
          projectShell("project-a", "/repo/project-a"),
          projectShell("project-b", "/repo/project-b"),
        ],
        threads: [
          threadShell("thread-a", "project-a", "Thread A"),
          threadShell("thread-b", "project-b", "Thread B"),
        ],
      },
    });

    expect(store.getSnapshot()).toMatchObject({
      selectedProjectId: "project-b",
      selectedThreadId: null,
    });
  });

  it("does not let a stale snapshot consume launch-cwd first-snapshot preference", () => {
    const store = createOrchestrationStore({ launchCwd: "/repo/project-b" });
    store.applyShellItem({
      kind: "thread-upserted",
      sequence: 5,
      thread: threadShell("thread-a", "project-a", "Thread A"),
    });
    store.applyShellItem({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 4,
        updatedAt: "2026-04-28T00:00:00.000Z",
        projects: [projectShell("project-a", "/repo/project-a")],
        threads: [threadShell("thread-a", "project-a", "Thread A")],
      },
    });
    store.applyShellItem({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 6,
        updatedAt: "2026-04-28T00:00:01.000Z",
        projects: [
          projectShell("project-a", "/repo/project-a"),
          projectShell("project-b", "/repo/project-b"),
        ],
        threads: [
          threadShell("thread-a", "project-a", "Thread A"),
          threadShell("thread-b", "project-b", "Thread B"),
        ],
      },
    });

    expect(store.getSnapshot()).toMatchObject({
      selectedProjectId: "project-b",
      selectedThreadId: null,
    });
  });

  it("skips invalid workspace roots while matching the launch cwd", () => {
    const store = createOrchestrationStore({ launchCwd: "/repo/project-b" });
    store.applyShellItem({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        updatedAt: "2026-04-28T00:00:00.000Z",
        projects: [projectShell("project-a", null), projectShell("project-b", "/repo/project-b")],
        threads: [
          threadShell("thread-a", "project-a", "Thread A"),
          threadShell("thread-b", "project-b", "Thread B"),
        ],
      },
    });

    expect(store.getSnapshot()).toMatchObject({
      selectedProjectId: "project-b",
      selectedThreadId: null,
    });
  });

  it("does not throw or consume launch-cwd preference when an early snapshot has invalid roots", () => {
    const store = createOrchestrationStore({ launchCwd: "/repo/project-b" });

    expect(() =>
      store.applyShellItem({
        kind: "snapshot",
        snapshot: {
          snapshotSequence: 1,
          updatedAt: "2026-04-28T00:00:00.000Z",
          projects: [projectShell("project-a", null)],
          threads: [threadShell("thread-a", "project-a", "Thread A")],
        },
      }),
    ).not.toThrow();

    store.applyShellItem({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 2,
        updatedAt: "2026-04-28T00:00:01.000Z",
        projects: [projectShell("project-a", null), projectShell("project-b", "/repo/project-b")],
        threads: [
          threadShell("thread-a", "project-a", "Thread A"),
          threadShell("thread-b", "project-b", "Thread B"),
        ],
      },
    });

    expect(store.getSnapshot()).toMatchObject({
      selectedProjectId: "project-b",
      selectedThreadId: null,
    });
  });

  it("does not reapply launch-cwd preference after the first shell snapshot", () => {
    const store = createOrchestrationStore({ launchCwd: "/repo/project-b" });
    store.applyShellItem({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 1,
        updatedAt: "2026-04-28T00:00:00.000Z",
        projects: [
          projectShell("project-a", "/repo/project-a"),
          projectShell("project-b", "/repo/project-b"),
        ],
        threads: [
          threadShell("thread-a", "project-a", "Thread A"),
          threadShell("thread-b", "project-b", "Thread B"),
        ],
      },
    });
    store.selectThread("thread-a" as never);
    store.applyShellItem({
      kind: "snapshot",
      snapshot: {
        snapshotSequence: 2,
        updatedAt: "2026-04-28T00:00:01.000Z",
        projects: [
          projectShell("project-a", "/repo/project-a"),
          projectShell("project-b", "/repo/project-b"),
        ],
        threads: [
          threadShell("thread-a", "project-a", "Thread A"),
          threadShell("thread-b", "project-b", "Thread B"),
        ],
      },
    });

    expect(store.getSnapshot()).toMatchObject({
      selectedProjectId: "project-a",
      selectedThreadId: "thread-a",
    });
  });

  it("falls back to the first project and thread when no project matches launch cwd", () => {
    const store = createOrchestrationStore({ launchCwd: "/repo/missing" });
    store.applyShellItem({ kind: "snapshot", snapshot: shellSnapshot(1, ["thread-a"]) });

    expect(store.getSnapshot()).toMatchObject({
      selectedProjectId: "project-a",
      selectedThreadId: "thread-a",
    });
  });

  it("preserves a launch project draft across later snapshots", () => {
    const store = createOrchestrationStore({ launchCwd: "/repo/project" });
    store.applyShellItem({ kind: "snapshot", snapshot: shellSnapshot(1, ["thread-a"]) });
    store.applyShellItem({ kind: "snapshot", snapshot: shellSnapshot(2, ["thread-b"]) });

    expect(store.getSnapshot()).toMatchObject({
      selectedProjectId: "project-a",
      selectedThreadId: null,
    });
  });

  it("does not let live thread upserts steal an explicit new-thread draft selection", () => {
    const store = createOrchestrationStore();
    store.applyShellItem({ kind: "snapshot", snapshot: shellSnapshot(1, ["thread-a"]) });
    store.createProjectDraft("project-a" as never);

    store.applyShellItem({
      kind: "thread-upserted",
      sequence: 2,
      thread: threadShell("thread-b", "project-a", "Thread B"),
    });

    expect(store.getSnapshot()).toMatchObject({
      selectedProjectId: "project-a",
      selectedThreadId: null,
    });
    expect(
      store
        .getSnapshot()
        .threads.map((thread) => thread.id)
        .toSorted(),
    ).toEqual(["thread-a", "thread-b"]);
  });

  it("promotes a project draft when its thread shell already exists", () => {
    const store = createOrchestrationStore();
    store.applyShellItem({ kind: "snapshot", snapshot: shellSnapshot(1, ["thread-a"]) });
    store.createProjectDraft("project-a" as never);
    store.applyShellItem({
      kind: "thread-upserted",
      sequence: 2,
      thread: threadShell("thread-b", "project-a", "Thread B"),
    });

    store.promoteProjectDraft("project-a" as never, "thread-b" as never);

    expect(store.getSnapshot()).toMatchObject({
      selectedProjectId: "project-a",
      selectedThreadId: "thread-b",
      pendingDraftThreadIdByProjectId: {},
    });
  });

  it("keeps a promoted draft selected until its thread shell arrives", () => {
    const store = createOrchestrationStore();
    store.applyShellItem({ kind: "snapshot", snapshot: shellSnapshot(1, ["thread-a"]) });
    store.createProjectDraft("project-a" as never);
    store.promoteProjectDraft("project-a" as never, "thread-b" as never);

    expect(store.getSnapshot()).toMatchObject({
      selectedProjectId: "project-a",
      selectedThreadId: "thread-b",
    });

    store.applyShellItem({
      kind: "thread-upserted",
      sequence: 2,
      thread: threadShell("thread-c", "project-a", "Unrelated Thread"),
    });
    expect(store.getSnapshot().selectedThreadId).toBe("thread-b");

    store.applyShellItem({
      kind: "thread-upserted",
      sequence: 3,
      thread: threadShell("thread-b", "project-a", "Thread B"),
    });
    expect(store.getSnapshot()).toMatchObject({
      selectedProjectId: "project-a",
      selectedThreadId: "thread-b",
      pendingDraftThreadIdByProjectId: {},
    });
  });
});

function shellSnapshot(sequence: number, threadIds: string[]) {
  return {
    snapshotSequence: sequence,
    updatedAt: "2026-04-28T00:00:00.000Z",
    projects: [projectShell("project-a")],
    threads: threadIds.map((id) => threadShell(id, "project-a", id)),
  } satisfies Extract<OrchestrationShellStreamItem, { kind: "snapshot" }>["snapshot"];
}

function projectShell(id: string, workspaceRoot: unknown = "/repo/project") {
  return {
    id,
    title: "Project",
    workspaceRoot,
    defaultModelSelection: { instanceId: "codex", model: "gpt-5" },
    scripts: [],
    createdAt: "2026-04-28T00:00:00.000Z",
    updatedAt: "2026-04-28T00:00:00.000Z",
  } as never;
}

function threadShell(id: string, projectId: string, title: string) {
  return {
    id,
    projectId,
    title,
    modelSelection: { instanceId: "codex", model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "main",
    worktreePath: "/repo/project",
    latestTurn: null,
    createdAt: "2026-04-28T00:00:00.000Z",
    updatedAt: "2026-04-28T00:00:00.000Z",
    archivedAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  } as never;
}
