import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WsRpcProtocolSocketUrlProvider } from "@t3tools/client-runtime/ws";
import { createServerConfigStore } from "../state/serverConfigStore.js";
import {
  createTuiConnectionController,
  createTuiWsConnection,
  resolveTuiAuthenticatedWebSocketUrl,
  type TuiWsConnection,
} from "./connection.js";
import type { AttachTarget } from "./attach.js";

type WsEventType = "open" | "message" | "close" | "error";
type WsEvent = { code?: number; data?: unknown; reason?: string; type?: string };
type WsListener = (event?: WsEvent) => void;

const sockets: MockWebSocket[] = [];

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  readonly sent: string[] = [];
  readonly url: string;
  private readonly listeners = new Map<WsEventType, Set<WsListener>>();

  constructor(url: string) {
    this.url = url;
    sockets.push(this);
  }

  addEventListener(type: WsEventType, listener: WsListener) {
    const listeners = this.listeners.get(type) ?? new Set<WsListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: WsEventType, listener: WsListener) {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code = 1000, reason = "") {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close", { code, reason, type: "close" });
  }

  private emit(type: WsEventType, event?: WsEvent) {
    const listeners = this.listeners.get(type);
    if (!listeners) return;
    for (const listener of listeners) {
      listener(event);
    }
  }
}

const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;

beforeEach(() => {
  sockets.length = 0;
  Reflect.deleteProperty(globalThis, "WebSocket");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.WebSocket = originalWebSocket;
  vi.restoreAllMocks();
});

