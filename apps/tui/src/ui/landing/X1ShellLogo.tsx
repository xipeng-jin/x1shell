import { createMemo } from "solid-js";
import type { TuiTheme } from "../../terminal/theme.js";

const FULL_LOGO = [
  "▄▄▄   ▄▄▄   ▄▄▄▄  ▄▄▄▄▄▄▄ ▄▄▄   ▄▄▄  ▄▄▄▄▄▄▄ ▄▄▄      ▄▄▄      ",
  "████▄████ ▄█████ █████▀▀▀ ███   ███ ███▀▀▀▀▀ ███      ███      ",
  " ▀█████▀     ███  ▀████▄  █████████ ███▄▄    ███      ███      ",
  "▄███████▄    ███    ▀████ ███▀▀▀███ ███      ███      ███      ",
  "███▀ ▀███    ███ ███████▀ ███   ███ ▀███████ ████████ ████████ ",
] as const;

const FULL_LOGO_WIDTH = 63;
const COMPACT_LOGO = "X1SHELL";

export function X1ShellLogo(props: { viewportColumns: number; theme: TuiTheme }) {
  const showFullLogo = createMemo(() => props.viewportColumns >= FULL_LOGO_WIDTH + 8);
  const lines = createMemo(() => (showFullLogo() ? FULL_LOGO : [COMPACT_LOGO]));
  const width = createMemo(() => (showFullLogo() ? FULL_LOGO_WIDTH : COMPACT_LOGO.length));

  return (
    <box width="100%" height="100%" justifyContent="center" alignItems="center">
      <box width={width()} flexDirection="column" alignItems="center">
        {lines().map((line) => (
          <text fg={props.theme.palette.text}>{line}</text>
        ))}
      </box>
    </box>
  );
}
