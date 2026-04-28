import { describe, expect, it, vi } from "vitest";
import { buildExistingThreadTurnStart, buildNewThreadTurnStart } from "./commands.js";

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
});

function threadShell(id: string) {
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
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  } as never;
}
