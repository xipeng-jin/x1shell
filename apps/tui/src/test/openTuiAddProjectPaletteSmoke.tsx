import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { testRender } from "@opentui/solid";
import { App } from "../app/App.js";
import { resolveTheme } from "../terminal/theme.js";

const framePath = process.argv[2];
if (!framePath) {
  throw new Error("frame path argument is required");
}

const theme = resolveTheme("dark");
const setup = await testRender(
  () => (
    <App
      interruptRequestToken={0}
      paths={{} as never}
      launchCwd="/repo/project"
      theme={theme}
      onBrowseFilesystem={async () => ({
        parentPath: "/home/tester",
        entries: [
          { name: "workspace", fullPath: "/home/tester/workspace", kind: "directory" },
          { name: "z-other", fullPath: "/home/tester/z-other", kind: "directory" },
        ],
      })}
      onRequestExit={() => {}}
    />
  ),
  {
    width: 120,
    height: 30,
    screenMode: "main-screen",
    consoleMode: "disabled",
    externalOutputMode: "passthrough",
    backgroundColor: theme.palette.canvas,
  },
);

try {
  await setup.renderOnce();

  let sourcesFrame = "";
  for (const y of [3, 4]) {
    for (let x = 24; x <= 33; x += 1) {
      await setup.mockMouse.click(x, y);
      await setup.renderOnce();
      sourcesFrame = await captureFrameContaining("Sources");
      if (sourcesFrame.includes("Sources")) break;
    }
    if (sourcesFrame.includes("Sources")) break;
  }

  setup.mockInput.pressEnter();
  await setup.renderOnce();
  setup.mockInput.pressKey("~");
  setup.mockInput.pressKey("/");
  const browseFrame = await captureFrameContaining("workspace");

  await mkdir(dirname(framePath), { recursive: true });
  await writeFile(framePath, `${sourcesFrame}\n---\n${browseFrame}`, "utf8");
} finally {
  setup.renderer.destroy();
}

process.exit(0);

async function captureFrameContaining(expected: string): Promise<string> {
  let frame = "";
  for (let attempt = 0; attempt < 25; attempt += 1) {
    await setup.renderOnce();
    frame = setup.captureCharFrame();
    if (frame.includes(expected)) return frame;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return frame;
}
