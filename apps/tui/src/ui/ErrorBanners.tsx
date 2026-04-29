import type React from "react";
import type { TuiErrorBanner } from "../domain/errors.js";
import type { TuiTheme } from "../terminal/theme.js";

export function ErrorBanners(props: {
  readonly banners: readonly TuiErrorBanner[];
  readonly theme: TuiTheme;
}): React.ReactNode {
  if (props.banners.length === 0) return null;
  return (
    <box flexDirection="column">
      {props.banners.map((banner) => (
        <text
          key={`${banner.title}:${banner.detail}`}
          fg={banner.kind === "danger" ? props.theme.palette.danger : props.theme.palette.accent}
        >
          {`${banner.title}: ${banner.detail}${banner.actionHint ? ` | ${banner.actionHint}` : ""}`}
        </text>
      ))}
    </box>
  );
}
