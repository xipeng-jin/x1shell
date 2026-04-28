import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createWsRpcProtocolLayer,
  resolveWsRpcSocketUrl,
  WsTransport,
  type WebSocketConstructorLike,
} from "./index.ts";

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

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.emit("open", { type: "open" });
  }

  private emit(type: WsEventType, event?: WsEvent) {
    const listeners = this.listeners.get(type);
    if (!listeners) return;
    for (const listener of listeners) {
      listener(event);
    }
  }
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

const originalWebSocket = globalThis.WebSocket;
const transports: WsTransport[] = [];

beforeEach(() => {
  sockets.length = 0;
  Reflect.deleteProperty(globalThis, "WebSocket");
});

afterEach(async () => {
  await Promise.allSettled(transports.map((transport) => transport.dispose()));
  transports.length = 0;
  globalThis.WebSocket = originalWebSocket;
});

describe("ws protocol helpers", () => {
  it("normalizes websocket urls to /ws while preserving query params and clearing fragments", () => {
    expect(resolveWsRpcSocketUrl("wss://app.example.com/chat?wsToken=secret&debug=1#frag")).toBe(
      "wss://app.example.com/ws?wsToken=secret&debug=1",
    );
  });

  it("uses an injected websocket constructor without browser globals", async () => {
    const transport = new WsTransport("ws://localhost:3020/?wsToken=secret-token", {
      webSocketConstructor: MockWebSocket as unknown as WebSocketConstructorLike,
    });
    transports.push(transport);

    await waitFor(() => {
      expect(sockets).toHaveLength(1);
    });

    expect(sockets[0]?.url).toBe("ws://localhost:3020/ws?wsToken=secret-token");
  });

  it("throws when no websocket constructor is available", () => {
    expect(() => createWsRpcProtocolLayer("ws://localhost:3020/ws")).toThrow(
      "No WebSocket constructor is available. Pass webSocketConstructor explicitly.",
    );
  });

  it("passes redacted lifecycle metadata instead of raw token-bearing urls", async () => {
    const attempts: unknown[] = [];
    const transport = new WsTransport("wss://remote.example.com/?wsToken=secret&debug=1", {
      webSocketConstructor: MockWebSocket as unknown as WebSocketConstructorLike,
      lifecycle: {
        onAttempt: (metadata) => attempts.push(metadata),
      },
    });
    transports.push(transport);

    await waitFor(() => {
      expect(attempts).toHaveLength(1);
    });

    expect(attempts[0]).toEqual({
      protocol: "wss:",
      origin: "wss://remote.example.com",
      pathname: "/ws",
      hasQuery: true,
      queryParamNames: ["debug", "wsToken"],
    });
    expect(JSON.stringify(attempts)).not.toContain("secret");
    expect(JSON.stringify(attempts)).not.toContain("?wsToken");
  });

  it("redacts raw websocket close reasons before lifecycle callbacks", async () => {
    const closes: unknown[] = [];
    const closeTransport = new WsTransport("wss://remote.example.com/?wsToken=socket-secret", {
      webSocketConstructor: MockWebSocket as unknown as WebSocketConstructorLike,
      lifecycle: {
        onClose: (details, metadata) => closes.push({ details, metadata }),
      },
    });
    transports.push(closeTransport);

    await waitFor(() => {
      expect(sockets).toHaveLength(1);
    });
    sockets[0]?.close(
      1008,
      "Authorization: Bearer bearer-secret token=socket-secret https://remote.example.com/ws?credential=pairing-token#fragment",
    );

    await waitFor(() => {
      expect(closes).toContainEqual(
        expect.objectContaining({
          details: expect.objectContaining({ code: 1008 }),
        }),
      );
    });

    const serialized = JSON.stringify(closes);
    expect(serialized).not.toContain("bearer-secret");
    expect(serialized).not.toContain("socket-secret");
    expect(serialized).not.toContain("pairing-token");
    expect(serialized).not.toContain("#fragment");
    expect(serialized).toContain("[REDACTED]");
  });
});
