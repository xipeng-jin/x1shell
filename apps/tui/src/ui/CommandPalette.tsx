import type React from "react";
import type { TuiActionDefinition } from "../domain/keybindings.js";
import { formatActionKeys } from "../domain/keybindings.js";
import type { TuiTheme } from "../terminal/theme.js";

export function CommandPalette(props: {
  readonly actions: readonly TuiActionDefinition[];
  readonly mode?: "actions" | "add-project";
  readonly onAddProjectLocalFolder?: () => void;
  readonly query: string;
  readonly selectedIndex: number;
  readonly theme: TuiTheme;
}): React.ReactNode {
  if (props.mode === "add-project") {
    return (
      <box border borderColor={props.theme.palette.accent} paddingLeft={1} flexDirection="column">
        <text fg={props.theme.palette.accent} attributes={1}>
          Add project
        </text>
        <text fg={props.theme.palette.muted}>Sources</text>
        <box
          flexDirection="column"
          onMouseDown={() => {
            props.onAddProjectLocalFolder?.();
          }}
        >
          <text fg={props.theme.palette.accent}>{"> Local folder"}</text>
          <text fg={props.theme.palette.muted}> Browse a folder on disk</text>
        </box>
        <text fg={props.theme.palette.muted}>Press Enter to select. Esc closes.</text>
      </box>
    );
  }

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
