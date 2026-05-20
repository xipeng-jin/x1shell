import { describe, expect, it } from "vitest";
import {
  resolveTheme,
  resolveThemeId,
  selectedListItemForeground,
  TUI_THEME_OPTIONS,
} from "./theme.js";

describe("resolveTheme", () => {
  it("keeps the legacy dark landing palette by default", () => {
    const theme = resolveTheme(undefined);

    expect(theme.id).toBe("dark");
    expect(theme.palette.canvas).toBe("#171717");
    expect(theme.palette.text).toBe("#f5f5f5");
  });

  it("resolves the legacy light landing palette", () => {
    const theme = resolveTheme(" light ");

    expect(theme.id).toBe("light");
    expect(theme.palette.canvas).toBe("#f5f5f5");
    expect(theme.palette.text).toBe("#171717");
    expect(theme.palette.composerBorder).toBe("#0891b2");
  });

  it("normalizes terminal-match to the selectable system theme id", () => {
    const theme = resolveTheme("terminal-match");

    expect(theme.id).toBe("system");
    expect(theme.palette.canvas).toBe("#171717");
  });

  it("exposes an OpenCode-compatible sorted theme list", () => {
    expect(TUI_THEME_OPTIONS.map((theme) => theme.id)).toContain("opencode");
    expect(TUI_THEME_OPTIONS.map((theme) => theme.id)).toContain("tokyonight");
    expect(TUI_THEME_OPTIONS).toEqual(
      [...TUI_THEME_OPTIONS].toSorted((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      ),
    );
  });

  it("maps OpenCode theme ids into the X1Shell palette shape", () => {
    const theme = resolveTheme("opencode");

    expect(theme.id).toBe("opencode");
    expect(theme.palette.canvas).toBe("#0a0a0a");
    expect(theme.palette.surface).toBe("#141414");
    expect(theme.palette.selectionActive).toBe("#fab283");
    expect(theme.palette.accent).toBe("#9d7cd8");
    expect(theme.palette.markdownText).toBe("#eeeeee");
  });

  it("uses explicit selected list item text before contrast fallback", () => {
    expect(selectedListItemForeground(resolveTheme("orng"))).toBe("#0a0a0a");
    expect(selectedListItemForeground(resolveTheme("opencode"))).toBe("#0a0a0a");
    expect(selectedListItemForeground(resolveTheme("solarized"))).toBe("#0a0a0a");
    expect(selectedListItemForeground(resolveTheme("cobalt2"))).toBe("#0a0a0a");
  });

  it("normalizes unknown theme ids to a selectable registry id", () => {
    expect(resolveThemeId(" opencode ")).toBe("opencode");
    expect(resolveThemeId("terminal-match")).toBe("system");
    expect(resolveThemeId("missing-theme")).toBe("dark");
  });
});
