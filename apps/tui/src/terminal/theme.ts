export interface TuiTheme {
  id: string;
  name?: string;
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
    selectedListItemText?: string;
    markdownText: string;
    markdownHeading: string;
    markdownLink: string;
    markdownLinkText: string;
    markdownCode: string;
    markdownBlockQuote: string;
    markdownEmph: string;
    markdownStrong: string;
    markdownHorizontalRule: string;
    markdownListItem: string;
    markdownListEnumeration: string;
    markdownImage: string;
    markdownImageText: string;
    markdownCodeBlock: string;
  };
}

export interface TuiThemeOption {
  readonly id: string;
  readonly name: string;
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
    markdownText: "#f5f5f5",
    markdownHeading: "#7c87ff",
    markdownLink: "#3b82f6",
    markdownLinkText: "#3b82f6",
    markdownCode: "#10b981",
    markdownBlockQuote: "#f59e0b",
    markdownEmph: "#f59e0b",
    markdownStrong: "#f59e0b",
    markdownHorizontalRule: "#737373",
    markdownListItem: "#3b82f6",
    markdownListEnumeration: "#3b82f6",
    markdownImage: "#3b82f6",
    markdownImageText: "#3b82f6",
    markdownCodeBlock: "#f5f5f5",
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
    markdownText: "#171717",
    markdownHeading: "#0891b2",
    markdownLink: "#2563eb",
    markdownLinkText: "#0891b2",
    markdownCode: "#059669",
    markdownBlockQuote: "#d97706",
    markdownEmph: "#d97706",
    markdownStrong: "#d97706",
    markdownHorizontalRule: "#8a8a8a",
    markdownListItem: "#2563eb",
    markdownListEnumeration: "#0891b2",
    markdownImage: "#2563eb",
    markdownImageText: "#0891b2",
    markdownCodeBlock: "#171717",
  },
};

