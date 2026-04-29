import { ApprovalRequestId, type OrchestrationThreadActivity } from "@t3tools/contracts";

export interface PendingApproval {
  readonly requestId: ApprovalRequestId;
  readonly requestKind: "command" | "file-read" | "file-change";
  readonly createdAt: string;
  readonly detail?: string;
}

export interface UserInputQuestion {
  readonly id: string;
  readonly header: string;
  readonly question: string;
  readonly options: ReadonlyArray<{ readonly label: string; readonly description: string }>;
  readonly multiSelect?: boolean;
}

export interface PendingUserInput {
  readonly requestId: ApprovalRequestId;
  readonly createdAt: string;
  readonly questions: ReadonlyArray<UserInputQuestion>;
}

export function derivePendingApprovals(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): PendingApproval[] {
  const open = new Map<ApprovalRequestId, PendingApproval>();
  for (const activity of [...activities].toSorted(compareActivities)) {
    const payload = objectPayload(activity.payload);
    const requestId = stringPayload(payload, "requestId");
    if (activity.kind === "approval.requested" && requestId) {
      const requestKind = requestKindFromPayload(payload);
      if (!requestKind) continue;
      const detail = stringPayload(payload, "detail");
      open.set(ApprovalRequestId.make(requestId), {
        requestId: ApprovalRequestId.make(requestId),
        requestKind,
        createdAt: activity.createdAt,
        ...(detail ? { detail } : {}),
      });
      continue;
    }
    if (activity.kind === "approval.resolved" && requestId) {
      open.delete(ApprovalRequestId.make(requestId));
      continue;
    }
    if (
      activity.kind === "provider.approval.respond.failed" &&
      requestId &&
      isStalePendingRequestFailureDetail(stringPayload(payload, "detail"))
    ) {
      open.delete(ApprovalRequestId.make(requestId));
    }
  }
  return [...open.values()].toSorted((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

export function derivePendingUserInputs(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): PendingUserInput[] {
  const open = new Map<ApprovalRequestId, PendingUserInput>();
  for (const activity of [...activities].toSorted(compareActivities)) {
    const payload = objectPayload(activity.payload);
    const requestId = stringPayload(payload, "requestId");
    if (activity.kind === "user-input.requested" && requestId) {
      const questions = parseQuestions(payload);
      if (questions.length === 0) continue;
      open.set(ApprovalRequestId.make(requestId), {
        requestId: ApprovalRequestId.make(requestId),
        createdAt: activity.createdAt,
        questions,
      });
      continue;
    }
    if (activity.kind === "user-input.resolved" && requestId) {
      open.delete(ApprovalRequestId.make(requestId));
      continue;
    }
    if (
      activity.kind === "provider.user-input.respond.failed" &&
      requestId &&
      isStalePendingRequestFailureDetail(stringPayload(payload, "detail"))
    ) {
      open.delete(ApprovalRequestId.make(requestId));
    }
  }
  return [...open.values()].toSorted((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

export function buildUserInputAnswers(input: {
  readonly pending: PendingUserInput;
  readonly selectedOptions: Readonly<Record<string, readonly number[]>>;
  readonly customAnswer?: string;
  readonly customAnswers?: Readonly<Record<string, string>>;
  readonly questionIds?: ReadonlySet<string>;
}): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  for (const question of input.pending.questions) {
    if (input.questionIds && !input.questionIds.has(question.id)) continue;
    const selected = input.selectedOptions[question.id] ?? [];
    const custom = (input.customAnswers?.[question.id] ?? input.customAnswer)?.trim();
    const labels = selected
      .map((index) => question.options[index]?.label)
      .filter((label): label is string => Boolean(label));
    if (labels.length > 0) {
      answers[question.id] = question.multiSelect ? labels : labels[0];
    } else if (custom) {
      answers[question.id] = custom;
    }
  }
  return answers;
}

function compareActivities(
  left: OrchestrationThreadActivity,
  right: OrchestrationThreadActivity,
): number {
  return (
    (left.sequence ?? 0) - (right.sequence ?? 0) ||
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

function objectPayload(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function stringPayload(payload: Record<string, unknown> | null, key: string): string | null {
  const value = payload?.[key];
  return typeof value === "string" ? value : null;
}

function requestKindFromPayload(
  payload: Record<string, unknown> | null,
): PendingApproval["requestKind"] | null {
  const kind = stringPayload(payload, "requestKind") ?? stringPayload(payload, "requestType");
  switch (kind) {
    case "command":
    case "command_execution_approval":
    case "exec_command_approval":
    case "dynamic_tool_call":
      return "command";
    case "file-read":
    case "file_read_approval":
      return "file-read";
    case "file-change":
    case "file_change_approval":
    case "apply_patch_approval":
      return "file-change";
    default:
      return null;
  }
}

function isStalePendingRequestFailureDetail(detail: string | null): boolean {
  const normalized = detail?.toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes("stale pending approval request") ||
    normalized.includes("stale pending user-input request") ||
    normalized.includes("unknown pending approval request") ||
    normalized.includes("unknown pending permission request") ||
    normalized.includes("unknown pending user-input request")
  );
}

function parseQuestions(payload: Record<string, unknown> | null): UserInputQuestion[] {
  const questions = payload?.questions;
  if (!Array.isArray(questions)) return [];
  return questions
    .map((entry): UserInputQuestion | null => {
      const question = objectPayload(entry);
      if (!question) return null;
      const id = stringPayload(question, "id");
      const header = stringPayload(question, "header");
      const text = stringPayload(question, "question");
      const rawOptions = question.options;
      if (!id || !header || !text || !Array.isArray(rawOptions)) return null;
      const options = rawOptions
        .map((option) => {
          const record = objectPayload(option);
          const label = stringPayload(record, "label");
          const description = stringPayload(record, "description");
          return label && description ? { label, description } : null;
        })
        .filter((option): option is UserInputQuestion["options"][number] => option !== null);
      if (options.length === 0) return null;
      const parsedQuestion: UserInputQuestion = {
        id,
        header,
        question: text,
        options,
      };
      if (question.multiSelect === true) {
        return Object.assign(parsedQuestion, { multiSelect: true });
      }
      return parsedQuestion;
    })
    .filter((question): question is UserInputQuestion => question !== null);
}
