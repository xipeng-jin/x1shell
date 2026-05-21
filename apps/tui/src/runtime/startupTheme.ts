import { resolveThemeId } from "../terminal/theme.js";

export function resolveStartupThemeId(
  configTheme: string | undefined,
  preferenceTheme: string | undefined,
): string {
  return resolveThemeId(configTheme ?? preferenceTheme);
}
