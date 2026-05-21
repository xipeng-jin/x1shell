import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { TuiPaths } from "./config.js";

export interface TuiPreferences {
  theme?: string;
  useMouse?: boolean;
  enableMouseMovement?: boolean;
  useKittyKeyboard?: boolean;
}

export async function readPreferences(paths: TuiPaths): Promise<TuiPreferences> {
  try {
    const parsed = JSON.parse(await readFile(paths.prefsFile, "utf8")) as unknown;
    return normalizePreferences(parsed);
  } catch (error) {
    if (isMissingFileError(error)) return {};
    return {};
  }
}

export function normalizePreferences(value: unknown): TuiPreferences {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  return {
    ...(typeof input.theme === "string" && input.theme.trim() ? { theme: input.theme.trim() } : {}),
    ...(typeof input.useMouse === "boolean" ? { useMouse: input.useMouse } : {}),
    ...(typeof input.enableMouseMovement === "boolean"
      ? { enableMouseMovement: input.enableMouseMovement }
      : {}),
    ...(typeof input.useKittyKeyboard === "boolean"
      ? { useKittyKeyboard: input.useKittyKeyboard }
      : {}),
  };
}

export async function writePreferences(
  paths: TuiPaths,
  preferences: TuiPreferences,
): Promise<void> {
  const normalized = normalizePreferences(preferences);
  await mkdir(dirname(paths.prefsFile), { recursive: true });
  const tempFile = `${paths.prefsFile}.${process.pid}.${Date.now()}.${Math.random()
    .toString(36)
    .slice(2)}.tmp`;
  await writeFile(tempFile, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  await rename(tempFile, paths.prefsFile);
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
