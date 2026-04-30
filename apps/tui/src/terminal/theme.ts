export interface TuiTheme {
  id: string;
  palette: {
    canvas: string;
    sidebar: string;
    main: string;
    surface: string;
    surfaceAlt: string;
    surfacePlan: string;
    surfaceWarn: string;
    surfaceInfo: string;
    composerPanel: string;
    composerBorder: string;
    composerBorderMuted: string;
    composerSend: string;
    composerSendHover: string;
    composerStop: string;
    composerStopHover: string;
    divider: string;
    control: string;
    controlHover: string;
    controlActive: string;
    controlActiveStrong: string;
    controlInset: string;
    popup: string;
    scrim: string;
    cursor: string;
    selection: string;
    selectionActive: string;
    panel: string;
    panelMuted: string;
    border: string;
    text: string;
    muted: string;
    subtle: string;
    accent: string;
    success: string;
    warning: string;
    info: string;
    danger: string;
    claude: string;
    macRed: string;
    macYellow: string;
    macGreen: string;
  };
}

const DEFAULT_THEME: TuiTheme = {
  id: "dark",
  palette: {
    canvas: "#171717",
    sidebar: "#151515",
    main: "#171717",
    surface: "#1b1b1b",
    surfaceAlt: "#1f1f1f",
    surfacePlan: "#1f221c",
    surfaceWarn: "#262016",
    surfaceInfo: "#1d2026",
    composerPanel: "#1a1a1a",
    composerBorder: "#2a3f95",
    composerBorderMuted: "#313131",
    composerSend: "#2f438e",
    composerSendHover: "#3c57ba",
    composerStop: "#dc2626",
    composerStopHover: "#ef4444",
    divider: "#2d2d2d",
    control: "transparent",
    controlHover: "#202020",
    controlActive: "#292929",
    controlActiveStrong: "#1e1e1e",
    controlInset: "#141414",
    popup: "#1c1c1c",
    scrim: "#00000099",
    cursor: "#d4d4d4",
    selection: "#1f4f95",
    selectionActive: "#2b61b0",
    panel: "#1b1b1b",
    panelMuted: "#202020",
    border: "#252525",
    text: "#f5f5f5",
    muted: "#a3a3a3",
    subtle: "#737373",
    accent: "#7c87ff",
    success: "#10b981",
    warning: "#f59e0b",
    info: "#3b82f6",
    danger: "#ff6b6b",
    claude: "#d97757",
    macRed: "#ff5f57",
    macYellow: "#febc2e",
    macGreen: "#28c840",
  },
};

const LIGHT_THEME: TuiTheme = {
  id: "light",
  palette: {
    ...DEFAULT_THEME.palette,
    canvas: "#f5f5f5",
    sidebar: "#eeeeee",
    main: "#f7f7f7",
    surface: "#ffffff",
    surfaceAlt: "#f1f1f1",
    surfacePlan: "#eef6ec",
    surfaceWarn: "#fff5e6",
    surfaceInfo: "#eef4ff",
    composerPanel: "#ffffff",
    composerBorder: "#0891b2",
    composerBorderMuted: "#d0d0d0",
    composerSend: "#60a5fa",
    composerSendHover: "#3b82f6",
    divider: "#d8d8d8",
    controlHover: "#ebebeb",
    controlActive: "#e2e2e2",
    controlActiveStrong: "#cdcdcd",
    controlInset: "#e7e7e7",
    popup: "#ffffff",
    scrim: "#00000022",
    cursor: "#a3a3a3",
    selection: "#dbeafe",
    selectionActive: "#bfdbfe",
    panel: "#ffffff",
    panelMuted: "#f1f1f1",
    border: "#dddddd",
    text: "#171717",
    muted: "#666666",
    subtle: "#8a8a8a",
    accent: "#0891b2",
    success: "#059669",
    warning: "#d97706",
    info: "#2563eb",
    danger: "#dc2626",
    claude: "#c96d4d",
  },
};

export function resolveTheme(id: string | undefined): TuiTheme {
  const normalized = id?.trim().toLowerCase();
  if (normalized === "light") return LIGHT_THEME;
  if (normalized === "terminal-match" || normalized === "system") {
    return { ...DEFAULT_THEME, id: normalized };
  }
  return { ...DEFAULT_THEME, id: normalized || "default" };
}
