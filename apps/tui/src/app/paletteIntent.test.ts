import { describe, expect, it } from "vitest";
import { nextAddProjectPaletteIntent } from "./paletteIntent.js";

describe("paletteIntent", () => {
  it("creates a fresh add-project open intent", () => {
    expect(nextAddProjectPaletteIntent(null)).toEqual({
      kind: "add-project",
      requestId: 1,
    });
  });

  it("increments add-project request ids so repeated opens are consumable", () => {
    expect(nextAddProjectPaletteIntent({ kind: "add-project", requestId: 7 })).toEqual({
      kind: "add-project",
      requestId: 8,
    });
  });
});
