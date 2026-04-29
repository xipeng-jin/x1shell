import type React from "react";
import type { TuiTheme } from "../terminal/theme.js";

export function DiffPanel(props: {
  readonly title: string;
  readonly text: string;
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly theme: TuiTheme;
}): React.ReactNode {
  return (
    <box border borderColor={props.theme.palette.border} paddingLeft={1} flexDirection="column">
      <text fg={props.theme.palette.accent} attributes={1}>
        {props.title}
      </text>
      {props.loading ? <text fg={props.theme.palette.muted}>Loading diff...</text> : null}
      {props.error ? <text fg={props.theme.palette.danger}>{props.error}</text> : null}
      {props.text
        .split("\n")
        .slice(0, 16)
        .map((line) => (
          <text key={line} fg={props.theme.palette.text}>
            {line}
          </text>
        ))}
    </box>
  );
}
