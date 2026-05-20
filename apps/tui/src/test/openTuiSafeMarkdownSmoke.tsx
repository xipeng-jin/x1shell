import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { testRender } from "@opentui/solid";
import { createSafeMarkdownStream, SafeMarkdown } from "../terminal/safeMarkdown.js";

const framePath = process.argv[2];
if (!framePath) {
  throw new Error("frame path argument is required");
}

const frames: string[] = [];
const renderContent = async (content: string) => {
  const setup = await testRender(
    () => (
      <box width="100%" height="100%">
        <SafeMarkdown content={content} />
      </box>
    ),
    {
      width: 80,
      height: 16,
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
};

if (process.argv[3] === "split") {
  const stream = createSafeMarkdownStream();
  await renderContent(stream.push("before [lab").snapshot);
  await renderContent(stream.push("el](https://example.com)").snapshot);
} else if (process.argv[3] === "blocks") {
  await renderContent(
    [
      "## Heading",
      "",
      "- **bold** item",
      "1. _italic_ item",
      "> quoted text",
      "",
      "Keep safe_markdown.test.ts and foo_bar_baz intact.",
      "",
      "```ts",
      "const value = 1;",
      "```",
    ].join("\n"),
  );
} else if (process.argv[3] === "ordered-list") {
  await renderContent(["9. ninth item", "10. tenth item", "100. hundredth item"].join("\n"));
} else {
  await renderContent("[label](https://example.com) ![alt](https://image.test) https://bare.test");
}

await mkdir(dirname(framePath), { recursive: true });
await writeFile(framePath, frames.join("\n"), "utf8");
