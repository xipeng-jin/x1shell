import type { EnvironmentFetchOptions } from "@t3tools/client-runtime/environment";

export interface BoundedFetchInput {
  readonly options?: EnvironmentFetchOptions | undefined;
  readonly timeoutMs: number;
  readonly phase: string;
}

export class BoundedFetchTimeoutError extends Error {
  readonly phase: string;
  readonly timeoutMs: number;

  constructor(phase: string, timeoutMs: number) {
    super(`${phase} timed out after ${timeoutMs}ms.`);
    this.name = "BoundedFetchTimeoutError";
    this.phase = phase;
    this.timeoutMs = timeoutMs;
  }
}

export function boundedFetchOptions(input: BoundedFetchInput): EnvironmentFetchOptions {
  return {
    ...input.options,
    fetch: makeBoundedFetch({
      fetchImpl: input.options?.fetch,
      timeoutMs: input.timeoutMs,
      phase: input.phase,
    }),
  };
}

export function makeBoundedFetch(input: {
  readonly fetchImpl?: typeof fetch | undefined;
  readonly timeoutMs: number;
  readonly phase: string;
}): typeof fetch {
  const boundedFetch = async (url: URL | RequestInfo, init?: RequestInit) => {
    const fetchImpl = input.fetchImpl ?? globalThis.fetch;
    if (!fetchImpl) {
      throw new Error("No fetch implementation is available. Pass fetch explicitly.");
    }

    const controller = new AbortController();
    const signal = init?.signal
      ? AbortSignal.any([init.signal, controller.signal])
      : controller.signal;
    const timeoutError = new BoundedFetchTimeoutError(input.phase, input.timeoutMs);
    const fetchPromise = fetchImpl(url, { ...init, signal });
    let timeout: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort(timeoutError);
        reject(timeoutError);
      }, input.timeoutMs);
      timeout.unref?.();
    });

    try {
      return await Promise.race([fetchPromise, timeoutPromise]);
    } finally {
      clearTimeout(timeout!);
    }
  };
  return boundedFetch as typeof fetch;
}