describe("TUI connection runtime", () => {
  it("creates a shared client-runtime WebSocket connection without browser globals", async () => {
    const attempts: unknown[] = [];
    const connection = createTuiWsConnection("ws://localhost:3020/base?wsToken=secret", {
      webSocketConstructor: MockWebSocket as unknown as typeof WebSocket,
      lifecycle: {
        onAttempt: (metadata) => attempts.push(metadata),
      },
    });

    try {
      await waitFor(() => {
        expect(sockets).toHaveLength(1);
      });
    } finally {
      await connection.dispose();
    }

    expect(sockets[0]?.url).toBe("ws://localhost:3020/ws?wsToken=secret");
    expect(attempts).toEqual([
      {
        protocol: "ws:",
        origin: "ws://localhost:3020",
        pathname: "/ws",
        hasQuery: true,
        queryParamNames: ["wsToken"],
      },
    ]);
    expect(JSON.stringify(attempts)).not.toContain("secret");
  });

  it("resolves authenticated WebSocket URLs through the shared environment helper", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ token: "issued-token", expiresAt: "2026-05-01T12:05:00.000Z" }),
          { status: 200 },
        ),
      );

    await expect(
      resolveTuiAuthenticatedWebSocketUrl({
        wsBaseUrl: "wss://remote.example.com/base?debug=1#fragment",
        httpBaseUrl: "https://remote.example.com/",
        bearerToken: "bearer-token",
        options: { fetch: fetchMock as unknown as typeof fetch },
      }),
    ).resolves.toBe("wss://remote.example.com/ws?debug=1&wsToken=issued-token");
  });

  it("recreates RPC state, reissues URL providers, and replaces shell snapshots on reconnect", async () => {
    const store = createServerConfigStore();
    const snapshots = [shellSnapshot(1, "thread-a"), shellSnapshot(2, "thread-b")];
    const issuedUrls: string[] = [];
    const disposed: number[] = [];
    let providerCalls = 0;
    let connectionCount = 0;

    const controller = createTuiConnectionController({
      target: {
        httpBaseUrl: "http://localhost:3773",
        wsBaseUrl: "ws://localhost:3773",
        bearerToken: "bearer-token",
        descriptor: {
          environmentId: "env_123",
          label: "local",
          platform: { os: "linux", arch: "x64" },
          serverVersion: "0.0.21",
          capabilities: { repositoryIdentity: true },
        } as never,
        webSocketUrlProvider: async () => {
          providerCalls += 1;
          return `ws://localhost:3773/ws?wsToken=issued-${providerCalls}`;
        },
      },
      store,
      createConnection: (provider) => {
        const connectionId = connectionCount;
        connectionCount += 1;
        void Promise.resolve(resolveProvider(provider)).then((url) => issuedUrls.push(String(url)));
        return fakeConnection({
          dispose: () => disposed.push(connectionId),
          shellSnapshot: snapshots[connectionId] ?? snapshots.at(-1)!,
        });
      },
    });

    await controller.connect();
    await waitFor(() => {
      expect(issuedUrls).toEqual(["ws://localhost:3773/ws?wsToken=issued-1"]);
    });
    expect(store.getSnapshot().connection).toBe("connected");
    expect(store.getSnapshot().shell?.threads).toEqual([{ id: "thread-a" }]);

    await controller.reconnect();
    await waitFor(() => {
      expect(issuedUrls).toEqual([
        "ws://localhost:3773/ws?wsToken=issued-1",
        "ws://localhost:3773/ws?wsToken=issued-2",
      ]);
    });

    expect(disposed).toEqual([0]);
    expect(store.getSnapshot().connection).toBe("connected");
    expect(store.getSnapshot().shell?.snapshotSequence).toBe(2);
    expect(store.getSnapshot().shell?.threads).toEqual([{ id: "thread-b" }]);

    await controller.dispose();
    expect(disposed).toEqual([0, 1]);
  });

  it("subscribes to config then reconciles the authoritative getConfig result", async () => {
    const store = createServerConfigStore();
    const controller = createTuiConnectionController({
      target: attachTarget(),
      store,
      createConnection: () =>
        fakeConnection({
          config: serverConfig("authoritative-provider"),
          configEvent: {
            type: "snapshot",
            config: serverConfig("stream-provider"),
          },
          shellSnapshot: shellSnapshot(1, "thread-a"),
        }),
    });

    await controller.connect();
    await waitFor(() => {
      expect(store.getSnapshot().config?.providers).toEqual([{ id: "authoritative-provider" }]);
    });

    await controller.dispose();
  });

  it("ignores stale getConfig results from a disposed connection after reconnect", async () => {
    const store = createServerConfigStore();
    const staleConfig = deferred<unknown>();
    let connectionCount = 0;
    const controller = createTuiConnectionController({
      target: attachTarget(),
      store,
      createConnection: () => {
        connectionCount += 1;
        return fakeConnection({
          configPromise:
            connectionCount === 1
              ? staleConfig.promise
              : Promise.resolve(serverConfig("fresh-provider")),
          shellSnapshot:
            connectionCount === 1 ? shellSnapshot(1, "thread-a") : shellSnapshot(2, "thread-b"),
        });
      },
    });

    await controller.connect();
    await controller.reconnect();
    await waitFor(() => {
      expect(store.getSnapshot().config?.providers).toEqual([{ id: "fresh-provider" }]);
    });

    staleConfig.resolve(serverConfig("stale-provider"));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(store.getSnapshot().config?.providers).toEqual([{ id: "fresh-provider" }]);
    await controller.dispose();
  });

  it("automatically recreates RPC state and replaces snapshots after subscription disconnect", async () => {
    const store = createServerConfigStore();
    const issuedUrls: string[] = [];
    const disposed: number[] = [];
    let providerCalls = 0;
    let connectionCount = 0;
    let reportDisconnect: ((metadata: { readonly message: string }) => void) | undefined;

    const controller = createTuiConnectionController({
      target: {
        ...attachTarget(),
        webSocketUrlProvider: async () => {
          providerCalls += 1;
          return `ws://localhost:3773/ws?wsToken=issued-${providerCalls}`;
        },
      },
      store,
      createConnection: (provider, options) => {
        const connectionId = connectionCount;
        connectionCount += 1;
        reportDisconnect = options?.onSubscriptionDisconnect;
        void Promise.resolve(resolveProvider(provider)).then((url) => issuedUrls.push(String(url)));
        return fakeConnection({
          dispose: () => disposed.push(connectionId),
          shellSnapshot:
            connectionId === 0 ? shellSnapshot(1, "thread-a") : shellSnapshot(2, "thread-b"),
        });
      },
    });

    await controller.connect();
    await waitFor(() => {
      expect(store.getSnapshot().shell?.threads).toEqual([{ id: "thread-a" }]);
    });

    reportDisconnect?.({ message: "socket closed wsToken=socket-secret" });

    await waitFor(() => {
      expect(store.getSnapshot().shell?.threads).toEqual([{ id: "thread-b" }]);
      expect(issuedUrls).toEqual([
        "ws://localhost:3773/ws?wsToken=issued-1",
        "ws://localhost:3773/ws?wsToken=issued-2",
      ]);
    });
    expect(disposed).toEqual([0]);
    expect(store.getSnapshot().error).toBe(null);

    await controller.dispose();
    expect(disposed).toEqual([0, 1]);
  });

  it("surfaces subscription errors through the status store", async () => {
    const store = createServerConfigStore();
    let reportError: ((metadata: { readonly message: string }) => void) | undefined;
    const controller = createTuiConnectionController({
      target: {
        httpBaseUrl: "http://localhost:3773",
        wsBaseUrl: "ws://localhost:3773",
        bearerToken: "bearer-token",
        descriptor: {
          environmentId: "env_123",
          label: "local",
          platform: { os: "linux", arch: "x64" },
          serverVersion: "0.0.21",
          capabilities: { repositoryIdentity: true },
        } as never,
        webSocketUrlProvider: "ws://localhost:3773/ws?wsToken=secret",
      },
      store,
      createConnection: (_provider, options) => {
        reportError = options?.onSubscriptionError;
        return fakeConnection({ shellSnapshot: shellSnapshot(1, "thread-a") });
      },
    });

    await controller.connect();
    reportError?.({ message: "Authorization: Bearer secret-token failed" });

    expect(store.getSnapshot()).toMatchObject({
      connection: "error",
      error: "Authorization: [REDACTED] failed",
    });
  });
});

