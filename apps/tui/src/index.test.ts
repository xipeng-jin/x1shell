import { describe, expect, it } from "vitest";
import { resolveStartupThemeId } from "./runtime/startupTheme.js";

describe("TUI startup theme resolution", () => {
  it("lets explicit config theme override persisted preferences", () => {
    expect(resolveStartupThemeId("tokyonight", "opencode")).toBe("tokyonight");
  });

  it("falls back to persisted preferences when no explicit theme is configured", () => {
    expect(resolveStartupThemeId(undefined, "opencode")).toBe("opencode");
  });
});
