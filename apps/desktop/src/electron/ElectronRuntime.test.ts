import { assert, describe, it } from "@effect/vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, vi } from "vitest";

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const allowedRuntimeImportFiles = new Set(["main.ts", "preload.ts", "electron/ElectronRuntime.ts"]);

function listTypeScriptFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      files.push(...listTypeScriptFiles(path));
      continue;
    }
    if (entry.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}

describe("ElectronRuntime", () => {
  afterEach(() => {
    vi.doUnmock("electron");
    vi.doUnmock("electron-updater");
    vi.resetModules();
  });

  it("keeps Electron runtime imports behind the loader boundary", () => {
    const violations: string[] = [];
    const importPattern = /\bimport\s+[\s\S]*?;/g;
    const dynamicImportPattern = /\bimport\s*\(\s*["'](?:electron|electron-updater)["']\s*\)/g;
    const requirePattern = /\brequire\s*\(\s*["'](?:electron|electron-updater)["']\s*\)/g;

    for (const file of listTypeScriptFiles(srcRoot)) {
      const relativePath = relative(srcRoot, file);
      if (relativePath.endsWith(".test.ts") || allowedRuntimeImportFiles.has(relativePath)) {
        continue;
      }

      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(importPattern)) {
        const importStatement = match[0].trim();
        if (!/\sfrom\s+["'](?:electron|electron-updater)["'];?$/.test(importStatement)) {
          continue;
        }
        if (importStatement.startsWith("import type ")) {
          continue;
        }
        violations.push(`${relativePath}: ${importStatement}`);
      }
      for (const match of source.matchAll(dynamicImportPattern)) {
        violations.push(`${relativePath}: ${match[0]}`);
      }
      for (const match of source.matchAll(requirePattern)) {
        violations.push(`${relativePath}: ${match[0]}`);
      }
    }

    assert.deepEqual(violations, []);
  });

  it("loads Electron from a top-level namespace", async () => {
    const app = {};
    const BrowserWindow = {};
    const Menu = {};
    const electronNamespace = {
      __esModule: true,
      app,
      BrowserWindow,
      Menu,
    };

    vi.doMock("electron", () => electronNamespace);

    const { loadElectron } = await import("./ElectronRuntime.ts");
    const Electron = await loadElectron();

    assert.strictEqual(Electron.app, app);
    assert.strictEqual(Electron.BrowserWindow, BrowserWindow);
    assert.strictEqual(Electron.Menu, Menu);
  });

  it("loads Electron from a default-wrapped CommonJS namespace", async () => {
    const electronNamespace = {
      app: {},
      BrowserWindow: {},
      Menu: {},
    };

    vi.doMock("electron", () => ({
      default: electronNamespace,
    }));

    const { loadElectron } = await import("./ElectronRuntime.ts");

    assert.strictEqual(await loadElectron(), electronNamespace);
  });

  it("loads the Electron updater from top-level and default-wrapped namespaces", async () => {
    const topLevelAutoUpdater = {};
    vi.doMock("electron-updater", () => ({
      autoUpdater: topLevelAutoUpdater,
    }));

    const topLevelRuntime = await import("./ElectronRuntime.ts");

    assert.strictEqual(
      (await topLevelRuntime.loadElectronUpdater()).autoUpdater,
      topLevelAutoUpdater,
    );

    vi.doUnmock("electron-updater");
    vi.resetModules();

    const defaultAutoUpdater = {};
    vi.doMock("electron-updater", () => ({
      default: {
        autoUpdater: defaultAutoUpdater,
      },
    }));

    const defaultRuntime = await import("./ElectronRuntime.ts");

    assert.strictEqual(
      (await defaultRuntime.loadElectronUpdater()).autoUpdater,
      defaultAutoUpdater,
    );
  });
});
