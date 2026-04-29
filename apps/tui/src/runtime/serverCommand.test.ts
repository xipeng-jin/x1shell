import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveServerCommand, supportsNodeSourceEntry } from "./serverCommand.js";

const root = "/repo/x1shell";
const serverPackage = JSON.stringify({ name: "t3", bin: { t3: "./dist/bin.mjs" } });

describe("server command resolution", () => {
  it("prefers the built CLI entry when it exists", async () => {
    const resolved = await resolveServerCommand({
      cwd: path.join(root, "apps/tui"),
      nodeExecutable: "/usr/bin/node",
      accessFile: fakeAccess([
        "apps/server/package.json",
        "apps/tui/package.json",
        "apps/server/dist/bin.mjs",
        "apps/server/src/bin.ts",
      ]),
      readTextFile: async () => serverPackage,
    });

    expect(resolved).toMatchObject({
      kind: "repo-built",
      entryPath: "/repo/x1shell/apps/server/dist/bin.mjs",
      command: {
        executable: "/usr/bin/node",
        entryArgs: ["/repo/x1shell/apps/server/dist/bin.mjs"],
      },
    });
  });

  it("uses the source CLI entry when built output is missing and Node supports it", async () => {
    const resolved = await resolveServerCommand({
      cwd: root,
      nodeExecutable: "/usr/bin/node",
      readNodeVersion: async (executable) => {
        expect(executable).toBe("/usr/bin/node");
        return "22.16.0";
      },
      accessFile: fakeAccess([
        "apps/server/package.json",
        "apps/tui/package.json",
        "apps/server/src/bin.ts",
      ]),
      readTextFile: async () => serverPackage,
    });

    expect(resolved.kind).toBe("repo-source");
    expect(resolved.entryPath).toBe("/repo/x1shell/apps/server/src/bin.ts");
    expect(resolved.command.executable).toBe("/usr/bin/node");
  });

  it("rejects source execution on unsupported Node versions", async () => {
    await expect(
      resolveServerCommand({
        cwd: root,
        nodeVersion: "22.15.0",
        accessFile: fakeAccess([
          "apps/server/package.json",
          "apps/tui/package.json",
          "apps/server/src/bin.ts",
        ]),
        readTextFile: async () => serverPackage,
      }),
    ).rejects.toThrow(/cannot run the source server entry/);
  });

  it("rejects missing built output when built mode is required", async () => {
    await expect(
      resolveServerCommand({
        cwd: root,
        requireBuilt: true,
        accessFile: fakeAccess([
          "apps/server/package.json",
          "apps/tui/package.json",
          "apps/server/src/bin.ts",
        ]),
        readTextFile: async () => serverPackage,
      }),
    ).rejects.toThrow(/Built server CLI entry is required/);
  });

  it("uses the packaged bundled server when outside a source checkout", async () => {
    const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const packagedEntry = path.join(packageRoot, "dist/server/bin.mjs");
    await expect(
      resolveServerCommand({
        cwd: "/tmp/outside",
        nodeExecutable: "/usr/bin/node",
        accessFile: fakeAccessAbsolute([path.join(packageRoot, "package.json"), packagedEntry]),
        readTextFile: async (filePath) => {
          if (filePath === path.join(packageRoot, "package.json")) {
            return JSON.stringify({ name: "@x1shell/tui" });
          }
          throw new Error(`unexpected read: ${filePath}`);
        },
      }),
    ).resolves.toMatchObject({
      kind: "packaged-bundled",
      entryPath: packagedEntry,
      command: { executable: "/usr/bin/node", entryArgs: [packagedEntry] },
    });
  });

  it("rejects missing repo roots without falling back to global t3", async () => {
    await expect(
      resolveServerCommand({
        cwd: "/tmp/outside",
        accessFile: fakeAccess([]),
      }),
    ).rejects.toThrow(/explicit absolute --server-entry/);
  });

  it("accepts explicit absolute packaged entries and rejects legacy entries", async () => {
    await expect(
      resolveServerCommand({
        cwd: "/tmp/outside",
        explicitEntry: "/opt/x1shell/server/bin.mjs",
        nodeExecutable: "/usr/bin/node",
        accessFile: fakeAccessAbsolute(["/opt/x1shell/server/bin.mjs"]),
      }),
    ).resolves.toMatchObject({
      kind: "packaged",
      command: { executable: "/usr/bin/node", entryArgs: ["/opt/x1shell/server/bin.mjs"] },
    });

    await expect(
      resolveServerCommand({
        cwd: root,
        explicitEntry: "/repo/x1shell/apps/server/dist/index.mjs",
        accessFile: fakeAccessAbsolute(["/repo/x1shell/apps/server/dist/index.mjs"]),
      }),
    ).rejects.toThrow(/Legacy server entry paths/);
  });

  it("documents the supported source Node versions", () => {
    expect(supportsNodeSourceEntry("22.16.0")).toBe(true);
    expect(supportsNodeSourceEntry("23.11.0")).toBe(true);
    expect(supportsNodeSourceEntry("24.10.0")).toBe(true);
    expect(supportsNodeSourceEntry("22.15.0")).toBe(false);
  });
});

function fakeAccess(relativePaths: readonly string[]) {
  const files = new Set(relativePaths.map((entry) => path.join(root, entry)));
  return async (filePath: string) => files.has(filePath);
}

function fakeAccessAbsolute(paths: readonly string[]) {
  const files = new Set(paths);
  return async (filePath: string) => files.has(filePath);
}
