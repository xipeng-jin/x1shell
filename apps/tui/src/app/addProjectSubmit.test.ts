import { describe, expect, it } from "vitest";
import {
  findTuiProjectByPath,
  getLatestVisibleThreadForProject,
  RELATIVE_PROJECT_PATH_REQUIRES_PROJECT_MESSAGE,
  resolveAddProjectSubmitPath,
  UNSUPPORTED_WINDOWS_PROJECT_PATH_MESSAGE,
} from "./addProjectSubmit.js";

describe("TUI Add Project submit helpers", () => {
  it("finds existing projects by normalized workspace root", () => {
    expect(
      findTuiProjectByPath(
        [projectShell("project-a", "/repo/other"), projectShell("project-b", "/repo/x1shell/")],
        "/repo/x1shell",
      )?.id,
    ).toBe("project-b");
  });

  it("selects the latest visible thread with current TUI sidebar ordering", () => {
    expect(
      getLatestVisibleThreadForProject(
        [
          threadShell("thread-old", "project-a", "2026-04-28T00:00:00.000Z"),
          threadShell("thread-archived", "project-a", "2026-04-30T00:00:00.000Z", {
            archivedAt: "2026-05-01T00:00:00.000Z",
          }),
          threadShell("thread-new", "project-a", "2026-04-29T00:00:00.000Z"),
          threadShell("thread-other", "project-b", "2026-05-02T00:00:00.000Z"),
        ],
        "project-a" as never,
      )?.id,
    ).toBe("thread-new");
  });

  it("validates and resolves submit paths before dispatch", () => {
    expect(
      resolveAddProjectSubmitPath({
        rawPath: "C:\\Work\\Repo",
        platform: "Linux",
      }),
    ).toEqual({ kind: "error", message: UNSUPPORTED_WINDOWS_PROJECT_PATH_MESSAGE });

    expect(
      resolveAddProjectSubmitPath({
        rawPath: "./docs",
        platform: "Linux",
      }),
    ).toEqual({ kind: "error", message: RELATIVE_PROJECT_PATH_REQUIRES_PROJECT_MESSAGE });

    expect(
      resolveAddProjectSubmitPath({
        rawPath: "./docs",
        platform: "Linux",
        currentProjectWorkspaceRoot: "/repo/app",
      }),
    ).toEqual({ kind: "ok", cwd: "/repo/app/docs" });
  });
});

function projectShell(id: string, workspaceRoot: string) {
  return {
    id,
    title: id,
    workspaceRoot,
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-04-28T00:00:00.000Z",
    updatedAt: "2026-04-28T00:00:00.000Z",
  } as never;
}

function threadShell(
  id: string,
  projectId: string,
  updatedAt: string,
  options: { readonly archivedAt?: string | null } = {},
) {
  return {
    id,
    projectId,
    title: id,
    modelSelection: { instanceId: "codex", model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "main",
    worktreePath: "/repo/project",
    latestTurn: null,
    createdAt: "2026-04-28T00:00:00.000Z",
    updatedAt,
    archivedAt: options.archivedAt ?? null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  } as never;
}
