import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import type { UploadChatAttachment } from "@t3tools/contracts";
import { safeOutputText } from "../runtime/log.js";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DATA_URL_PATTERN = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i;
const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export interface ParsedImageAttachment {
  readonly attachment: UploadChatAttachment;
  readonly sourceLabel: string;
}

export function parseImageAttachmentText(value: string): ParsedImageAttachment | null {
  const text = value.trim();
  const dataUrl = parseImageDataUrl(text);
  if (dataUrl) return dataUrl;
  return parseLocalImagePath(text);
}

function parseImageDataUrl(value: string): ParsedImageAttachment | null {
  const match = DATA_URL_PATTERN.exec(value);
  if (!match) return null;
  const mimeType = match[1]!.toLowerCase();
  const base64 = match[2]!.replace(/\s/g, "");
  const sizeBytes =
    Math.floor((base64.length * 3) / 4) -
    (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
  if (sizeBytes <= 0 || sizeBytes > MAX_IMAGE_BYTES) return null;
  return {
    attachment: {
      type: "image",
      name: "pasted-image",
      mimeType,
      sizeBytes,
      dataUrl: `data:${mimeType};base64,${base64}`,
    },
    sourceLabel: "pasted image",
  };
}

function parseLocalImagePath(value: string): ParsedImageAttachment | null {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !value.startsWith("file://")) return null;
  const path = parseLocalPath(value);
  if (!path) return null;
  const extension = Object.keys(MIME_BY_EXT).find((entry) => path.toLowerCase().endsWith(entry));
  if (!extension || /[\r\n]/.test(path)) return null;
  const file = readBoundedImage(path);
  if (!file) return null;
  const mimeType = MIME_BY_EXT[extension]!;
  return {
    attachment: {
      type: "image",
      name: safeOutputText(basename(path)).slice(0, 255) || "image",
      mimeType,
      sizeBytes: file.length,
      dataUrl: `data:${mimeType};base64,${file.toString("base64")}`,
    },
    sourceLabel: safeOutputText(path),
  };
}

function parseLocalPath(value: string): string | null {
  if (!value.startsWith("file://")) return value;
  try {
    const url = new URL(value);
    if (url.hostname && url.hostname !== "localhost") return null;
    return decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
}

function readBoundedImage(path: string): Buffer | null {
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_IMAGE_BYTES) return null;
    return readFileSync(path);
  } catch {
    return null;
  }
}
