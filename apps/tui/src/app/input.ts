import {
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  type ProjectId,
  type UploadChatAttachment,
} from "@t3tools/contracts";
import { displayText } from "../domain/display.js";
import { parseImageAttachmentText } from "../terminal/images.js";

const MAX_PALETTE_QUERY_LENGTH = 160;

export interface TuiKeyboardKey {
  readonly name: string;
  readonly sequence?: string;
  readonly ctrl?: boolean;
  readonly meta?: boolean;
}

export function isPlainTextSequence(key: TuiKeyboardKey): key is TuiKeyboardKey & {
  readonly sequence: string;
} {
  return !key.ctrl && !key.meta && typeof key.sequence === "string" && key.sequence.length > 0;
}

export function canHandlePrintableShortcut(input: {
  readonly composerText: string;
  readonly visiblePanel: null | "palette" | "help" | "diff" | "debug" | "settings";
  readonly keyName: string;
}): boolean {
  if (input.composerText.length > 0) return false;
  if (input.keyName === "?" || input.keyName === "," || input.keyName === "d") return true;
  if (input.visiblePanel === "diff" && (input.keyName === "t" || input.keyName === "f")) {
    return true;
  }
  return false;
}

export function parseComposerAttachmentInput(
  sequence: string,
  projectId: ProjectId | null,
): ReturnType<typeof parseImageAttachmentText> {
  if (!projectId) return null;
  return parseImageAttachmentText(sequence);
}

export function canAppendComposerAttachment(attachments: readonly UploadChatAttachment[]): boolean {
  return attachments.length < PROVIDER_SEND_TURN_MAX_ATTACHMENTS;
}

export function composerAttachmentLimitMessage(): string {
  return `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} images per message.`;
}

export function appendPaletteQuery(existing: string, sequence: string): string {
  return displayText(`${existing}${sequence}`).slice(0, MAX_PALETTE_QUERY_LENGTH);
}
