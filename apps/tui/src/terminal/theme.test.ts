import { describe, expect, it } from "vitest";
import { resolveTheme } from "./theme.js";

describe("resolveTheme", () => {
  it("keeps the legacy dark landing palette by default", () => {
    const theme = resolveTheme(undefined);

    expect(theme.id).toBe("default");
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

  it("accepts terminal-match as a stable theme id until terminal colors are available", () => {
    const theme = resolveTheme("terminal-match");

    expect(theme.id).toBe("terminal-match");
    expect(theme.palette.canvas).toBe("#171717");
  });
});
