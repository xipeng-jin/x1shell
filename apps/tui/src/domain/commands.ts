import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type ApprovalRequestId,
  MessageId,
  ThreadId,
  type ClientOrchestrationCommand,
  type ModelSelection,
  type OrchestrationProjectShell,
  type OrchestrationThread,
  type OrchestrationThreadShell,
  type ProviderInteractionMode,
  type ProjectId,
  type ProviderApprovalDecision,
  type RuntimeMode,
  type UploadChatAttachment,
  type TurnId,
} from "@t3tools/contracts";
import { createModelSelection, resolveModelSlugForProvider } from "@t3tools/shared/model";
import {
  DEFAULT_TUI_PROVIDER_DRIVER,
  DEFAULT_TUI_PROVIDER_INSTANCE_ID,
} from "./providerInstances.js";

type ClientThreadTurnStartCommand = Extract<
  ClientOrchestrationCommand,
  { readonly type: "thread.turn.start" }
>;
type ThreadLike = OrchestrationThreadShell | OrchestrationThread;

export function buildExistingThreadTurnStart(input: {
  readonly thread: OrchestrationThreadShell;
  readonly text: string;
  readonly attachments?: readonly UploadChatAttachment[];
  readonly modelSelection?: ModelSelection;
  readonly runtimeMode?: RuntimeMode;
  readonly interactionMode?: ProviderInteractionMode;
  readonly now?: string;
}): ClientThreadTurnStartCommand {
  const createdAt = input.now ?? new Date().toISOString();
  return {
    type: "thread.turn.start",
    commandId: newCommandId(),
    threadId: input.thread.id,
    message: {
      messageId: newMessageId(),
      role: "user",
      text: input.text,
      attachments: [...(input.attachments ?? [])],
    },
    modelSelection: input.modelSelection ?? input.thread.modelSelection,
    runtimeMode: input.runtimeMode ?? input.thread.runtimeMode,
    interactionMode: input.interactionMode ?? input.thread.interactionMode,
    createdAt,
  };
}

export function buildThreadTurnInterrupt(input: {
  readonly threadId: ThreadId;
  readonly turnId?: TurnId | null;
  readonly now?: string;
}): Extract<ClientOrchestrationCommand, { readonly type: "thread.turn.interrupt" }> {
  return {
    type: "thread.turn.interrupt",
    commandId: newCommandId(),
    threadId: input.threadId,
    ...(input.turnId ? { turnId: input.turnId } : {}),
    createdAt: input.now ?? new Date().toISOString(),
  };
}

export function buildThreadApprovalResponse(input: {
  readonly threadId: ThreadId;
  readonly requestId: ApprovalRequestId;
  readonly decision: ProviderApprovalDecision;
  readonly now?: string;
}): Extract<ClientOrchestrationCommand, { readonly type: "thread.approval.respond" }> {
  return {
    type: "thread.approval.respond",
    commandId: newCommandId(),
    threadId: input.threadId,
    requestId: input.requestId,
    decision: input.decision,
    createdAt: input.now ?? new Date().toISOString(),
  };
}

export function buildThreadUserInputResponse(input: {
  readonly threadId: ThreadId;
  readonly requestId: ApprovalRequestId;
  readonly answers: Record<string, unknown>;
  readonly now?: string;
}): Extract<ClientOrchestrationCommand, { readonly type: "thread.user-input.respond" }> {
  return {
    type: "thread.user-input.respond",
    commandId: newCommandId(),
    threadId: input.threadId,
    requestId: input.requestId,
    answers: input.answers,
    createdAt: input.now ?? new Date().toISOString(),
  };
}

export function buildThreadSessionStop(input: {
  readonly threadId: ThreadId;
  readonly now?: string;
}): Extract<ClientOrchestrationCommand, { readonly type: "thread.session.stop" }> {
  return {
    type: "thread.session.stop",
    commandId: newCommandId(),
    threadId: input.threadId,
    createdAt: input.now ?? new Date().toISOString(),
  };
}

export function buildThreadArchive(input: {
  readonly threadId: ThreadId;
}): Extract<ClientOrchestrationCommand, { readonly type: "thread.archive" }> {
  return { type: "thread.archive", commandId: newCommandId(), threadId: input.threadId };
}

export function buildThreadUnarchive(input: {
  readonly threadId: ThreadId;
}): Extract<ClientOrchestrationCommand, { readonly type: "thread.unarchive" }> {
  return { type: "thread.unarchive", commandId: newCommandId(), threadId: input.threadId };
}

