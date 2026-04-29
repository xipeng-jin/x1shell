import { safeOutputText, safeOutputUnknown } from "../runtime/log.js";

export interface TuiDebugEntry {
  readonly time: string;
  readonly level: "info" | "warn" | "error";
  readonly message: string;
}

export function createDebugBuffer(options: { readonly capacity?: number } = {}) {
  const capacity = options.capacity ?? 200;
  let entries: readonly TuiDebugEntry[] = [];
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  return {
    push: (level: TuiDebugEntry["level"], message: string, details?: unknown) => {
      const safeMessage =
        details === undefined
          ? safeOutputText(message)
          : `${safeOutputText(message)} ${safeOutputUnknown(details)}`;
      entries = [...entries, { time: new Date().toISOString(), level, message: safeMessage }].slice(
        -capacity,
      );
      emit();
    },
    getSnapshot: () => entries,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
