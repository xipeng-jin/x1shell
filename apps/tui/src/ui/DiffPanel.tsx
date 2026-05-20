import { createMemo, type JSX } from "solid-js";
import type { TuiTheme } from "../terminal/theme.js";

export function DiffPanel(props: {
  readonly title: string;
  readonly text: string;
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly theme: TuiTheme;
}): JSX.Element {
  const renderedLines = createMemo(() =>
    props.text.split("\n").slice(0, 16).map(diffLineWithUniqueKey()),
  );

  return (
    <box border borderColor={props.theme.palette.border} paddingLeft={1} flexDirection="column">
      <text fg={props.theme.palette.accent} attributes={1}>
        {props.title}
      </text>
      {props.loading ? <text fg={props.theme.palette.muted}>Loading diff...</text> : null}
      {props.error ? <text fg={props.theme.palette.danger}>{props.error}</text> : null}
      {renderedLines().map(({ line }) => (
        <text fg={props.theme.palette.text}>{line}</text>
      ))}
    </box>
  );
}

function diffLineWithUniqueKey(): (line: string) => {
  readonly key: string;
  readonly line: string;
} {
  const occurrenceByLine = new Map<string, number>();
  return (line) => {
    const occurrence = occurrenceByLine.get(line) ?? 0;
    occurrenceByLine.set(line, occurrence + 1);
    return { key: `${line}:${occurrence}`, line };
  };
}
