import { describe, expect, it, vi } from "vitest";
import {
  buildExistingThreadTurnStart,
  buildNewThreadTurnStart,
  buildThreadApprovalResponse,
  buildThreadArchive,
  buildThreadSessionStop,
  buildThreadTurnInterrupt,
  buildThreadUnarchive,
  buildThreadUserInputResponse,
  canArchiveThread,
  canStopThreadSession,
} from "./commands.js";

describe("TUI orchestration command builders", () => {
  it("builds existing-thread turn starts with raw contract ids and selections", () => {
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000001")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000002");
    const command = buildExistingThreadTurnStart({
      now: "2026-04-28T12:00:00.000Z",
      text: "hello",
      thread: threadShell("thread-a"),
    });

    expect(command).toMatchObject({
      type: "thread.turn.start",
      commandId: "00000000-0000-4000-8000-000000000001",
      threadId: "thread-a",
      message: {
        messageId: "00000000-0000-4000-8000-000000000002",
        role: "user",
        text: "hello",
        attachments: [],
      },
      modelSelection: { provider: "codex", model: "gpt-5" },
      runtimeMode: "full-access",
      interactionMode: "default",
    });
  });

  it("builds new-thread bootstrap turn starts for the current project", () => {
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000003")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000001")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000002");
    const command = buildNewThreadTurnStart({
      now: "2026-04-28T12:00:00.000Z",
      text: "create it",
      project: {
        id: "project-a",
        title: "Project",
        workspaceRoot: "/repo/project",
        defaultModelSelection: null,
        scripts: [],
        createdAt: "2026-04-28T00:00:00.000Z",
        updatedAt: "2026-04-28T00:00:00.000Z",
      } as never,
    });

    expect(command).toMatchObject({
      type: "thread.turn.start",
      threadId: "00000000-0000-4000-8000-000000000003",
      bootstrap: {
        createThread: {
          projectId: "project-a",
          title: "create it",
          modelSelection: { provider: "codex" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: "/repo/project",
        },
      },
    });
  });

  it("builds Phase 7 action commands", () => {
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000011")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000012")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000013")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000014")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000015")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000016");

    expect(
      buildThreadTurnInterrupt({
        threadId: "thread-a" as never,
        turnId: "turn-a" as never,
        now: "2026-04-28T12:00:00.000Z",
      }),
    ).toMatchObject({ type: "thread.turn.interrupt", threadId: "thread-a", turnId: "turn-a" });
    expect(
      buildThreadApprovalResponse({
        threadId: "thread-a" as never,
        requestId: "request-a" as never,
        decision: "acceptForSession",
        now: "2026-04-28T12:00:00.000Z",
      }),
    ).toMatchObject({ type: "thread.approval.respond", decision: "acceptForSession" });
    expect(
      buildThreadUserInputResponse({
        threadId: "thread-a" as never,
        requestId: "request-b" as never,
        answers: { choice: "yes" },
        now: "2026-04-28T12:00:00.000Z",
      }),
    ).toMatchObject({ type: "thread.user-input.respond", answers: { choice: "yes" } });
    expect(buildThreadSessionStop({ threadId: "thread-a" as never })).toMatchObject({
      type: "thread.session.stop",
    });
    expect(buildThreadArchive({ threadId: "thread-a" as never })).toMatchObject({
      type: "thread.archive",
    });
    expect(buildThreadUnarchive({ threadId: "thread-a" as never })).toMatchObject({
      type: "thread.unarchive",
    });
  });

  it("matches web archive and stop command availability semantics", () => {
    expect(
      canArchiveThread(threadShell("thread-a", { status: "running", activeTurnId: "turn-a" })),
    ).toBe(false);
    expect(canArchiveThread(threadShell("thread-a"))).toBe(true);
    expect(
      canStopThreadSession(threadShell("thread-a", { status: "stopped", activeTurnId: null })),
    ).toBe(false);
    expect(
      canStopThreadSession(threadShell("thread-a", { status: "ready", activeTurnId: null })),
    ).toBe(true);
  });
});

function threadShell(
  id: string,
  session: { readonly status: string; readonly activeTurnId: string | null } | null = null,
) {
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
    session: session
      ? {
          threadId: id,
          providerName: "codex",
          runtimeMode: "full-access",
          lastError: null,
          updatedAt: "2026-04-28T00:00:00.000Z",
          ...session,
        }
      : null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  } as never;
}
