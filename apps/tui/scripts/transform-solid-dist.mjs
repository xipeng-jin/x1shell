import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { transformAsync } from "@babel/core";
import solid from "babel-preset-solid";

const entry = resolve(import.meta.dirname, "../dist/index.mjs");
const code = await readFile(entry, "utf8");
const transformed = await transformAsync(code, {
  filename: entry,
  configFile: false,
  babelrc: false,
  presets: [
    [
      solid,
      {
        moduleName: "@opentui/solid",
        generate: "universal",
      },
    ],
  ],
  sourceMaps: true,
});

if (!transformed?.code) {
  throw new Error("Solid JSX transform produced no output for apps/tui/dist/index.mjs");
}

await writeFile(entry, transformed.code);
if (transformed.map) {
  await writeFile(`${entry}.map`, JSON.stringify(transformed.map));
}
