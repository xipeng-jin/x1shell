#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const builtEntry = resolve(packageRoot, "dist/index.mjs");
const sourceEntry = resolve(packageRoot, "src/index.tsx");
const entry = existsSync(builtEntry) ? builtEntry : sourceEntry;
const minimumBunVersion = "1.3.11";

if ("Bun" in globalThis) {
  warnIfUnsupportedBunVersion(globalThis.Bun.version);
  const module = await import(pathToFileURL(entry).href);
  await module.main();
} else {
  const versionResult = spawnSync("bun", ["--version"], {
    encoding: "utf8",
  });

  if (versionResult.error) {
    if (versionResult.error.code === "ENOENT") {
      console.error("x1shell requires Bun to run. Install Bun and try again.");
      process.exit(1);
    }

    throw versionResult.error;
  }

  warnIfUnsupportedBunVersion(versionResult.stdout.trim());

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

function warnIfUnsupportedBunVersion(version) {
  if (compareVersions(version, minimumBunVersion) < 0) {
    console.error(
      `x1shell supports Bun >= ${minimumBunVersion}; resolved Bun ${version}. OpenTUI may be unreliable until Bun is upgraded.`,
    );
  }
}

function compareVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);

  for (let index = 0; index < 3; index += 1) {
    const difference = leftParts[index] - rightParts[index];
    if (difference !== 0) return difference;
  }

  return 0;
}

function parseVersion(version) {
  const parts = version
    .split(/[.-]/)
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0);
  while (parts.length < 3) parts.push(0);
  return parts;
}