const OPENCODE_THEME_SEEDS = [
  ["aura", "#0f0f0f", "#15141b", "#a277ff", "#a277ff", "#edecee", "#6d6d6d", "#2d2d2d", "#ff6767"],
  ["ayu", "#0B0E14", "#0F131A", "#59C2FF", "#E6B450", "#BFBDB6", "#565B66", "#6C7380", "#D95757"],
  [
    "carbonfox",
    "#161616",
    "#1a1a1a",
    "#33b1ff",
    "#ff7eb6",
    "#f2f4f8",
    "#7d848f",
    "#303030",
    "#ee5396",
  ],
  [
    "catppuccin",
    "#1e1e2e",
    "#181825",
    "#89b4fa",
    "#f5c2e7",
    "#cdd6f4",
    "#9399b2",
    "#313244",
    "#f38ba8",
  ],
  [
    "catppuccin-frappe",
    "#303446",
    "#292c3c",
    "#8da4e2",
    "#f4b8e4",
    "#c6d0f5",
    "#949cb8",
    "#414559",
    "#e78284",
  ],
  [
    "catppuccin-macchiato",
    "#24273a",
    "#1e2030",
    "#8aadf4",
    "#f5bde6",
    "#cad3f5",
    "#939ab7",
    "#363a4f",
    "#ed8796",
  ],
  [
    "cobalt2",
    "#193549",
    "#122738",
    "#0088ff",
    "#2affdf",
    "#ffffff",
    "#adb7c9",
    "#1f4662",
    "#ff0088",
  ],
  [
    "cursor",
    "#181818",
    "#141414",
    "#88c0d0",
    "#88c0d0",
    "#e4e4e4",
    "#8c8c8c",
    "#303030",
    "#e34671",
  ],
  [
    "dracula",
    "#282a36",
    "#21222c",
    "#bd93f9",
    "#8be9fd",
    "#f8f8f2",
    "#6272a4",
    "#44475a",
    "#ff5555",
  ],
  [
    "everforest",
    "#2d353b",
    "#333c43",
    "#a7c080",
    "#d699b6",
    "#d3c6aa",
    "#7a8478",
    "#859289",
    "#e67e80",
  ],
  [
    "flexoki",
    "#100F0F",
    "#1C1B1A",
    "#DA702C",
    "#8B7EC8",
    "#CECDC3",
    "#6F6E69",
    "#575653",
    "#D14D41",
  ],
  [
    "github",
    "#0d1117",
    "#010409",
    "#58a6ff",
    "#39c5cf",
    "#c9d1d9",
    "#8b949e",
    "#30363d",
    "#f85149",
  ],
  [
    "gruvbox",
    "#282828",
    "#3c3836",
    "#83a598",
    "#8ec07c",
    "#ebdbb2",
    "#928374",
    "#665c54",
    "#fb4934",
  ],
  [
    "kanagawa",
    "#1F1F28",
    "#2A2A37",
    "#7E9CD8",
    "#D27E99",
    "#DCD7BA",
    "#727169",
    "#54546D",
    "#E82424",
  ],
  [
    "lucent-orng",
    "#0a0a0a",
    "#141414",
    "#EC5B2B",
    "#FFF7F1",
    "#eeeeee",
    "#808080",
    "#EC5B2B",
    "#e06c75",
  ],
  [
    "material",
    "#263238",
    "#1e272c",
    "#82aaff",
    "#89ddff",
    "#eeffff",
    "#546e7a",
    "#37474f",
    "#f07178",
  ],
  [
    "matrix",
    "#0a0e0a",
    "#0e130d",
    "#2eff6a",
    "#c770ff",
    "#62ff94",
    "#8ca391",
    "#1e2a1b",
    "#ff4b4b",
  ],
  [
    "mercury",
    "#171721",
    "#10101a",
    "#8da4f5",
    "#8da4f5",
    "#dddde5",
    "#9d9da8",
    "#2f3240",
    "#fc92b4",
  ],
  [
    "monokai",
    "#272822",
    "#1e1f1c",
    "#66d9ef",
    "#a6e22e",
    "#f8f8f2",
    "#75715e",
    "#3e3d32",
    "#f92672",
  ],
  [
    "nightowl",
    "#011627",
    "#0b253a",
    "#82AAFF",
    "#c792ea",
    "#d6deeb",
    "#5f7e97",
    "#5f7e97",
    "#EF5350",
  ],
  ["nord", "#2E3440", "#3B4252", "#88C0D0", "#8FBCBB", "#ECEFF4", "#8B95A7", "#434C5E", "#BF616A"],
  [
    "one-dark",
    "#282c34",
    "#21252b",
    "#61afef",
    "#56b6c2",
    "#abb2bf",
    "#5c6370",
    "#393f4a",
    "#e06c75",
  ],
  [
    "opencode",
    "#0a0a0a",
    "#141414",
    "#fab283",
    "#9d7cd8",
    "#eeeeee",
    "#808080",
    "#484848",
    "#e06c75",
  ],
  ["orng", "#0a0a0a", "#141414", "#EC5B2B", "#FFF7F1", "#eeeeee", "#808080", "#EC5B2B", "#e06c75"],
  [
    "osaka-jade",
    "#111c18",
    "#1a2520",
    "#2DD5B7",
    "#549e6a",
    "#C1C497",
    "#53685B",
    "#3d4a44",
    "#FF5345",
  ],
  [
    "palenight",
    "#292d3e",
    "#1e2132",
    "#82aaff",
    "#89ddff",
    "#a6accd",
    "#676e95",
    "#32364a",
    "#f07178",
  ],
  [
    "rosepine",
    "#191724",
    "#1f1d2e",
    "#9ccfd8",
    "#ebbcba",
    "#e0def4",
    "#6e6a86",
    "#403d52",
    "#eb6f92",
  ],
  [
    "solarized",
    "#002b36",
    "#073642",
    "#268bd2",
    "#2aa198",
    "#839496",
    "#586e75",
    "#073642",
    "#dc322f",
  ],
  [
    "synthwave84",
    "#262335",
    "#1e1a29",
    "#36f9f6",
    "#b084eb",
    "#ffffff",
    "#848bbd",
    "#495495",
    "#fe4450",
  ],
  [
    "tokyonight",
    "#1a1b26",
    "#1e2030",
    "#82aaff",
    "#ff966c",
    "#c8d3f5",
    "#828bb8",
    "#737aa2",
    "#ff757f",
  ],
  [
    "vercel",
    "#000000",
    "#1A1A1A",
    "#0070F3",
    "#8E4EC6",
    "#EDEDED",
    "#878787",
    "#1F1F1F",
    "#E5484D",
  ],
  [
    "vesper",
    "#101010",
    "#101010",
    "#FFC799",
    "#FFC799",
    "#ffffff",
    "#A0A0A0",
    "#282828",
    "#FF8080",
  ],
  [
    "zenburn",
    "#3f3f3f",
    "#4f4f4f",
    "#8cd0d3",
    "#93e0e3",
    "#dcdccc",
    "#9f9f9f",
    "#5f5f5f",
    "#cc9393",
  ],
] as const;

