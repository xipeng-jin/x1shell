import type React from "react";
import { createSafeTextStream, sanitizeText } from "./safeTextStream.js";

export interface SafeMarkdownSnapshot {
  snapshot: string;
}

export interface SafeMarkdownStream {
  push(chunk: string): SafeMarkdownSnapshot;
  flush(): SafeMarkdownSnapshot;
  reset(): void;
}

export function createSafeMarkdownStream(): SafeMarkdownStream {
  const textStream = createSafeTextStream();
  let markdownBuffer = "";

  const render = (): SafeMarkdownSnapshot => ({ snapshot: renderSafeMarkdown(markdownBuffer) });

  return {
    push: (chunk) => {
      markdownBuffer += textStream.push(chunk);
      return render();
    },
    flush: () => {
      markdownBuffer += textStream.flush();
      return render();
    },
    reset: () => {
      textStream.reset();
      markdownBuffer = "";
    },
  };
}

export function renderSafeMarkdown(markdown: string): string {
  const sanitized = sanitizeText(markdown);
  return neutralizeBareUrls(neutralizeMarkdownLinks(sanitized));
}

export function SafeMarkdown(props: { content: string; fg?: string }): React.ReactNode {
  const textProps = props.fg === undefined ? {} : { fg: props.fg };
  return (
    <text wrapMode="word" {...textProps}>
      {renderSafeMarkdown(props.content)}
    </text>
  );
}

function neutralizeMarkdownLinks(value: string): string {
  let output = "";
  let index = 0;

  while (index < value.length) {
    const image = value[index] === "!" && value[index + 1] === "[";
    const link = value[index] === "[";
    if (!image && !link) {
      output += value[index];
      index += 1;
      continue;
    }

    const labelStart = index + (image ? 2 : 1);
    const labelEnd = findClosing(value, labelStart, "]");
    if (labelEnd === null || value[labelEnd + 1] !== "(") {
      output += value[index];
      index += 1;
      continue;
    }

    const destinationEnd = findClosing(value, labelEnd + 2, ")");
    if (destinationEnd === null) {
      output += value[index];
      index += 1;
      continue;
    }

    const label = value.slice(labelStart, labelEnd).trim();
    output += image ? `[image: ${label || "image"}]` : label;
    index = destinationEnd + 1;
  }

  return output;
}

function neutralizeBareUrls(value: string): string {
  return value.replace(/\b(?:https?:\/\/|www\.)[^\s<>()]+/gi, (url) => breakUrl(url));
}

function breakUrl(url: string): string {
  return url.replace(/:\/\//, "://\u200B").replace(/\./g, ".\u200B");
}

function findClosing(value: string, start: number, close: "]" | ")"): number | null {
  for (let index = start; index < value.length; index += 1) {
    if (value[index] === "\\") {
      index += 1;
      continue;
    }
    if (value[index] === close) return index;
  }
  return null;
}
