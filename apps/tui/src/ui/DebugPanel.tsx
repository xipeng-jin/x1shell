import type React from "react";
import type { TuiDebugEntry } from "../domain/debug.js";
import type { TuiTheme } from "../terminal/theme.js";

export function DebugPanel(props: {
  readonly entries: readonly TuiDebugEntry[];
  readonly theme: TuiTheme;
}): React.ReactNode {
  return (
    <box border borderColor={props.theme.palette.border} paddingLeft={1} flexDirection="column">
      <text fg={props.theme.palette.accent} attributes={1}>
        Debug Log
      </text>
      {props.entries.slice(-12).map((entry) => (
        <text
          key={`${entry.time}:${entry.message}`}
          fg={entry.level === "error" ? props.theme.palette.danger : props.theme.palette.muted}
        >
          {`${entry.time.slice(11, 19)} ${entry.level} ${entry.message}`}
        </text>
      ))}
    </box>
  );
}
