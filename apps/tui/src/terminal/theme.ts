export interface TuiTheme {
  id: string;
  palette: {
    canvas: string;
    panel: string;
    panelMuted: string;
    border: string;
    text: string;
    muted: string;
    accent: string;
    danger: string;
  };
}

const DEFAULT_THEME: TuiTheme = {
  id: "default",
  palette: {
    canvas: "#101820",
    panel: "#16212b",
    panelMuted: "#1f2d38",
    border: "#34505f",
    text: "#e8f1f2",
    muted: "#8fa7b3",
    accent: "#f2b84b",
    danger: "#ff6b6b",
  },
};

export function resolveTheme(id: string | undefined): TuiTheme {
  return { ...DEFAULT_THEME, id: id?.trim() || DEFAULT_THEME.id };
}
