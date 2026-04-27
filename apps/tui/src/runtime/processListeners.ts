export type ErrorProcessEventName = "uncaughtException" | "unhandledRejection";
export type ErrorProcessListener =
  | NodeJS.UncaughtExceptionListener
  | NodeJS.UnhandledRejectionListener;

export function captureProcessListeners(
  events: readonly ErrorProcessEventName[],
): Map<ErrorProcessEventName, Set<ErrorProcessListener>> {
  return new Map(
    events.map((event) => [event, new Set(process.rawListeners(event) as ErrorProcessListener[])]),
  );
}

export function removeAddedProcessListeners(
  previousListeners: ReadonlyMap<ErrorProcessEventName, ReadonlySet<ErrorProcessListener>>,
): void {
  for (const [event, previous] of previousListeners) {
    for (const listener of process.rawListeners(event) as ErrorProcessListener[]) {
      if (!previous.has(listener)) {
        process.removeListener(event, listener);
      }
    }
  }
}
