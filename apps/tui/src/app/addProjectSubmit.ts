import type {
  OrchestrationProjectShell,
  OrchestrationThreadShell,
  ProjectId,
} from "@t3tools/contracts";
import {
  findProjectByPath,
  isExplicitRelativeProjectPath,
  isUnsupportedWindowsProjectPath,
  resolveProjectPathForDispatch,
} from "@t3tools/shared/projectPaths";

export const UNSUPPORTED_WINDOWS_PROJECT_PATH_MESSAGE =
  "Windows-style paths are only supported on Windows.";
export const RELATIVE_PROJECT_PATH_REQUIRES_PROJECT_MESSAGE =
  "Relative paths require an active project.";

export function findTuiProjectByPath(
  projects: readonly OrchestrationProjectShell[],
  candidatePath: string,
): OrchestrationProjectShell | undefined {
  const match = findProjectByPath(
    projects.map((project) => ({ cwd: project.workspaceRoot, project })),
    candidatePath,
  );
  return match?.project;
}

export function getLatestVisibleThreadForProject(
  threads: readonly OrchestrationThreadShell[],
  projectId: ProjectId,
): OrchestrationThreadShell | null {
  return (
    threads
      .filter((thread) => thread.projectId === projectId && !thread.archivedAt)
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null
  );
}

export function resolveAddProjectSubmitPath(input: {
  readonly rawPath: string;
  readonly platform: string;
  readonly currentProjectWorkspaceRoot?: string | null;
}):
  | { readonly kind: "ok"; readonly cwd: string }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "empty" } {
  const rawPath = input.rawPath.trim();
  if (rawPath.length === 0) return { kind: "empty" };

  if (isUnsupportedWindowsProjectPath(rawPath, input.platform)) {
    return { kind: "error", message: UNSUPPORTED_WINDOWS_PROJECT_PATH_MESSAGE };
  }

  if (isExplicitRelativeProjectPath(rawPath) && !input.currentProjectWorkspaceRoot) {
    return { kind: "error", message: RELATIVE_PROJECT_PATH_REQUIRES_PROJECT_MESSAGE };
  }

  const cwd = resolveProjectPathForDispatch(rawPath, input.currentProjectWorkspaceRoot);
  return cwd.length === 0 ? { kind: "empty" } : { kind: "ok", cwd };
}
