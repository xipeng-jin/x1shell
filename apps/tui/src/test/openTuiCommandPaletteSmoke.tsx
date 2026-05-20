import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { testRender } from "@opentui/solid";
import { TUI_ACTIONS } from "../domain/keybindings.js";
import {
  buildActionPaletteView,
  buildAddProjectBrowsePaletteView,
  buildAddProjectSourcesPaletteView,
} from "../app/paletteViewModel.js";
import { resolveTheme } from "../terminal/theme.js";
import { CommandPalette } from "../ui/CommandPalette.js";

const framePath = process.argv[2];
if (!framePath) throw new Error("frame path argument is required");

const theme = resolveTheme("dark");
const frames: string[] = [];

async function capture(
  view: Parameters<typeof CommandPalette>[0]["view"],
  extra: Partial<Parameters<typeof CommandPalette>[0]> = {},
) {
  const setup = await testRender(
    () => <CommandPalette view={view} selectedIndex={0} theme={theme} {...extra} />,
    {
      width: 80,
      height: 18,
      screenMode: "main-screen",
      consoleMode: "disabled",
      externalOutputMode: "passthrough",
    },
  );
  try {
    await setup.renderOnce();
    frames.push(setup.captureCharFrame());
  } finally {
    setup.renderer.destroy();
  }
}

await capture(buildActionPaletteView({ actions: TUI_ACTIONS, query: "" }));
await capture(buildAddProjectSourcesPaletteView());
await capture(
  buildAddProjectBrowsePaletteView({
    query: "~/Code/",
    items: [
      { kind: "browse-up" },
      { kind: "browse-directory", name: "workspace", fullPath: "/home/tester/workspace" },
    ],
  }),
  { highlightedItemValue: "browse:/home/tester/workspace" },
);
await capture(
  buildAddProjectBrowsePaletteView({
    query: "~/Code/token=secret\u001b]8;;https://evil.example\u0007link",
    error: "Failed token=secret \u001b]8;;https://evil.example\u0007link",
  }),
);

await mkdir(dirname(framePath), { recursive: true });
await writeFile(framePath, frames.join("\n---\n"), "utf8");
