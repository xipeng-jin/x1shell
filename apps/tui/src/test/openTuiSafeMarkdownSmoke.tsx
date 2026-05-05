import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot } from "@opentui/react";
import { act } from "react";
import { createSafeMarkdownStream, SafeMarkdown } from "../terminal/safeMarkdown.js";

const framePath = process.argv[2];
if (!framePath) {
  throw new Error("frame path argument is required");
}

const setup = await createTestRenderer({
  width: 80,
  height: 16,
  screenMode: "main-screen",
  consoleMode: "disabled",
  externalOutputMode: "passthrough",
});
const root = createRoot(setup.renderer);

try {
  const frames: string[] = [];
  const renderContent = async (content: string) => {
    act(() => {
      root.render(
        <box width="100%" height="100%">
          <SafeMarkdown content={content} />
        </box>,
      );
    });
    await setup.renderOnce();
    frames.push(setup.captureCharFrame());
  };

  if (process.argv[3] === "split") {
    const stream = createSafeMarkdownStream();
    await renderContent(stream.push("before [lab").snapshot);
    await renderContent(stream.push("el](https://example.com)").snapshot);
  } else {
    await renderContent(
      "[label](https://example.com) ![alt](https://image.test) https://bare.test",
    );
  }

  await mkdir(dirname(framePath), { recursive: true });
  await writeFile(framePath, frames.join("\n"), "utf8");
} finally {
  act(() => {
    root.unmount();
  });
  setup.renderer.destroy();
}
