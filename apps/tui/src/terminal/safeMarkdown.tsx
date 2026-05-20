import { createMemo, type JSX } from "solid-js";
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

export function SafeMarkdown(props: { content: string; fg?: string }): JSX.Element {
  const content = createMemo(() => renderSafeMarkdown(props.content));
  return props.fg === undefined ? (
    <SafeMarkdownBlocks content={content()} />
  ) : (
    <SafeMarkdownBlocks content={content()} fg={props.fg} />
  );
}

function SafeMarkdownBlocks(props: { content: string; fg?: string }): JSX.Element {
  const fg = props.fg ?? "#ffffff";
  const muted = props.fg ?? "#a3a3a3";
  const nodes = createMemo(() => {
    const lines = props.content.replace(/\r\n?/g, "\n").split("\n");
    const nodes: JSX.Element[] = [];
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
            border={["left"]}
            borderColor={muted}
            paddingLeft={1}
            marginTop={nodes.length === 0 ? 0 : 1}
            flexDirection="column"
          >
            {keyedLines(codeLines.length === 0 ? [""] : codeLines, "code").map(({ line }) => (
              <text fg={fg} wrapMode="char">
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
          <text fg={fg} wrapMode="word" marginTop={nodes.length === 0 ? 0 : 1}>
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
            border={["left"]}
            borderColor={muted}
            paddingLeft={1}
            marginTop={nodes.length === 0 ? 0 : 1}
            flexDirection="column"
          >
            {keyedLines(quoteLines, "quote").map(({ line }) => (
              <text fg={muted} wrapMode="word">
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
        const marker = list[2]?.match(/^\d/) ? `${list[2]} ` : "•  ";
        nodes.push(
          <box flexDirection="row" marginLeft={indent * 2}>
            <box width={Math.max(3, marker.length)} flexShrink={0}>
              <text fg={muted}>{marker}</text>
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
        <text fg={fg} wrapMode="word">
          {renderInlineMarkdown(line, fg)}
        </text>,
      );
      index += 1;
    }

    return nodes;
  });

  return <box flexDirection="column">{nodes()}</box>;
}
function renderInlineMarkdown(value: string, fg: string): JSX.Element[] {
  const nodes: JSX.Element[] = [];
  const pattern =
    /(`[^`]+`|\*\*[^*]+\*\*|(?<![A-Za-z0-9])__[^_\s][^_]*?__(?![A-Za-z0-9])|\*[^*]+\*|(?<![A-Za-z0-9])_[^_\s][^_]*?_(?![A-Za-z0-9]))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    if (match.index > lastIndex) nodes.push(value.slice(lastIndex, match.index));
    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(<span style={{ fg }}>{token.slice(1, -1)}</span>);
    } else if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(<strong>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<em>{token.slice(1, -1)}</em>);
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
    const fingerprint = stableLineFingerprint(line);
    const count = counts.get(fingerprint) ?? 0;
    counts.set(fingerprint, count + 1);
    return { key: `${prefix}:${fingerprint}:${count}`, line };
  });
}

function neutralizeMarkdownLinks(value: string): string {
  const output: string[] = [];
  let index = 0;

  while (index < value.length) {
    const image = value[index] === "!" && value[index + 1] === "[";
    const link = value[index] === "[";
    if (!image && !link) {
      output.push(value[index] ?? "");
      index += 1;
      continue;
    }

    const labelStart = index + (image ? 2 : 1);
    const labelEnd = findClosing(value, labelStart, "]");
    if (labelEnd === null || value[labelEnd + 1] !== "(") {
      output.push(value[index] ?? "");
      index += 1;
      continue;
    }

    const destinationEnd = findClosing(value, labelEnd + 2, ")");
    if (destinationEnd === null) {
      output.push(value[index] ?? "");
      index += 1;
      continue;
    }

    const label = value.slice(labelStart, labelEnd).trim();
    output.push(image ? `[image: ${label || "image"}]` : label);
    index = destinationEnd + 1;
  }

  return output.join("");
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

function stableLineFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${value.length}:${(hash >>> 0).toString(36)}`;
}
