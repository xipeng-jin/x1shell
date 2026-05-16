import type {
  OrchestrationMessage,
  OrchestrationProjectShell,
  OrchestrationProposedPlan,
  OrchestrationThread,
  OrchestrationThreadActivity,
  OrchestrationThreadShell,
} from "@t3tools/contracts";
import { redactText } from "../runtime/redaction.js";
import { createSafeMarkdownStream, renderSafeMarkdown } from "../terminal/safeMarkdown.js";
import { createSafeTextStream, sanitizeText } from "../terminal/safeTextStream.js";

const TIMELINE_WINDOW = 100;

export function displayText(value: string | null | undefined): string {
  return sanitizeText(redactText(sanitizeText(value ?? "")));
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
    provider: displayText(thread.modelSelection.instanceId),
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

export interface ConversationDisplayCache {
  readonly buildTimeline: (thread: OrchestrationThread | null) => DisplayTimelineEntry[];
}

export type DisplayTimelineEntry =
  | {
      readonly kind: "message";
      readonly key: string;
      readonly createdAt: string;
      readonly role: string;
      readonly markdown: string;
    }
  | {
      readonly kind: "activity";
      readonly key: string;
      readonly createdAt: string;
      readonly activityKind: string;
      readonly tone: OrchestrationThreadActivity["tone"];
      readonly summary: string;
      readonly text: string;
    };

export function createConversationDisplayCache(input: { readonly windowSize?: number } = {}) {
  const windowSize = input.windowSize ?? TIMELINE_WINDOW;
  const markdownByKey = new Map<
    string,
    { raw: string; stream: ReturnType<typeof createSafeMarkdownStream>; rendered: string }
  >();
  const textByKey = new Map<
    string,
    { raw: string; stream: ReturnType<typeof createSafeTextStream>; rendered: string }
  >();

  const markdownFor = (key: string, raw: string) => {
    const redacted = redactText(raw);
    const existing = markdownByKey.get(key);
    if (existing && existing.raw === redacted) return existing.rendered;
    if (existing && redacted.startsWith(existing.raw)) {
      const rendered = existing.stream.push(redacted.slice(existing.raw.length)).snapshot;
      markdownByKey.set(key, { ...existing, raw: redacted, rendered });
      return rendered;
    }
    const stream = createSafeMarkdownStream();
    const rendered = stream.push(redacted).snapshot;
    markdownByKey.set(key, { raw: redacted, stream, rendered });
    return rendered;
  };

  const textFor = (key: string, raw: string) => {
    const redacted = redactText(raw);
    const existing = textByKey.get(key);
    if (existing && existing.raw === redacted) return existing.rendered;
    if (existing && redacted.startsWith(existing.raw)) {
      const rendered =
        existing.rendered + existing.stream.push(redacted.slice(existing.raw.length));
      textByKey.set(key, { ...existing, raw: redacted, rendered });
      return rendered;
    }
    const stream = createSafeTextStream();
    const rendered = stream.push(redacted);
    textByKey.set(key, { raw: redacted, stream, rendered });
    return rendered;
  };

  return {
    buildTimeline: (thread: OrchestrationThread | null): DisplayTimelineEntry[] => {
      if (!thread) return [];
      const rawEntries = [
        ...thread.messages.map((message) => ({
          kind: "message" as const,
          key: `message:${message.id}`,
          createdAt: message.createdAt,
          role: message.role,
          raw: message.text,
        })),
        ...thread.activities.map((activity) => ({
          kind: "activity" as const,
          key: `activity:${activity.id}`,
          createdAt: activity.createdAt,
          tone: activity.tone,
          rawKind: activity.kind,
          rawSummary: activity.summary,
          raw: `${activity.kind}: ${activity.summary}`,
        })),
        ...thread.proposedPlans.map((plan) => ({
          kind: "message" as const,
          key: `plan:${plan.id}`,
          createdAt: plan.createdAt,
          role: "plan",
          raw: plan.planMarkdown,
        })),
      ]
        .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt))
        .slice(-windowSize);
      const visibleKeys = new Set(rawEntries.map((entry) => entry.key));
      for (const key of markdownByKey.keys()) {
        if (!visibleKeys.has(key)) markdownByKey.delete(key);
      }
      for (const key of textByKey.keys()) {
        const timelineKey = key.endsWith(":role") ? key.slice(0, -5) : key;
        if (!visibleKeys.has(timelineKey)) textByKey.delete(key);
      }

      return rawEntries.map((entry) =>
        entry.kind === "message"
          ? {
              kind: "message",
              key: entry.key,
              createdAt: entry.createdAt,
              role: textFor(`${entry.key}:role`, entry.role),
              markdown: markdownFor(entry.key, entry.raw),
            }
          : {
              kind: "activity",
              key: entry.key,
              createdAt: entry.createdAt,
              activityKind: textFor(`${entry.key}:kind`, entry.rawKind),
              tone: entry.tone,
              summary: textFor(`${entry.key}:summary`, entry.rawSummary),
              text: textFor(entry.key, entry.raw),
            },
      );
    },
  } satisfies ConversationDisplayCache;
}