function fakeConnection(input: {
  readonly shellSnapshot: unknown;
  readonly config?: unknown;
  readonly configPromise?: Promise<unknown>;
  readonly configEvent?: unknown;
  readonly dispose?: () => void;
}): TuiWsConnection {
  return {
    client: {
      server: {
        getConfig: () =>
          input.configPromise ?? Promise.resolve(input.config ?? serverConfig("default-provider")),
        subscribeConfig: (listener: (event: unknown) => void) => {
          if (input.configEvent) {
            listener(input.configEvent);
          }
          return () => undefined;
        },
        subscribeLifecycle: () => () => undefined,
      },
      orchestration: {
        subscribeShell: (listener: (item: unknown) => void) => {
          listener({ kind: "snapshot", snapshot: input.shellSnapshot });
          return () => undefined;
        },
      },
    } as never,
    transport: {} as never,
    dispose: async () => {
      input.dispose?.();
    },
  };
}

function attachTarget(): AttachTarget {
  return {
    httpBaseUrl: "http://localhost:3773",
    wsBaseUrl: "ws://localhost:3773",
    bearerToken: "bearer-token",
    descriptor: {
      environmentId: "env_123",
      label: "local",
      platform: { os: "linux", arch: "x64" },
      serverVersion: "0.0.21",
      capabilities: { repositoryIdentity: true },
    },
    webSocketUrlProvider: "ws://localhost:3773/ws?wsToken=secret",
  } as AttachTarget;
}

function serverConfig(providerId: string) {
  return {
    providers: [{ id: providerId }],
    settings: {},
    issues: [],
  } as never;
}

function shellSnapshot(sequence: number, threadId: string) {
  return {
    snapshotSequence: sequence,
    updatedAt: "2026-04-27T00:00:00.000Z",
    projects: [],
    threads: [{ id: threadId }],
  } as never;
}

function resolveProvider(
  provider: WsRpcProtocolSocketUrlProvider,
): string | URL | Promise<string | URL> {
  return typeof provider === "function" ? provider() : provider;
}

async function waitFor(assertion: () => void, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() - startedAt >= timeoutMs) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}
