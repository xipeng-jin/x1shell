import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(packageRoot, "../..");
const serverDistSource = path.join(repoRoot, "apps/server/dist");
const serverDistTarget = path.join(packageRoot, "dist/server");

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

const serverEntry = path.join(serverDistSource, "bin.mjs");
if (!(await exists(serverEntry))) {
  throw new Error(`Built server entry is missing: ${serverEntry}`);
}

await fs.rm(serverDistTarget, { recursive: true, force: true });
await fs.mkdir(path.dirname(serverDistTarget), { recursive: true });
await fs.cp(serverDistSource, serverDistTarget, { recursive: true });
