import type React from "react";
import { TUI_ACTIONS, formatActionKeys } from "../domain/keybindings.js";
import type { TuiTheme } from "../terminal/theme.js";

export function KeyboardHelp(props: { readonly theme: TuiTheme }): React.ReactNode {
  return (
    <box border borderColor={props.theme.palette.border} paddingLeft={1} flexDirection="column">
      <text fg={props.theme.palette.accent} attributes={1}>
        Keyboard Help
      </text>
      {TUI_ACTIONS.map((action) => (
        <text key={action.id} fg={props.theme.palette.muted}>
          {`${formatActionKeys(action).padEnd(14)} ${action.label}`}
        </text>
      ))}
    </box>
  );
}
