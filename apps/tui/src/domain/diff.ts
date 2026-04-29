import type {
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetTurnDiffInput,
  OrchestrationThread,
  ThreadId,
} from "@t3tools/contracts";
import { safeOutputText } from "../runtime/log.js";

export type TuiDiffMode = "turn" | "full";

export function buildTurnDiffInput(
  thread: OrchestrationThread,
): OrchestrationGetTurnDiffInput | null {
  const checkpointTurnCount = thread.checkpoints.at(-1)?.checkpointTurnCount ?? 0;
  if (checkpointTurnCount <= 0) return null;
  return {
    threadId: thread.id,
    fromTurnCount: checkpointTurnCount - 1,
    toTurnCount: checkpointTurnCount,
  };
}

export function buildFullThreadDiffInput(
  thread: OrchestrationThread,
): OrchestrationGetFullThreadDiffInput | null {
  const checkpointTurnCount = thread.checkpoints.at(-1)?.checkpointTurnCount ?? 0;
  if (checkpointTurnCount <= 0) return null;
  return {
    threadId: thread.id,
    toTurnCount: checkpointTurnCount,
  };
}

export function diffCacheKey(input: {
  readonly threadId: ThreadId;
  readonly mode: TuiDiffMode;
  readonly fromTurnCount?: number;
  readonly toTurnCount: number;
}): string {
  return `${input.threadId}:${input.mode}:${input.fromTurnCount ?? 0}:${input.toTurnCount}`;
}

export function sanitizeDiffText(value: string, maxChars = 30_000): string {
  const text = safeOutputText(value);
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n[diff truncated]` : text;
}
