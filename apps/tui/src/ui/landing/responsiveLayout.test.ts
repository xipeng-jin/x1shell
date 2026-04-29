import { describe, expect, it } from "vitest";
import { X1SHELL_SIDEBAR_WIDTH, resolveX1ShellLandingLayout } from "./responsiveLayout.js";

describe("resolveX1ShellLandingLayout", () => {
  it("keeps the full legacy-style launch layout in wide terminals", () => {
    expect(
      resolveX1ShellLandingLayout({
        viewportColumns: 160,
        sidebarCollapsedPreference: false,
      }),
    ).toEqual(
      expect.objectContaining({
        showSidebarToggle: false,
        sidebarForcedCollapsed: false,
        sidebarCollapsed: false,
        sidebarWidth: X1SHELL_SIDEBAR_WIDTH,
        showSidebar: true,
        showWindowDots: true,
        showSidebarAlphaBadge: true,
        sidebarTitle: "X1Shell",
        showHeaderProjectBadge: true,
        showComposerModeLabels: true,
        showComposerModelLabel: true,
        showComposerRuntimeLabel: true,
        showComposerDividers: true,
      }),
    );
  });

  it("forces the sidebar closed in narrow terminals", () => {
    expect(
      resolveX1ShellLandingLayout({
        viewportColumns: 78,
        sidebarCollapsedPreference: false,
      }),
    ).toEqual(
      expect.objectContaining({
        showSidebarToggle: true,
        sidebarForcedCollapsed: true,
        sidebarCollapsed: true,
        sidebarWidth: 0,
        showSidebar: false,
        showWindowDots: false,
        sidebarTitle: "X1",
      }),
    );
  });
});