export function canArchiveThread(thread: ThreadLike | null | undefined): boolean {
  if (!thread || thread.archivedAt) return false;
  return !(thread.session?.status === "running" && thread.session.activeTurnId != null);
}

export function canStopThreadSession(thread: ThreadLike | null | undefined): boolean {
  return Boolean(thread?.session && thread.session.status !== "stopped");
}

export function buildNewThreadTurnStart(input: {
  readonly project: OrchestrationProjectShell;
  readonly text: string;
  readonly attachments?: readonly UploadChatAttachment[];
  readonly modelSelection?: ModelSelection;
  readonly runtimeMode?: RuntimeMode;
  readonly interactionMode?: ProviderInteractionMode;
  readonly titleSeed?: string;
  readonly now?: string;
}): ClientThreadTurnStartCommand {
  const createdAt = input.now ?? new Date().toISOString();
  const modelSelection = input.modelSelection ?? resolveProjectModelSelection(input.project);
  const runtimeMode = input.runtimeMode ?? DEFAULT_RUNTIME_MODE;
  const interactionMode = input.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE;
  const threadId = newThreadId();
  const titleSeed = (input.titleSeed ?? input.text.trim().slice(0, 80)) || "New thread";
  return {
    type: "thread.turn.start",
    commandId: newCommandId(),
    threadId,
    message: {
      messageId: newMessageId(),
      role: "user",
      text: input.text,
      attachments: [...(input.attachments ?? [])],
    },
    modelSelection,
    titleSeed,
    runtimeMode,
    interactionMode,
    bootstrap: {
      createThread: {
        projectId: input.project.id,
        title: titleSeed,
        modelSelection,
        runtimeMode,
        interactionMode,
        branch: null,
        worktreePath: input.project.workspaceRoot,
        createdAt,
      },
    },
    createdAt,
  };
}

export function buildThreadMetaUpdate(input: {
  readonly threadId: ThreadId;
  readonly title?: string;
  readonly modelSelection?: ModelSelection;
  readonly branch?: string | null;
  readonly worktreePath?: string | null;
}): Extract<ClientOrchestrationCommand, { readonly type: "thread.meta.update" }> {
  return {
    type: "thread.meta.update",
    commandId: newCommandId(),
    threadId: input.threadId,
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.modelSelection !== undefined ? { modelSelection: input.modelSelection } : {}),
    ...(input.branch !== undefined ? { branch: input.branch } : {}),
    ...(input.worktreePath !== undefined ? { worktreePath: input.worktreePath } : {}),
  };
}

export function buildThreadRuntimeModeSet(input: {
  readonly threadId: ThreadId;
  readonly runtimeMode: RuntimeMode;
  readonly now?: string;
}): Extract<ClientOrchestrationCommand, { readonly type: "thread.runtime-mode.set" }> {
  return {
    type: "thread.runtime-mode.set",
    commandId: newCommandId(),
    threadId: input.threadId,
    runtimeMode: input.runtimeMode,
    createdAt: input.now ?? new Date().toISOString(),
  };
}

export function buildThreadInteractionModeSet(input: {
  readonly threadId: ThreadId;
  readonly interactionMode: ProviderInteractionMode;
  readonly now?: string;
}): Extract<ClientOrchestrationCommand, { readonly type: "thread.interaction-mode.set" }> {
  return {
    type: "thread.interaction-mode.set",
    commandId: newCommandId(),
    threadId: input.threadId,
    interactionMode: input.interactionMode,
    createdAt: input.now ?? new Date().toISOString(),
  };
}

function resolveProjectModelSelection(project: OrchestrationProjectShell): ModelSelection {
  if (project.defaultModelSelection) return project.defaultModelSelection;
  return createModelSelection(
    DEFAULT_TUI_PROVIDER_INSTANCE_ID,
    resolveModelSlugForProvider(DEFAULT_TUI_PROVIDER_DRIVER, null),
  );
}

function randomUUID(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  throw new Error("crypto.randomUUID is unavailable.");
}

export const newCommandId = (): CommandId => CommandId.make(randomUUID());
export const newMessageId = (): MessageId => MessageId.make(randomUUID());
export const newThreadId = (): ThreadId => ThreadId.make(randomUUID());
export const asProjectId = (value: string): ProjectId => value as ProjectId;
