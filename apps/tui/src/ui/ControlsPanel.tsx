import type React from "react";
import type {
  ModelSelection,
  ProviderInteractionMode,
  RuntimeMode,
  ServerProvider,
} from "@t3tools/contracts";
import { displayText } from "../domain/display.js";
import { providerLabel } from "../domain/providerInstances.js";
import type { TuiTheme } from "../terminal/theme.js";

export function ControlsPanel(props: {
  readonly provider: ServerProvider | null;
  readonly modelSelection: ModelSelection | null;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly attachmentCount: number;
  readonly theme: TuiTheme;
}): React.ReactNode {
  const providerName =
    (props.provider ? providerLabel(props.provider) : props.modelSelection?.instanceId) ??
    "no provider";
  const model = props.modelSelection?.model ?? "unset";
  return (
    <text fg={props.theme.palette.muted}>
      {`model ${displayText(providerName)}/${displayText(model)} | runtime ${props.runtimeMode} | mode ${props.interactionMode} | images ${props.attachmentCount}`}
    </text>
  );
}
