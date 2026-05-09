export interface StreamBatcher<T> {
  readonly push: (item: T) => void;
  readonly flush: () => void;
  readonly dispose: () => void;
}

export function createStreamBatcher<T>(input: {
  readonly flushMs?: number;
  readonly maxQueuedItems?: number;
  readonly onFlush: (items: readonly T[]) => void;
  readonly onFlushError?: (error: unknown) => void;
}): StreamBatcher<T> {
  const flushMs = input.flushMs ?? 16;
  const maxQueuedItems = input.maxQueuedItems ?? 1_000;
  let queued: T[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const flush = (options: { readonly throwOnError: boolean }) => {
    if (queued.length === 0) return;
    clearTimer();
    const items = queued;
    queued = [];
    try {
      input.onFlush(items);
    } catch (error) {
      try {
        input.onFlushError?.(error);
      } catch {
        // Timer-driven flushes must not escape into process-level handlers.
      }
      if (options.throwOnError) throw error;
    }
  };

  return {
    push: (item) => {
      queued.push(item);
      if (queued.length >= maxQueuedItems) {
        flush({ throwOnError: true });
        return;
      }
      timer ??= setTimeout(() => flush({ throwOnError: false }), flushMs);
    },
    flush: () => flush({ throwOnError: true }),
    dispose: () => {
      clearTimer();
      queued = [];
    },
  };
}
