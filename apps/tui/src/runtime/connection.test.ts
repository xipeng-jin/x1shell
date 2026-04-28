import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTuiWsConnection, resolveTuiAuthenticatedWebSocketUrl } from "./connection.js";

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
});

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
