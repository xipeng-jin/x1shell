import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsdown";
import { solidOpenTuiPlugin } from "./scripts/solid-rolldown-plugin.ts";

const packageRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  entry: ["src/index.tsx"],
  format: ["esm"],
  outDir: "dist",
  outExtensions: () => ({ js: ".mjs" }),
  sourcemap: true,
  clean: true,
  inlineOnly: false,
  noExternal: (id) => id.startsWith("@t3tools/"),
  plugins: [solidOpenTuiPlugin(packageRoot)],
});
