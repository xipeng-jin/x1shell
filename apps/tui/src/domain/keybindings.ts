export type TuiActionId =
  | "palette.open"
  | "help.toggle"
  | "thread.new"
  | "message.send"
  | "turn.interrupt-or-exit"
  | "thread.next"
  | "thread.previous"
  | "thread.archive-toggle"
  | "thread.stop"
  | "diff.toggle"
  | "diff.turn"
  | "diff.full"
  | "debug.toggle"
  | "settings.toggle"
  | "model.next"
  | "runtime.next"
  | "interaction.next"
  | "connection.reconnect"
  | "providers.refresh"
  | "git.refresh";

export interface TuiActionDefinition {
  readonly id: TuiActionId;
  readonly label: string;
  readonly description: string;
  readonly keys: readonly string[];
  readonly group: "navigation" | "thread" | "controls" | "panels" | "system";
}

export const TUI_ACTIONS: readonly TuiActionDefinition[] = [
  action(
    "palette.open",
    "Command palette",
    "Open searchable command palette.",
    ["ctrl+p"],
    "system",
  ),
  action("help.toggle", "Keyboard help", "Show keyboard shortcuts.", ["?"], "system"),
  action(
    "thread.new",
    "New thread",
    "Start a new thread in the selected project.",
    ["ctrl+n"],
    "thread",
  ),
  action(
    "message.send",
    "Send message",
    "Send composer text to the active thread or project.",
    ["enter"],
    "thread",
  ),
  action(
    "turn.interrupt-or-exit",
    "Interrupt or exit",
    "Interrupt a running turn, otherwise exit X1Shell.",
    ["ctrl+c", "q"],
    "thread",
  ),
  action("thread.next", "Next thread", "Select the next visible thread.", ["down"], "navigation"),
  action(
    "thread.previous",
    "Previous thread",
    "Select the previous visible thread.",
    ["up"],
    "navigation",
  ),
  action(
    "thread.archive-toggle",
    "Archive toggle",
    "Archive or unarchive the active thread.",
    ["a"],
    "thread",
  ),
  action("thread.stop", "Stop session", "Stop the active provider session.", ["s"], "thread"),
  action("diff.toggle", "Diff panel", "Toggle the diff view.", ["d"], "panels"),
  action("diff.turn", "Turn diff", "Load the latest checkpoint turn diff.", ["t"], "panels"),
  action("diff.full", "Full diff", "Load the full thread diff.", ["f"], "panels"),
  action("debug.toggle", "Debug panel", "Toggle redacted debug logs.", ["ctrl+d"], "panels"),
  action(
    "settings.toggle",
    "Settings panel",
    "Toggle settings and provider status.",
    [","],
    "panels",
  ),
  action("model.next", "Next model", "Cycle provider model selection.", ["m"], "controls"),
  action("runtime.next", "Runtime mode", "Cycle runtime mode.", ["r"], "controls"),
  action("interaction.next", "Interaction mode", "Cycle default or plan mode.", ["i"], "controls"),
  action("connection.reconnect", "Reconnect", "Reconnect and resubscribe.", ["R"], "system"),
  action("providers.refresh", "Refresh providers", "Refresh provider status.", ["p"], "system"),
  action("git.refresh", "Refresh git", "Refresh read-only git status.", ["g"], "system"),
];

export function getActionDefinition(id: TuiActionId): TuiActionDefinition {
  const actionDefinition = TUI_ACTIONS.find((entry) => entry.id === id);
  if (!actionDefinition) throw new Error(`Unknown TUI action: ${id}`);
  return actionDefinition;
}

export function formatActionKeys(actionDefinition: Pick<TuiActionDefinition, "keys">): string {
  return actionDefinition.keys.join(", ");
}

function action(
  id: TuiActionId,
  label: string,
  description: string,
  keys: readonly string[],
  group: TuiActionDefinition["group"],
): TuiActionDefinition {
  return { id, label, description, keys, group };
}
