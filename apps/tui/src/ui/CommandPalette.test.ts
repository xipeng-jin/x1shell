import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { TUI_ACTIONS } from "../domain/keybindings.js";
import { resolveTheme } from "../terminal/theme.js";
import {
  buildActionPaletteView,
  buildAddProjectBrowsePaletteView,
  buildAddProjectSourcesPaletteView,
} from "../app/paletteViewModel.js";
import { CommandPalette } from "./CommandPalette.js";

describe("CommandPalette", () => {
  it("renders normal command palette actions by default", () => {
    const palette = CommandPalette({
      view: buildActionPaletteView({ actions: TUI_ACTIONS, query: "" }),
      selectedIndex: 0,
      theme: resolveTheme("dark"),
    });
    const text = flattenText(palette);

    expect(text).toContain("Command Palette");
    expect(text).toContain("New thread");
    expect(text).not.toContain("Add project");
  });

  it("renders Add Project source selection without normal actions", () => {
    const palette = CommandPalette({
      view: buildAddProjectSourcesPaletteView(),
      selectedIndex: 0,
      theme: resolveTheme("dark"),
    });
    const text = flattenText(palette);

    expect(text).toContain("Add project");
    expect(text).toContain("Sources");
    expect(text).toContain("Local folder");
    expect(text).toContain("Browse a folder on disk");
    expect(text).not.toContain("New thread");
    expect(text).not.toContain("Git URL");
    expect(text).not.toContain("GitHub");
    expect(text).not.toContain("GitLab");
  });

  it("renders Add Project browse mode with query and directory items", () => {
    const palette = CommandPalette({
      view: buildAddProjectBrowsePaletteView({
        query: "~/Code/",
        items: [
          { kind: "browse-up" },
          ...Array.from({ length: 12 }, (_, index) => ({
            kind: "browse-directory" as const,
            name: `repo-${index}`,
            fullPath: `/home/me/Code/repo-${index}`,
          })),
        ],
      }),
      selectedIndex: 0,
      theme: resolveTheme("dark"),
    });
    const text = flattenText(palette);

    expect(text).toContain("Add project / Local folder");
    expect(text).toContain("~/Code/");
    expect(text).toContain("..");
    expect(text).toContain("repo-0");
    expect(text).toContain("repo-11");
    expect(text).not.toContain("Filesystem browsing starts in a later phase.");
  });

  it("renders sanitized Add Project browse errors without the placeholder", () => {
    const palette = CommandPalette({
      view: buildAddProjectBrowsePaletteView({
        query: "~/Code/",
        error: "Failed token=secret \u001b]8;;https://evil.example\u0007link",
      }),
      selectedIndex: 0,
      theme: resolveTheme("dark"),
    });
    const text = flattenText(palette);

    expect(text).toContain("Failed");
    expect(text).toContain("link");
    expect(text).not.toContain("token=secret");
    expect(text).not.toContain("\u001b]8");
    expect(text).not.toContain("evil.example");
    expect(text).not.toContain("Filesystem browsing starts in a later phase.");
  });
});

function flattenText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map((child) => flattenText(child)).join("");
  if (!isValidElement(node)) return "";

  const element = node as ReactElement<{ readonly children?: ReactNode }>;
  return flattenText(element.props.children);
}
