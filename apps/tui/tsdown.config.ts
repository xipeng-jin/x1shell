import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.tsx"],
  format: ["esm"],
  outDir: "dist",
  outExtensions: () => ({ js: ".mjs" }),
  sourcemap: true,
  clean: true,
  inlineOnly: false,
  noExternal: (id) => id.startsWith("@t3tools/"),
});
