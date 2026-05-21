import { describe, expect, it } from "vitest";
import { TUI_ACTIONS } from "../domain/keybindings.js";
import {
  buildActionPaletteView,
  buildAddProjectBrowsePaletteView,
  buildAddProjectSourcesPaletteView,
  buildThemePaletteView,
  initialAddProjectBrowseQuery,
} from "./paletteViewModel.js";

describe("paletteViewModel", () => {
  it("builds normal action items without changing action identity", () => {
    const view = buildActionPaletteView({ actions: TUI_ACTIONS, query: "thread" });

    expect(view.mode).toBe("actions");
    expect(view.title).toBe("Command Palette");
    expect(view.query).toBe("thread");
    expect(view.items[0]).toMatchObject({
      kind: "action",
      id: TUI_ACTIONS[0]?.id,
      title: TUI_ACTIONS[0]?.label,
    });
  });

  it("builds the Phase 2 Add Project source selection", () => {
    const view = buildAddProjectSourcesPaletteView();

    expect(view).toMatchObject({
      mode: "add-project-sources",
      title: "Add project",
      groupLabel: "Sources",
    });
    expect(view.items).toEqual([
      {
        kind: "add-project-source",
        source: "local",
        title: "Local folder",
        description: "Browse a folder on disk",
      },
    ]);
  });

  it("builds Add Project browse mode without fetching directory entries", () => {
    const view = buildAddProjectBrowsePaletteView({ query: "~/Projects/" });

    expect(view).toEqual({
      mode: "add-project-browse",
      title: "Add project / Local folder",
      query: "~/Projects/",
      loading: false,
      error: null,
      items: [],
    });
  });

  it("derives the initial Add Project browse query", () => {
    expect(initialAddProjectBrowseQuery({ addProjectBaseDirectory: "~/Development" })).toBe(
      "~/Development/",
    );
    expect(initialAddProjectBrowseQuery({ addProjectBaseDirectory: "C:\\Work" })).toBe(
      "C:\\Work\\",
    );
    expect(initialAddProjectBrowseQuery({ addProjectBaseDirectory: "  " })).toBe("~/");
    expect(initialAddProjectBrowseQuery({ addProjectBaseDirectory: null })).toBe("~/");
  });

  it("builds filtered theme rows and marks the initially selected theme", () => {
    const view = buildThemePaletteView({
      themes: [
        { id: "opencode", name: "opencode" },
        { id: "tokyonight", name: "tokyonight" },
      ],
      selectedThemeId: "tokyonight",
      query: "night",
    });

    expect(view).toEqual({
      mode: "themes",
      title: "Themes",
      query: "night",
      items: [{ kind: "theme", id: "tokyonight", title: "tokyonight", selected: true }],
    });
  });
});