export const TUI_THEME_OPTIONS: readonly TuiThemeOption[] = [
  { id: "dark", name: "dark" },
  { id: "light", name: "light" },
  { id: "system", name: "system" },
  ...OPENCODE_THEME_SEEDS.map(([id]) => ({ id, name: id })),
].toSorted((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

const OPENCODE_THEMES: ReadonlyMap<string, TuiTheme> = new Map(
  OPENCODE_THEME_SEEDS.map(([id, canvas, panel, primary, accent, text, muted, border, danger]) => [
    id,
    makeTheme({ id, canvas, panel, primary, accent, text, muted, border, danger }),
  ]),
);

export function resolveTheme(id: string | undefined): TuiTheme {
  const normalized = resolveThemeId(id);
  if (normalized === "light") return LIGHT_THEME;
  const opencodeTheme = OPENCODE_THEMES.get(normalized);
  if (opencodeTheme) return opencodeTheme;
  if (normalized === "system") {
    return { ...DEFAULT_THEME, id: normalized };
  }
  return { ...DEFAULT_THEME, id: normalized };
}

export function resolveThemeId(id: string | undefined): string {
  const normalized = id?.trim().toLowerCase();
  if (!normalized) return "dark";
  if (normalized === "terminal-match") return "system";
  return TUI_THEME_OPTIONS.some((theme) => theme.id === normalized) ? normalized : "dark";
}

export function selectedListItemForeground(
  theme: TuiTheme,
  background = theme.palette.selectionActive,
): string {
  if (theme.palette.selectedListItemText) return theme.palette.selectedListItemText;
  return contrastRatio(background, "#0a0a0a") >= contrastRatio(background, "#ffffff")
    ? "#0a0a0a"
    : "#ffffff";
}

function makeTheme(input: {
  readonly id: string;
  readonly canvas: string;
  readonly panel: string;
  readonly primary: string;
  readonly accent: string;
  readonly text: string;
  readonly muted: string;
  readonly border: string;
  readonly danger: string;
}): TuiTheme {
  const markdown = markdownPaletteForOpenCodeSeed(input);
  const element = tintHex(input.panel, input.text, 0.06);
  const active = tintHex(input.panel, input.primary, 0.18);
  const muted = ensureContrast(input.muted, input.panel);
  const danger = ensureContrast(input.danger, input.panel);
  return {
    id: input.id,
    name: input.id,
    palette: {
      ...DEFAULT_THEME.palette,
      canvas: input.canvas,
      sidebar: input.canvas,
      main: input.canvas,
      surface: input.panel,
      surfaceAlt: element,
      surfacePlan: input.panel,
      surfaceWarn: input.panel,
      surfaceInfo: input.panel,
      composerPanel: input.panel,
      composerBorder: input.primary,
      composerBorderMuted: tintHex(input.panel, input.text, 0.12),
      composerSend: input.primary,
      composerSendHover: input.accent,
      divider: tintHex(input.panel, input.text, 0.14),
      controlHover: element,
      controlActive: active,
      controlActiveStrong: tintHex(active, input.primary, 0.2),
      controlInset: input.canvas,
      popup: input.panel,
      selection: input.primary,
      selectionActive: input.primary,
      panel: input.panel,
      panelMuted: element,
      border: input.border,
      text: input.text,
      muted,
      subtle: muted,
      accent: input.accent,
      info: input.primary,
      danger,
      ...markdown,
      ...(input.id === "orng" || input.id === "lucent-orng"
        ? { selectedListItemText: "#0a0a0a" }
        : {}),
    },
  };
}

function markdownPaletteForOpenCodeSeed(input: {
  readonly primary: string;
  readonly accent: string;
  readonly text: string;
  readonly muted: string;
}) {
  return {
    markdownText: input.text,
    markdownHeading: input.accent,
    markdownLink: input.primary,
    markdownLinkText: input.accent,
    markdownCode: "#7fd88f",
    markdownBlockQuote: "#e5c07b",
    markdownEmph: "#e5c07b",
    markdownStrong: "#f5a742",
    markdownHorizontalRule: input.muted,
    markdownListItem: input.primary,
    markdownListEnumeration: input.accent,
    markdownImage: input.primary,
    markdownImageText: input.accent,
    markdownCodeBlock: input.text,
  };
}

function tintHex(base: string, overlay: string, alpha: number): string {
  const b = parseHexColor(base);
  const o = parseHexColor(overlay);
  if (!b || !o) return base;
  return toHex({
    r: Math.round(b.r + (o.r - b.r) * alpha),
    g: Math.round(b.g + (o.g - b.g) * alpha),
    b: Math.round(b.b + (o.b - b.b) * alpha),
  });
}

function relativeLuminance(hex: string): number {
  const color = parseHexColor(hex);
  if (!color) return 0;
  return (
    0.2126 * relativeLuminanceChannel(color.r) +
    0.7152 * relativeLuminanceChannel(color.g) +
    0.0722 * relativeLuminanceChannel(color.b)
  );
}

function contrastRatio(a: string, b: string): number {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

function ensureContrast(foreground: string, background: string, minimumRatio = 3): string {
  if (contrastRatio(foreground, background) >= minimumRatio) return foreground;
  return contrastRatio("#0a0a0a", background) >= contrastRatio("#ffffff", background)
    ? "#0a0a0a"
    : "#ffffff";
}

function relativeLuminanceChannel(value: number): number {
  const next = value / 255;
  return next <= 0.03928 ? next / 12.92 : ((next + 0.055) / 1.055) ** 2.4;
}

function parseHexColor(
  hex: string,
): { readonly r: number; readonly g: number; readonly b: number } | null {
  const value = hex.startsWith("#") ? hex.slice(1) : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null;
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function toHex(color: { readonly r: number; readonly g: number; readonly b: number }): string {
  return `#${[color.r, color.g, color.b]
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("")}`;
}
