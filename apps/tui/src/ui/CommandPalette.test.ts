import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { TUI_ACTIONS } from "../domain/keybindings.js";
import { resolveTheme } from "../terminal/theme.js";
import { CommandPalette } from "./CommandPalette.js";

describe("CommandPalette", () => {
  it("renders normal command palette actions by default", () => {
    const palette = CommandPalette({
      actions: TUI_ACTIONS,
      query: "",
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
      actions: TUI_ACTIONS,
      mode: "add-project",
      query: "",
      selectedIndex: 0,
      theme: resolveTheme("dark"),
    });
    const text = flattenText(palette);

    expect(text).toContain("Add project");
    expect(text).toContain("Sources");
    expect(text).toContain("Local folder");
    expect(text).toContain("Browse a folder on disk");
    expect(text).not.toContain("New thread");
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
