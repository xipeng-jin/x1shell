import { describe, expect, it, vi } from "vitest";
import { createStreamBatcher } from "./streamBatcher.js";

describe("TUI stream batcher", () => {
  it("flushes high-frequency events as one batch", () => {
    vi.useFakeTimers();
    const batches: number[][] = [];
    const batcher = createStreamBatcher<number>({
      onFlush: (items) => batches.push([...items]),
    });

    batcher.push(1);
    batcher.push(2);
    batcher.push(3);
    expect(batches).toEqual([]);
    vi.advanceTimersByTime(16);

    expect(batches).toEqual([[1, 2, 3]]);
    vi.useRealTimers();
  });

  it("supports explicit flush and dispose", () => {
    vi.useFakeTimers();
    const batches: number[][] = [];
    const batcher = createStreamBatcher<number>({
      onFlush: (items) => batches.push([...items]),
    });

    batcher.push(1);
    batcher.flush();
    batcher.push(2);
    batcher.dispose();
    vi.advanceTimersByTime(16);

    expect(batches).toEqual([[1]]);
    vi.useRealTimers();
  });

  it("flushes immediately when the queue reaches the configured bound", () => {
    vi.useFakeTimers();
    const batches: number[][] = [];
    const batcher = createStreamBatcher<number>({
      maxQueuedItems: 3,
      onFlush: (items) => batches.push([...items]),
    });

    batcher.push(1);
    batcher.push(2);
    expect(batches).toEqual([]);
    batcher.push(3);

    expect(batches).toEqual([[1, 2, 3]]);
    vi.advanceTimersByTime(16);
    expect(batches).toEqual([[1, 2, 3]]);
    vi.useRealTimers();
  });

  it("routes timer flush errors to the error handler without throwing", () => {
    vi.useFakeTimers();
    const errors: unknown[] = [];
    const batcher = createStreamBatcher<number>({
      onFlush: () => {
        throw new Error("timer failed");
      },
      onFlushError: (error) => errors.push(error),
    });

    batcher.push(1);

    expect(() => vi.advanceTimersByTime(16)).not.toThrow();
    expect(String(errors[0])).toContain("timer failed");
    vi.useRealTimers();
  });

  it("still throws explicit flush errors after reporting them", () => {
    const errors: unknown[] = [];
    const batcher = createStreamBatcher<number>({
      onFlush: () => {
        throw new Error("explicit failed");
      },
      onFlushError: (error) => errors.push(error),
    });

    batcher.push(1);

    expect(() => batcher.flush()).toThrow("explicit failed");
    expect(String(errors[0])).toContain("explicit failed");
  });
});
