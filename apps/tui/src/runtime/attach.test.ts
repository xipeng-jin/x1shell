import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import type { ExecutionEnvironmentDescriptor } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  compareBeforeDeleteRuntimeState,
  deriveLocalServerStatePaths,
  isCompatibleDescriptor,
  issueLocalOwnerBearerSession,
  normalizeAttachBaseUrl,
  resolveBearerAttachTarget,
  resolveBootstrapAttachTarget,
  validateRuntimeState,
  type PersistedRuntimeState,
} from "./attach.js";

const descriptor = {
  environmentId: "env_123",
  label: "local",
  platform: { os: "linux", arch: "x64" },
  serverVersion: "0.0.21",
  capabilities: { repositoryIdentity: true },
} as const as ExecutionEnvironmentDescriptor;

describe("attach runtime", () => {
  it("normalizes HTTP and WebSocket base URLs without preserving unsafe query", () => {
    expect(normalizeAttachBaseUrl("https://remote.example.com/base?debug=1#x")).toEqual({
      httpBaseUrl: "https://remote.example.com/base",
      wsBaseUrl: "wss://remote.example.com/base",
    });
    expect(normalizeAttachBaseUrl("ws://localhost:3773/app")).toEqual({
      httpBaseUrl: "http://localhost:3773/app",
      wsBaseUrl: "ws://localhost:3773/app",
    });
    expect(() => normalizeAttachBaseUrl("ws://localhost/ws?wsToken=secret")).toThrow(
      /credential parameter 'wsToken'/,
    );
    expect(() => normalizeAttachBaseUrl("https://user:secret@example.com")).toThrow(
      /embedded credentials/,
    );
    expect(() => normalizeAttachBaseUrl("https://example.com/#token=secret")).toThrow(
      /credential fragment/,
    );
  });

  it("exchanges bootstrap credentials and reissues WebSocket tokens through redacted helpers", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/.well-known/t3/environment")) {
        return new Response(JSON.stringify(descriptor), { status: 200 });
      }
      if (url.endsWith("/api/auth/bootstrap/bearer")) {
        expect(String(init?.body)).not.toContain("redacted-by-helper");
        return new Response(
          JSON.stringify({
            authenticated: true,
            role: "owner",
            sessionMethod: "bearer-session-token",
            sessionToken: "bearer-secret",
            expiresAt: "2026-05-01T00:00:00.000Z",
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/api/auth/session")) {
        return new Response(
          JSON.stringify({ authenticated: true, auth: { mode: "remote" }, role: "owner" }),
          {
            status: 200,
          },
        );
      }
      if (url.endsWith("/api/auth/ws-token")) {
        expect(init?.headers).toMatchObject({ authorization: "Bearer bearer-secret" });
        return new Response(
          JSON.stringify({ token: "ws-secret", expiresAt: "2026-05-01T00:00:00.000Z" }),
          {
            status: 200,
          },
        );
      }
      return new Response("not found", { status: 404 });
    });

    const target = await resolveBootstrapAttachTarget({
      baseUrl: "https://remote.example.com",
      credential: "pairing-secret",
      options: { fetchOptions: { fetch: fetchMock as unknown as typeof fetch } },
    });

    await expect((target.webSocketUrlProvider as () => Promise<string>)()).resolves.toBe(
      "wss://remote.example.com/ws?wsToken=ws-secret",
    );
    expect(target.descriptor.environmentId).toBe("env_123");
    expect(target.sessionRole).toBe("owner");
  });

  it("validates bearer sessions before creating an attach target", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(descriptor), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ authenticated: true, auth: { mode: "remote" }, role: "client" }),
          {
            status: 200,
          },
        ),
      );

    await expect(
      resolveBearerAttachTarget({
        baseUrl: "http://localhost:3773",
        bearerToken: "bearer-secret",
        options: { fetchOptions: { fetch: fetchMock as unknown as typeof fetch } },
      }),
    ).resolves.toMatchObject({ sessionRole: "client" });
  });

  it("rejects unauthenticated bearer session state", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(descriptor), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            authenticated: false,
            auth: {
              policy: "remote-reachable",
              bootstrapMethods: ["one-time-token"],
              sessionMethods: ["bearer-session-token"],
              sessionCookieName: "t3_session",
            },
          }),
          { status: 200 },
        ),
      );

    await expect(
      resolveBearerAttachTarget({
        baseUrl: "http://localhost:3773",
        bearerToken: "bad-bearer",
        options: { fetchOptions: { fetch: fetchMock as unknown as typeof fetch } },
      }),
    ).rejects.toThrow(/not authenticated/);
  });

  it("validates bootstrap attach flow against a real loopback server and real fetch", async () => {
    const server = await startTestServer((request, response) => {
      const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      if (path === "/.well-known/t3/environment") {
        writeJson(response, descriptor);
        return;
      }
      if (path === "/api/auth/bootstrap/bearer") {
        expect(request.method).toBe("POST");
        writeJson(response, {
          authenticated: true,
          role: "owner",
          sessionMethod: "bearer-session-token",
          sessionToken: "bearer-secret",
          expiresAt: "2026-05-01T00:00:00.000Z",
        });
        return;
      }
      if (path === "/api/auth/session") {
        expect(request.headers.authorization).toBe("Bearer bearer-secret");
        writeJson(response, { authenticated: true, auth: { mode: "remote" }, role: "owner" });
        return;
      }
      if (path === "/api/auth/ws-token") {
        expect(request.headers.authorization).toBe("Bearer bearer-secret");
        writeJson(response, { token: "ws-secret", expiresAt: "2026-05-01T00:00:00.000Z" });
        return;
      }
      response.writeHead(404).end("not found");
    });

    try {
      const target = await resolveBootstrapAttachTarget({
        baseUrl: `http://127.0.0.1:${server.port}`,
        credential: "pairing-secret",
      });

      expect(target.sessionRole).toBe("owner");
      await expect((target.webSocketUrlProvider as () => Promise<string>)()).resolves.toBe(
        `ws://127.0.0.1:${server.port}/ws?wsToken=ws-secret`,
      );
    } finally {
      await server.close();
    }
  });

  it("derives normal and dev-scoped state roots like the server", () => {
    expect(deriveLocalServerStatePaths({ baseDir: "/home/me/.t3" }).stateDir).toBe(
      "/home/me/.t3/userdata",
    );
    expect(
      deriveLocalServerStatePaths({
        baseDir: "/home/me/.t3",
        devUrl: "http://localhost:5173",
      }).stateDir,
    ).toBe("/home/me/.t3/dev");
  });

  it("uses compare-before-delete for stale runtime state", async () => {
    const dir = await createTempDir();
    const file = join(dir, "server-runtime.json");
    const stale = runtimeState(1234);
    await writeFile(file, `${JSON.stringify(stale)}\n`, "utf8");

    await expect(compareBeforeDeleteRuntimeState(file, stale)).resolves.toBe(true);
    await expect(readFile(file, "utf8")).rejects.toThrow();

    const replacement = runtimeState(5678);
    await writeFile(file, `${JSON.stringify(replacement)}\n`, "utf8");
    await expect(compareBeforeDeleteRuntimeState(file, stale)).resolves.toBe(false);
    await expect(readFile(file, "utf8")).resolves.toContain("5678");
  });

  it("rejects local runtime state with invalid or non-local origins before descriptor fetch", async () => {
    const fetchMock = vi.fn();
    await expect(
      validateRuntimeState({
        runtimeState: { ...runtimeState(process.pid), origin: "https://remote.example.com:3773" },
        localEnvironmentId: "env_123",
        fetchOptions: { fetch: fetchMock as unknown as typeof fetch },
      }),
    ).resolves.toBe("server origin is not local");
    await expect(
      validateRuntimeState({
        runtimeState: {
          ...runtimeState(process.pid),
          origin: "http://127.0.0.1:3774",
        },
        localEnvironmentId: "env_123",
        fetchOptions: { fetch: fetchMock as unknown as typeof fetch },
      }),
    ).resolves.toBe("server origin port does not match runtime state port");
    await expect(
      validateRuntimeState({
        runtimeState: {
          ...runtimeState(process.pid),
          host: "localhost",
          origin: "http://127.0.0.1:3773",
        },
        localEnvironmentId: "env_123",
        fetchOptions: { fetch: fetchMock as unknown as typeof fetch },
      }),
    ).resolves.toBe("server origin host does not match runtime state host");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates local runtime state origin, pid, descriptor, and compatibility together", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe("http://127.0.0.1:3773/.well-known/t3/environment");
      return new Response(JSON.stringify(descriptor), { status: 200 });
    });

    await expect(
      validateRuntimeState({
        runtimeState: runtimeState(process.pid),
        localEnvironmentId: "env_123",
        fetchOptions: { fetch: fetchMock as unknown as typeof fetch },
      }),
    ).resolves.toBe(null);
  });

  it("builds local owner auth command args with dev scoping", async () => {
    const execMock = vi.fn((_file, _args, _options, callback) => {
      callback(null, "bearer-secret\n", "");
    });

    await expect(
      issueLocalOwnerBearerSession({
        baseDir: "/tmp/t3",
        devUrl: "http://localhost:5173",
        serverCommand: {
          executable: "/usr/bin/node",
          entryArgs: ["/repo/apps/server/dist/bin.mjs"],
        },
        execFile: execMock as never,
      }),
    ).resolves.toBe("bearer-secret");

    expect(execMock).toHaveBeenCalledWith(
      "/usr/bin/node",
      [
        "/repo/apps/server/dist/bin.mjs",
        "auth",
        "session",
        "issue",
        "--token-only",
        "--role",
        "owner",
        "--base-dir",
        "/tmp/t3",
        "--dev-url",
        "http://localhost:5173",
      ],
      { windowsHide: true },
      expect.any(Function),
    );
  });

  it("redacts local owner auth command failures without surfacing child stdout", async () => {
    const error = new Error("Authorization: Bearer stderr-secret failed");
    Object.assign(error, {
      stdout: "bare-stdout-token",
      stderr: "wsToken=stderr-secret",
    });
    const execMock = vi.fn((_file, _args, _options, callback) => {
      callback(error, "bare-stdout-token\n", "wsToken=stderr-secret");
    });

    await expect(
      issueLocalOwnerBearerSession({
        baseDir: "/tmp/t3",
        serverEntry: "/repo/apps/server/dist/bin.mjs",
        execFile: execMock as never,
      }),
    ).rejects.toThrow("Local owner session command failed: Authorization: [REDACTED] failed");

    await expect(
      issueLocalOwnerBearerSession({
        baseDir: "/tmp/t3",
        serverEntry: "/repo/apps/server/dist/bin.mjs",
        execFile: execMock as never,
      }),
    ).rejects.not.toThrow(/bare-stdout-token|stderr-secret/);
  });

  it("enforces the Phase 4 compatibility predicate", () => {
    expect(isCompatibleDescriptor(descriptor)).toBe(true);
    expect(isCompatibleDescriptor({ ...descriptor, serverVersion: "0.0.20" })).toBe(false);
    expect(
      isCompatibleDescriptor({
        ...descriptor,
        capabilities: { repositoryIdentity: false },
      }),
    ).toBe(false);
  });
});

function runtimeState(pid: number): PersistedRuntimeState {
  return {
    version: 1,
    pid,
    port: 3773,
    origin: "http://127.0.0.1:3773",
    startedAt: "2026-04-27T00:00:00.000Z",
  };
}

async function createTempDir(): Promise<string> {
  const parent = process.env.TMPDIR ?? resolve(process.cwd(), "../../.tmp/tui-tests");
  await mkdir(parent, { recursive: true });
  return mkdtemp(join(parent, "x1shell-attach-"));
}

function startTestServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ readonly port: number; readonly close: () => Promise<void> }> {
  const server = createServer(handler);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("test server did not bind to a TCP port"));
        return;
      }
      resolve({
        port: address.port,
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((error) => (error ? closeReject(error) : closeResolve()));
          }),
      });
    });
  });
}

function writeJson(response: ServerResponse, value: unknown): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}
