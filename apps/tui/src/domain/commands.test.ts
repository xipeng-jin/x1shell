import { describe, expect, it, vi } from "vitest";
import { DEFAULT_MODEL, ProviderInstanceId } from "@t3tools/contracts";
import {
  buildProjectCreate,
  buildExistingThreadTurnStart,
  buildNewThreadTurnStart,
  buildThreadInteractionModeSet,
  buildThreadMetaUpdate,
  buildThreadRuntimeModeSet,
  buildThreadApprovalResponse,
  buildThreadArchive,
  buildThreadSessionStop,
  buildThreadTurnInterrupt,
  buildThreadUnarchive,
  buildThreadUserInputResponse,
  canArchiveThread,
  canStopThreadSession,
  newProjectId,
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
      modelSelection: { instanceId: "codex", model: "gpt-5" },
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
          modelSelection: { instanceId: "codex" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: "/repo/project",
        },
      },
    });
  });

  it("builds turn starts with draft controls and attachments", () => {
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000021")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000022");

    const command = buildExistingThreadTurnStart({
      now: "2026-04-28T12:00:00.000Z",
      text: "explain image",
      thread: threadShell("thread-a"),
      modelSelection: { instanceId: "codex", model: "gpt-5.1" } as never,
      runtimeMode: "approval-required",
      interactionMode: "plan",
      attachments: [
        {
          type: "image",
          name: "pasted-image",
          mimeType: "image/png",
          sizeBytes: 3,
          dataUrl: "data:image/png;base64,AAAA",
        },
      ],
    });

    expect(command).toMatchObject({
      modelSelection: { instanceId: "codex", model: "gpt-5.1" },
      runtimeMode: "approval-required",
      interactionMode: "plan",
      message: { attachments: [{ mimeType: "image/png", sizeBytes: 3 }] },
    });
  });

  it("builds web-equivalent project create commands", () => {
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000041")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000042");

    const projectId = newProjectId();
    const command = buildProjectCreate({
      projectId,
      cwd: "/repo/x1shell",
      now: "2026-04-28T12:00:00.000Z",
    });

    expect(projectId).toBe("00000000-0000-4000-8000-000000000041");
    expect(command).toEqual({
      type: "project.create",
      commandId: "00000000-0000-4000-8000-000000000042",
      projectId,
      title: "x1shell",
      workspaceRoot: "/repo/x1shell",
      createWorkspaceRootIfMissing: true,
      defaultModelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: DEFAULT_MODEL,
      },
      createdAt: "2026-04-28T12:00:00.000Z",
    });
  });

  it("keeps project create workspaceRoot canonical instead of display-redacting paths", () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValueOnce("00000000-0000-4000-8000-000000000043");

    const command = buildProjectCreate({
      projectId: "project-token-path" as never,
      cwd: "/repo/token=valid-path",
      now: "2026-04-28T12:00:00.000Z",
    });

    expect(command.workspaceRoot).toBe("/repo/token=valid-path");
    expect(command.title).toBe("token=valid-path");
  });

  it("builds Phase 8 model, runtime, and interaction commands", () => {
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000031")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000032")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000033");

    expect(
      buildThreadMetaUpdate({
        threadId: "thread-a" as never,
        modelSelection: { instanceId: "codex", model: "gpt-5.1" } as never,
      }),
    ).toMatchObject({ type: "thread.meta.update", modelSelection: { model: "gpt-5.1" } });
    expect(
      buildThreadRuntimeModeSet({
        threadId: "thread-a" as never,
        runtimeMode: "auto-accept-edits",
        now: "2026-04-28T12:00:00.000Z",
      }),
    ).toMatchObject({ type: "thread.runtime-mode.set", runtimeMode: "auto-accept-edits" });
    expect(
      buildThreadInteractionModeSet({
        threadId: "thread-a" as never,
        interactionMode: "plan",
        now: "2026-04-28T12:00:00.000Z",
      }),
    ).toMatchObject({ type: "thread.interaction-mode.set", interactionMode: "plan" });
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
    modelSelection: { instanceId: "codex", model: "gpt-5" },
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
