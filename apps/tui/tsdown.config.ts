import { defineConfig } from "tsdown";
import { solidOpenTuiPlugin } from "./scripts/solid-rolldown-plugin.ts";

export default defineConfig({
  entry: ["src/index.tsx"],
  format: ["esm"],
  outDir: "dist",
  outExtensions: () => ({ js: ".mjs" }),
  sourcemap: true,
  clean: true,
  inlineOnly: false,
  noExternal: (id) => id.startsWith("@t3tools/"),
  plugins: [solidOpenTuiPlugin()],
});
