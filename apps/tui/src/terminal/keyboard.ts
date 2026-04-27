export interface KeyboardPolicy {
  useKittyKeyboard: boolean;
  useMouse: boolean;
  enableMouseMovement: boolean;
}

export function resolveKeyboardPolicy(
  env: NodeJS.ProcessEnv = process.env,
  preferences: Partial<KeyboardPolicy> = {},
): KeyboardPolicy {
  return {
    useKittyKeyboard:
      readBoolean(env.X1SHELL_USE_KITTY_KEYBOARD) ??
      preferences.useKittyKeyboard ??
      shouldUseKittyKeyboard(env),
    useMouse: readBoolean(env.X1SHELL_USE_MOUSE) ?? preferences.useMouse ?? true,
    enableMouseMovement:
      readBoolean(env.X1SHELL_ENABLE_MOUSE_MOVEMENT) ?? preferences.enableMouseMovement ?? false,
  };
}

export function shouldUseKittyKeyboard(env: NodeJS.ProcessEnv = process.env): boolean {
  const identity = [env.TERM_PROGRAM, env.TERM, env.COLORTERM]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return ["ghostty", "kitty", "wezterm", "iterm"].some((token) => identity.includes(token));
}

function readBoolean(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}
