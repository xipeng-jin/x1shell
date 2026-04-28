import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  MessageId,
  ThreadId,
  type ClientOrchestrationCommand,
  type ModelSelection,
  type OrchestrationProjectShell,
  type OrchestrationThreadShell,
  type ProjectId,
} from "@t3tools/contracts";
import { createModelSelection, resolveModelSlugForProvider } from "@t3tools/shared/model";

type ClientThreadTurnStartCommand = Extract<
  ClientOrchestrationCommand,
  { readonly type: "thread.turn.start" }
>;

export function buildExistingThreadTurnStart(input: {
  readonly thread: OrchestrationThreadShell;
  readonly text: string;
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
      attachments: [],
    },
    modelSelection: input.thread.modelSelection,
    runtimeMode: input.thread.runtimeMode,
    interactionMode: input.thread.interactionMode,
    createdAt,
  };
}

export function buildNewThreadTurnStart(input: {
  readonly project: OrchestrationProjectShell;
  readonly text: string;
  readonly titleSeed?: string;
  readonly now?: string;
}): ClientThreadTurnStartCommand {
  const createdAt = input.now ?? new Date().toISOString();
  const modelSelection = resolveProjectModelSelection(input.project);
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
      attachments: [],
    },
    modelSelection,
    titleSeed,
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    bootstrap: {
      createThread: {
        projectId: input.project.id,
        title: titleSeed,
        modelSelection,
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        branch: null,
        worktreePath: input.project.workspaceRoot,
        createdAt,
      },
    },
    createdAt,
  };
}

function resolveProjectModelSelection(project: OrchestrationProjectShell): ModelSelection {
  if (project.defaultModelSelection) return project.defaultModelSelection;
  return createModelSelection("codex", resolveModelSlugForProvider("codex", null));
}

function randomUUID(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  throw new Error("crypto.randomUUID is unavailable.");
}

export const newCommandId = (): CommandId => CommandId.make(randomUUID());
export const newMessageId = (): MessageId => MessageId.make(randomUUID());
export const newThreadId = (): ThreadId => ThreadId.make(randomUUID());
export const asProjectId = (value: string): ProjectId => value as ProjectId;
