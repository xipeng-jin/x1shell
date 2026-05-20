import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { testRender } from "@opentui/solid";
import { resolveTheme } from "../terminal/theme.js";
import { DiffPanel } from "../ui/DiffPanel.js";

const framePath = process.argv[2];
if (!framePath) throw new Error("frame path argument is required");

const setup = await testRender(
  () => <DiffPanel title="Diff" text={"+same\n+same\n-context"} theme={resolveTheme("dark")} />,
  {
    width: 50,
    height: 10,
    screenMode: "main-screen",
    consoleMode: "disabled",
    externalOutputMode: "passthrough",
  },
);
try {
  await setup.renderOnce();
  await mkdir(dirname(framePath), { recursive: true });
  await writeFile(framePath, setup.captureCharFrame(), "utf8");
} finally {
  setup.renderer.destroy();
}
