#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const builtEntry = resolve(packageRoot, "dist/index.mjs");
const sourceEntry = resolve(packageRoot, "src/index.tsx");
const entry = existsSync(builtEntry) ? builtEntry : sourceEntry;

if ("Bun" in globalThis) {
  const module = await import(pathToFileURL(entry).href);
  await module.main();
} else {
  const result = spawnSync("bun", [entry, ...process.argv.slice(2)], {
    stdio: "inherit",
  });

  if (result.error) {
    if (result.error.code === "ENOENT") {
      console.error("x1shell requires Bun to run. Install Bun and try again.");
      process.exit(1);
    }

    throw result.error;
  }

  process.exit(result.status ?? 0);
}
