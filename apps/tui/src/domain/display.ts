import type {
  OrchestrationMessage,
  OrchestrationProjectShell,
  OrchestrationProposedPlan,
  OrchestrationThread,
  OrchestrationThreadActivity,
  OrchestrationThreadShell,
} from "@t3tools/contracts";
import { redactText } from "../runtime/redaction.js";
import { renderSafeMarkdown } from "../terminal/safeMarkdown.js";
import { sanitizeText } from "../terminal/safeTextStream.js";

export function displayText(value: string | null | undefined): string {
  return sanitizeText(redactText(value ?? ""));
}

export function displayProject(project: OrchestrationProjectShell) {
  return {
    title: displayText(project.title),
    workspaceRoot: displayText(project.workspaceRoot),
  };
}

export function displayThread(thread: OrchestrationThreadShell | OrchestrationThread) {
  return {
    title: displayText(thread.title),
    branch: displayText(thread.branch ?? ""),
    worktreePath: displayText(thread.worktreePath ?? ""),
    model: displayText(thread.modelSelection.model),
    provider: displayText(thread.modelSelection.provider),
    session:
      thread.session?.lastError != null
        ? `${thread.session.status}: ${displayText(thread.session.lastError)}`
        : (thread.session?.status ?? "idle"),
  };
}

export function displayMessage(message: OrchestrationMessage) {
  return {
    role: displayText(message.role),
    markdown: renderSafeMarkdown(redactText(message.text)),
  };
}

export function displayProposedPlan(plan: OrchestrationProposedPlan) {
  return {
    markdown: renderSafeMarkdown(redactText(plan.planMarkdown)),
  };
}

export function displayActivity(activity: OrchestrationThreadActivity) {
  return {
    kind: displayText(activity.kind),
    summary: displayText(activity.summary),
  };
}
