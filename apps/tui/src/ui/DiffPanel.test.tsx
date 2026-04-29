import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { resolveTheme } from "../terminal/theme.js";
import { DiffPanel } from "./DiffPanel.js";

describe("DiffPanel", () => {
  it("renders duplicate diff lines with unique index-qualified keys", () => {
    const panel = DiffPanel({
      title: "Diff",
      text: "+same\n+same\n-context",
      theme: resolveTheme("dark"),
    });
    if (!isValidElement(panel)) throw new Error("DiffPanel did not return a React element");

    const root = panel as ReactElement<{ readonly children: readonly ReactNode[] }>;
    const diffLines = root.props.children[3];
    if (!Array.isArray(diffLines)) throw new Error("DiffPanel did not render diff line elements");
    const lineKeys = diffLines.map((child) => (isValidElement(child) ? child.key : null));

    expect(lineKeys).toContain("+same:0");
    expect(lineKeys).toContain("+same:1");
    expect(new Set(lineKeys).size).toBe(lineKeys.length);
  });
});
