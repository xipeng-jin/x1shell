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
  const content = renderSafeMarkdown(props.content);
  return props.fg === undefined ? (
    <SafeMarkdownBlocks content={content} />
  ) : (
    <SafeMarkdownBlocks content={content} fg={props.fg} />
  );
}

function SafeMarkdownBlocks(props: { content: string; fg?: string }): React.ReactNode {
  const fg = props.fg ?? "#ffffff";
  const muted = props.fg ?? "#a3a3a3";
  const lines = props.content.replace(/\r\n?/g, "\n").split("\n");
  const nodes: React.ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const fence = line.match(/^\s*```/);
    if (fence) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index] ?? "")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      nodes.push(
        <box
          key={`code:${index}:${nodes.length}`}
          border={["left"]}
          borderColor={muted}
          paddingLeft={1}
          marginTop={nodes.length === 0 ? 0 : 1}
          flexDirection="column"
        >
          {keyedLines(codeLines.length === 0 ? [""] : codeLines, "code").map(({ key, line }) => (
            <text key={key} fg={fg} wrapMode="char">
              {line}
            </text>
          ))}
        </box>,
      );
      continue;
    }

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      nodes.push(
        <text
          key={`heading:${index}`}
          fg={fg}
          wrapMode="word"
          marginTop={nodes.length === 0 ? 0 : 1}
        >
          <strong>{renderInlineMarkdown(heading[2] ?? "", fg)}</strong>
        </text>,
      );
      index += 1;
      continue;
    }

    const blockquote = line.match(/^\s{0,3}>\s?(.*)$/);
    if (blockquote) {
      const quoteLines = [blockquote[1] ?? ""];
      index += 1;
      while (index < lines.length) {
        const next = (lines[index] ?? "").match(/^\s{0,3}>\s?(.*)$/);
        if (!next) break;
        quoteLines.push(next[1] ?? "");
        index += 1;
      }
      nodes.push(
        <box
          key={`quote:${index}:${nodes.length}`}
          border={["left"]}
          borderColor={muted}
          paddingLeft={1}
          marginTop={nodes.length === 0 ? 0 : 1}
          flexDirection="column"
        >
          {keyedLines(quoteLines, "quote").map(({ key, line }) => (
            <text key={key} fg={muted} wrapMode="word">
              <em>{renderInlineMarkdown(line, muted)}</em>
            </text>
          ))}
        </box>,
      );
      continue;
    }

    const list = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (list) {
      const indent = Math.min(Math.floor((list[1]?.length ?? 0) / 2), 4);
      nodes.push(
        <box key={`list:${index}`} flexDirection="row" marginLeft={indent * 2}>
          <box width={3} flexShrink={0}>
            <text fg={muted}>{list[2]?.match(/^\d/) ? `${list[2]} ` : "•  "}</text>
          </box>
          <box flexGrow={1} minWidth={0}>
            <text fg={fg} wrapMode="word">
              {renderInlineMarkdown(list[3] ?? "", fg)}
            </text>
          </box>
        </box>,
      );
      index += 1;
      continue;
    }

    nodes.push(
      <text key={`text:${index}`} fg={fg} wrapMode="word">
        {renderInlineMarkdown(line, fg)}
      </text>,
    );
    index += 1;
  }

  return <box flexDirection="column">{nodes}</box>;
}

function renderInlineMarkdown(value: string, fg: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern =
    /(`[^`]+`|\*\*[^*]+\*\*|(?<![A-Za-z0-9])__[^_\s][^_]*?__(?![A-Za-z0-9])|\*[^*]+\*|(?<![A-Za-z0-9])_[^_\s][^_]*?_(?![A-Za-z0-9]))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    if (match.index > lastIndex) nodes.push(value.slice(lastIndex, match.index));
    const token = match[0];
    const key = `${match.index}:${token.length}`;
    if (token.startsWith("`")) {
      nodes.push(
        <span key={key} style={{ fg }}>
          {token.slice(1, -1)}
        </span>,
      );
    } else if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < value.length) nodes.push(value.slice(lastIndex));
  return nodes;
}

function keyedLines(
  lines: readonly string[],
  prefix: string,
): Array<{ key: string; line: string }> {
  const counts = new Map<string, number>();
  return lines.map((line) => {
    const count = counts.get(line) ?? 0;
    counts.set(line, count + 1);
    return { key: `${prefix}:${count}:${line}`, line };
  });
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
  return url.replace(/:\/\/(?!\u200B)/, "://\u200B").replace(/\.(?!\u200B)/g, ".\u200B");
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
