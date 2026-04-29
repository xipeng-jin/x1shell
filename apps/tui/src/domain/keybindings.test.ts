import { describe, expect, it } from "vitest";
import { TUI_ACTIONS, formatActionKeys, getActionDefinition } from "./keybindings.js";

describe("TUI keybinding action registry", () => {
  it("covers Phase 8 primary actions", () => {
    expect(TUI_ACTIONS.map((action) => action.id)).toEqual(
      expect.arrayContaining([
        "palette.open",
        "help.toggle",
        "diff.turn",
        "debug.toggle",
        "settings.toggle",
        "model.next",
        "runtime.next",
        "interaction.next",
        "providers.refresh",
        "git.refresh",
      ]),
    );
  });

  it("formats discoverable key labels", () => {
    expect(formatActionKeys(getActionDefinition("palette.open"))).toBe("ctrl+p");
  });
});
