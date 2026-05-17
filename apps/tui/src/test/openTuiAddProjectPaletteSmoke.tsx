import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot } from "@opentui/react";
import { App } from "../app/App.js";
import { resolveTheme } from "../terminal/theme.js";

const framePath = process.argv[2];
if (!framePath) {
  throw new Error("frame path argument is required");
}

const theme = resolveTheme("dark");
const setup = await createTestRenderer({
  width: 120,
  height: 30,
  screenMode: "main-screen",
  consoleMode: "disabled",
  externalOutputMode: "passthrough",
  backgroundColor: theme.palette.canvas,
});
const root = createRoot(setup.renderer);

try {
  root.render(
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
    />,
  );
  await setup.renderOnce();

  let sourcesFrame = "";
  for (const y of [3, 4]) {
    for (let x = 24; x <= 33; x += 1) {
      await setup.mockMouse.click(x, y);
      await setup.renderOnce();
      sourcesFrame = setup.captureCharFrame();
      if (sourcesFrame.includes("Add project")) break;
    }
    if (sourcesFrame.includes("Add project")) break;
  }

  setup.mockInput.pressEnter();
  await setup.renderOnce();
  const browseFrame = await captureFrameContaining("workspace");

  await mkdir(dirname(framePath), { recursive: true });
  await writeFile(framePath, `${sourcesFrame}\n---\n${browseFrame}`, "utf8");
} finally {
  root.unmount();
  setup.renderer.destroy();
}

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
