import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveTuiPaths } from "./config.js";
import { normalizePreferences, readPreferences } from "./preferences.js";

describe("preferences", () => {
  it("normalizes supported preference values only", () => {
    expect(
      normalizePreferences({
        theme: " amber ",
        useMouse: false,
        enableMouseMovement: true,
        useKittyKeyboard: true,
        unknown: "ignored",
      }),
    ).toEqual({
      theme: "amber",
      useMouse: false,
      enableMouseMovement: true,
      useKittyKeyboard: true,
    });
  });

  it("reads missing preferences as empty defaults", async () => {
    const dir = await createTempDir();
    const paths = resolveTuiPaths({ HOME: dir });

    await expect(readPreferences(paths)).resolves.toEqual({});
  });

  it("reads preferences from the resolved prefs file", async () => {
    const dir = await createTempDir();
    const paths = resolveTuiPaths({
      HOME: dir,
      X1SHELL_CONFIG_HOME: join(dir, "config"),
    });
    await mkdir(join(dir, "config", "x1shell"), { recursive: true });
    await writeFile(paths.prefsFile, JSON.stringify({ theme: "amber", useMouse: false }), "utf8");

    await expect(readPreferences(paths)).resolves.toEqual({ theme: "amber", useMouse: false });
  });
});

async function createTempDir(): Promise<string> {
  const parent = process.env.TMPDIR ?? resolve(process.cwd(), "../../.tmp/tui-tests");
  await mkdir(parent, { recursive: true });
  return mkdtemp(join(parent, "x1shell-prefs-"));
}
