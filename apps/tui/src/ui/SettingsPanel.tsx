import type { JSX } from "solid-js";
import type { ServerConfig } from "@t3tools/contracts";
import { displayText } from "../domain/display.js";
import { driverLabel, providerLabel } from "../domain/providerInstances.js";
import type { TuiTheme } from "../terminal/theme.js";

export function SettingsPanel(props: {
  readonly config: ServerConfig | null;
  readonly theme: TuiTheme;
}): JSX.Element {
  return (
    <box border borderColor={props.theme.palette.border} paddingLeft={1} flexDirection="column">
      <text fg={props.theme.palette.accent} attributes={1}>
        Settings
      </text>
      <text
        fg={props.theme.palette.muted}
      >{`cwd ${displayText(props.config?.cwd ?? "unknown")}`}</text>
      <text
        fg={props.theme.palette.muted}
      >{`providers ${props.config?.providers.length ?? 0}`}</text>
      {(props.config?.providers ?? []).slice(0, 8).map((provider) => (
        <text fg={props.theme.palette.text}>
          {`${displayText(providerLabel(provider))} ${displayText(provider.instanceId)} ${displayText(driverLabel(provider.driver))} ${displayText(provider.status)} ${displayText(provider.auth.status)}`}
        </text>
      ))}
    </box>
  );
}
