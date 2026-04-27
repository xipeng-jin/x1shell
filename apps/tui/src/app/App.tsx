import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type React from "react";
import { useEffect, useState } from "react";
import type { TuiPaths } from "../cli/config.js";
import { redactText } from "../runtime/redaction.js";
import { SafeMarkdown } from "../terminal/safeMarkdown.js";
import { sanitizeText } from "../terminal/safeTextStream.js";
import type { TuiTheme } from "../terminal/theme.js";

export function App(props: {
  interruptRequestToken: number;
  paths: TuiPaths;
  theme: TuiTheme;
  onRequestExit: () => void;
}): React.ReactNode {
  const dimensions = useTerminalDimensions();
  const [lastInterruptToken, setLastInterruptToken] = useState(props.interruptRequestToken);
  const compact = dimensions.width < 96;

  useEffect(() => {
    setLastInterruptToken(props.interruptRequestToken);
  }, [props.interruptRequestToken]);

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      setLastInterruptToken((current) => current + 1);
      return;
    }
    if (key.name === "q") {
      props.onRequestExit();
    }
  });

  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor={props.theme.palette.canvas}
    >
      <box
        height={3}
        paddingLeft={2}
        paddingRight={2}
        border
        borderColor={props.theme.palette.border}
      >
        <text fg={props.theme.palette.accent} attributes={1}>
          {`X1Shell Phase 2 boot | ${dimensions.width}x${dimensions.height}`}
        </text>
      </box>

      <box flexGrow={1} flexDirection={compact ? "column" : "row"}>
        <box
          width={compact ? "100%" : 30}
          height={compact ? 7 : "100%"}
          paddingLeft={2}
          paddingTop={1}
          border
          borderColor={props.theme.palette.border}
          backgroundColor={props.theme.palette.panel}
        >
          <text fg={props.theme.palette.text} attributes={1}>
            Workspace
          </text>
          <text fg={props.theme.palette.muted}>Static shell only</text>
          <text fg={props.theme.palette.muted}>No server connection in Phase 2</text>
        </box>

        <box
          flexGrow={1}
          paddingLeft={2}
          paddingTop={1}
          paddingRight={2}
          backgroundColor={props.theme.palette.canvas}
        >
          <text fg={props.theme.palette.text} attributes={1}>
            Renderer Ready
          </text>
          <text fg={props.theme.palette.muted}>
            Alternate screen, controlled cleanup, resize state, and safe text primitives are active.
          </text>
          <SafeMarkdown
            fg={props.theme.palette.text}
            content="Trusted smoke text: **safe markdown adapter** is available for later untrusted content."
          />
          <text fg={props.theme.palette.muted}>{`Config: ${safeDisplayText(
            props.paths.configDir,
          )}`}</text>
          <text
            fg={props.theme.palette.muted}
          >{`Logs: ${safeDisplayText(props.paths.logFile)}`}</text>
          <text
            fg={props.theme.palette.danger}
          >{`Interrupts observed: ${lastInterruptToken}`}</text>
        </box>
      </box>

      <box
        height={3}
        paddingLeft={2}
        paddingRight={2}
        border
        borderColor={props.theme.palette.border}
        backgroundColor={props.theme.palette.panelMuted}
      >
        <text fg={props.theme.palette.muted}>
          Ctrl+C records interrupt | q exits | headless frame supported
        </text>
      </box>
    </box>
  );
}

function safeDisplayText(value: string): string {
  return sanitizeText(redactText(value));
}
