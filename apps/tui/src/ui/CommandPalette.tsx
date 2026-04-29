import type React from "react";
import type { TuiActionDefinition } from "../domain/keybindings.js";
import { formatActionKeys } from "../domain/keybindings.js";
import type { TuiTheme } from "../terminal/theme.js";

export function CommandPalette(props: {
  readonly actions: readonly TuiActionDefinition[];
  readonly query: string;
  readonly selectedIndex: number;
  readonly theme: TuiTheme;
}): React.ReactNode {
  return (
    <box border borderColor={props.theme.palette.accent} paddingLeft={1} flexDirection="column">
      <text fg={props.theme.palette.accent} attributes={1}>
        {`Command Palette ${props.query ? `/ ${props.query}` : ""}`}
      </text>
      {props.actions.slice(0, 10).map((action, index) => (
        <text
          key={action.id}
          fg={index === props.selectedIndex ? props.theme.palette.accent : props.theme.palette.text}
        >
          {`${index === props.selectedIndex ? "> " : "  "}${formatActionKeys(action).padEnd(12)} ${action.label}`}
        </text>
      ))}
      {props.actions.length === 0 ? (
        <text fg={props.theme.palette.muted}>No matching actions.</text>
      ) : null}
    </box>
  );
}
