export interface StreamBatcher<T> {
  readonly push: (item: T) => void;
  readonly flush: () => void;
  readonly dispose: () => void;
}

export function createStreamBatcher<T>(input: {
  readonly flushMs?: number;
  readonly maxQueuedItems?: number;
  readonly onFlush: (items: readonly T[]) => void;
}): StreamBatcher<T> {
  const flushMs = input.flushMs ?? 16;
  const maxQueuedItems = input.maxQueuedItems ?? 1_000;
  let queued: T[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const flush = () => {
    if (queued.length === 0) return;
    clearTimer();
    const items = queued;
    queued = [];
    input.onFlush(items);
  };

  return {
    push: (item) => {
      queued.push(item);
      if (queued.length >= maxQueuedItems) {
        flush();
        return;
      }
      timer ??= setTimeout(flush, flushMs);
    },
    flush,
    dispose: () => {
      clearTimer();
      queued = [];
    },
  };
}
