import { afterEach, describe, expect, it, vi } from "vitest";

import {
  bootstrapBearerSession,
  fetchEnvironmentDescriptor,
  fetchSessionState,
  issueWebSocketToken,
  resolveAuthenticatedWebSocketUrl,
} from "./auth.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("environment auth helpers", () => {
  it("fetches environment and auth endpoints without window.location.origin", async () => {
    Reflect.deleteProperty(globalThis, "window");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            environmentId: "environment-remote",
            label: "Remote",
            platform: { os: "linux", arch: "x64" },
            serverVersion: "0.0.0-test",
            capabilities: { repositoryIdentity: true },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            authenticated: true,
            role: "client",
            sessionMethod: "bearer-session-token",
            expiresAt: "2026-05-01T12:00:00.000Z",
            sessionToken: "bearer-token",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            authenticated: true,
            auth: {
              policy: "remote-reachable",
              bootstrapMethods: ["one-time-token"],
              sessionMethods: ["browser-session-cookie", "bearer-session-token"],
              sessionCookieName: "t3_session",
            },
            role: "client",
            sessionMethod: "bearer-session-token",
            expiresAt: "2026-05-01T12:00:00.000Z",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "ws-token", expiresAt: "2026-05-01T12:05:00.000Z" }), {
          status: 200,
        }),
      );
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(
      fetchEnvironmentDescriptor({ httpBaseUrl: "https://remote.example.com/?ignored=true" }),
    ).resolves.toMatchObject({ environmentId: "environment-remote" });
    await expect(
      bootstrapBearerSession({
        httpBaseUrl: "https://remote.example.com/",
        credential: "pairing-token",
      }),
    ).resolves.toMatchObject({ sessionToken: "bearer-token" });
    await expect(
      fetchSessionState({
        httpBaseUrl: "https://remote.example.com/",
        bearerToken: "bearer-token",
      }),
    ).resolves.toMatchObject({ authenticated: true });
    await expect(
      issueWebSocketToken({
        httpBaseUrl: "https://remote.example.com/",
        bearerToken: "bearer-token",
      }),
    ).resolves.toMatchObject({ token: "ws-token" });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://remote.example.com/.well-known/t3/environment",
      { method: "GET", headers: {} },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://remote.example.com/api/auth/bootstrap/bearer",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credential: "pairing-token" }),
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(3, "https://remote.example.com/api/auth/session", {
      method: "GET",
      headers: { authorization: "Bearer bearer-token" },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(4, "https://remote.example.com/api/auth/ws-token", {
      method: "POST",
      headers: { authorization: "Bearer bearer-token" },
    });
  });

  it("resolves authenticated websocket urls without leaking secrets to callbacks", async () => {
    const callbacks = {
      onRequest: vi.fn(),
      onError: vi.fn(),
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ token: "issued-secret", expiresAt: "2026-05-01T12:05:00.000Z" }),
          { status: 200 },
        ),
      );

    await expect(
      resolveAuthenticatedWebSocketUrl({
        wsBaseUrl: "wss://remote.example.com/base?existing=1#fragment",
        httpBaseUrl: "https://remote.example.com/",
        bearerToken: "bearer-secret",
        options: { fetch: fetchMock as typeof fetch, callbacks },
      }),
    ).resolves.toBe("wss://remote.example.com/ws?existing=1&wsToken=issued-secret");

    expect(callbacks.onRequest).toHaveBeenCalledWith({
      origin: "https://remote.example.com",
      pathname: "/api/auth/ws-token",
      method: "POST",
    });
    expect(JSON.stringify(callbacks.onRequest.mock.calls)).not.toContain("bearer-secret");
    expect(JSON.stringify(callbacks.onRequest.mock.calls)).not.toContain("issued-secret");
  });

  it("redacts auth error response bodies before callbacks and thrown errors", async () => {
    const callbacks = {
      onError: vi.fn(),
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error:
            "Authorization: Bearer bearer-secret wsToken=socket-secret credential=pairing-token https://user:pass@remote.example.com/base?token=query-secret#fragment",
        }),
        { status: 401 },
      ),
    );

    await expect(
      fetchSessionState({
        httpBaseUrl: "https://remote.example.com/",
        bearerToken: "bearer-secret",
        options: { fetch: fetchMock as typeof fetch, callbacks },
      }),
    ).rejects.toThrow("[REDACTED]");

    const serializedCallback = JSON.stringify(callbacks.onError.mock.calls);
    expect(serializedCallback).not.toContain("bearer-secret");
    expect(serializedCallback).not.toContain("socket-secret");
    expect(serializedCallback).not.toContain("pairing-token");
    expect(serializedCallback).not.toContain("query-secret");
    expect(serializedCallback).not.toContain("#fragment");
  });

  it("attaches only sanitized fetch causes to public errors", async () => {
    const callbacks = {
      onError: vi.fn(),
    };
    const fetchMock = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "network failed Authorization: Bearer bearer-secret wsToken=socket-secret https://remote.example.com/ws?credential=pairing-token#fragment",
        ),
      );

    let thrown: unknown;
    try {
      await fetchSessionState({
        httpBaseUrl: "https://remote.example.com/",
        bearerToken: "bearer-secret",
        options: { fetch: fetchMock as typeof fetch, callbacks },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).cause).toBeInstanceOf(Error);
    const serializedError = `${String(thrown)} ${String((thrown as Error).cause)}`;
    const serializedCallback = JSON.stringify(callbacks.onError.mock.calls);
    for (const output of [serializedError, serializedCallback]) {
      expect(output).not.toContain("bearer-secret");
      expect(output).not.toContain("socket-secret");
      expect(output).not.toContain("pairing-token");
      expect(output).not.toContain("#fragment");
      expect(output).toContain("[REDACTED]");
    }
  });
});
