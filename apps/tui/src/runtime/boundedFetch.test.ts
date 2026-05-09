import { describe, expect, it, vi } from "vitest";
import { boundedFetchOptions, makeBoundedFetch } from "./boundedFetch.js";

describe("bounded fetch", () => {
  it("settles on timeout even when the fetch implementation ignores AbortSignal", async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    const fetch = makeBoundedFetch({
      fetchImpl: fetchMock as unknown as typeof globalThis.fetch,
      timeoutMs: 5,
      phase: "test request",
    });

    await expect(fetch("http://127.0.0.1/")).rejects.toThrow(/test request timed out after 5ms/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("passes a composed abort signal to cooperative fetch implementations", async () => {
    let signal: AbortSignal | null | undefined;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      signal = init?.signal;
      return new Promise<Response>(() => {});
    });
    const fetch = makeBoundedFetch({
      fetchImpl: fetchMock as unknown as typeof globalThis.fetch,
      timeoutMs: 5,
      phase: "cooperative request",
    });

    await expect(fetch("http://127.0.0.1/")).rejects.toThrow(
      /cooperative request timed out after 5ms/,
    );
    expect(signal?.aborted).toBe(true);
  });

  it("preserves callbacks while replacing the fetch implementation", () => {
    const onRequest = vi.fn();
    const options = boundedFetchOptions({
      options: { callbacks: { onRequest } },
      timeoutMs: 5,
      phase: "callback request",
    });

    expect(options.callbacks?.onRequest).toBe(onRequest);
    expect(options.fetch).toBeTypeOf("function");
  });
});
