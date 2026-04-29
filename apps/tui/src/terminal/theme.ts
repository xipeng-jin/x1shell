export interface TuiTheme {
  id: string;
  palette: {
    canvas: string;
    sidebar: string;
    main: string;
    surface: string;
    composerPanel: string;
    divider: string;
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
  };
}

const DEFAULT_THEME: TuiTheme = {
  id: "default",
  palette: {
    canvas: "#171717",
    sidebar: "#151515",
    main: "#1c1c1c",
    surface: "#202020",
    composerPanel: "#1f1f1f",
    divider: "#343434",
    panel: "#202020",
    panelMuted: "#2a2a2a",
    border: "#3a3a3a",
    text: "#e7e4dc",
    muted: "#8d8a84",
    subtle: "#62605b",
    accent: "#d6d3cb",
    success: "#2ecc71",
    warning: "#f2b84b",
    info: "#4da3ff",
    danger: "#ff6b6b",
  },
};

export function resolveTheme(id: string | undefined): TuiTheme {
  return { ...DEFAULT_THEME, id: id?.trim() || DEFAULT_THEME.id };
}
