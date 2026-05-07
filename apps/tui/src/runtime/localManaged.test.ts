import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import type { ExecutionEnvironmentDescriptor } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  assertNoLegacySpawnFlags,
  classifyExit,
  localStateRootForDebug,
  startLocalManagedSupervisor,
} from "./localManaged.js";

const descriptor = {
  environmentId: "env_123",
  label: "local",
  platform: { os: "linux", arch: "x64" },
  serverVersion: "0.0.21",
  capabilities: { repositoryIdentity: true },
} as const as ExecutionEnvironmentDescriptor;

describe("local managed supervisor", () => {
  it("spawns current t3 CLI with bootstrap fd, no browser, cwd auto-bootstrap, and no legacy flags", async () => {
    const entry = await makeEntry();
    const child = makeChild();
    const spawnMock = vi.fn(() => child as ChildProcess);
    const fetchMock = fetchSequence([
      ["/.well-known/t3/environment", descriptor],
      ["/.well-known/t3/environment", descriptor],
      [
        "/api/auth/bootstrap/bearer",
        {
          authenticated: true,
          role: "owner",
          sessionMethod: "bearer-session-token",
          sessionToken: "bearer-secret",
          expiresAt: "2026-05-01T00:00:00.000Z",
        },
      ],
      ["/.well-known/t3/environment", descriptor],
      ["/api/auth/session", { authenticated: true, auth: { mode: "desktop" }, role: "owner" }],
    ]);

    const supervisor = await startLocalManagedSupervisor({
      baseDir: "/tmp/t3",
      serverEntry: entry,
      cwd: "/work/project",
      newServer: true,
      spawnProcess: spawnMock as never,
      resolvePort: async () => 4555,
      fetchOptions: { fetch: fetchMock as unknown as typeof fetch },
    });

    expect(supervisor.owned).toBe(true);
    expect(spawnMock).toHaveBeenCalledWith(
      expectedNodeExecutable(),
      [
        entry,
        "start",
        "--mode",
        "desktop",
        "--host",
        "127.0.0.1",
        "--port",
        "4555",
        "--base-dir",
        "/tmp/t3",
        "--no-browser",
        "--auto-bootstrap-project-from-cwd",
        "--bootstrap-fd",
        "3",
      ],
      expect.objectContaining({
        cwd: "/work/project",
        stdio: ["ignore", "pipe", "pipe", "pipe"],
      }),
    );
    const envelope = child.bootstrapPipe.read().toString("utf8");
    expect(envelope.endsWith("\n")).toBe(true);
    expect(JSON.parse(envelope)).toMatchObject({
      mode: "desktop",
      host: "127.0.0.1",
      port: 4555,
      t3Home: "/tmp/t3",
      noBrowser: true,
      autoBootstrapProjectFromCwd: true,
    });
    expect(JSON.parse(envelope)).not.toHaveProperty("tailscaleServeEnabled");
    expect(JSON.parse(envelope)).not.toHaveProperty("tailscaleServePort");
    expect(envelope).toContain("desktopBootstrapToken");
    const spawnCalls = spawnMock.mock.calls as unknown as Array<[string, string[]]>;
    const spawnArgs = spawnCalls[0]?.[1];
    expect(Array.isArray(spawnArgs)).toBe(true);
    if (!spawnArgs) throw new Error("spawn args missing");
    assertNoLegacySpawnFlags(spawnArgs);
    await supervisor.stop();
  });

  it("attaches first to a compatible runtime state and does not spawn", async () => {
    const baseDir = await makeBaseDir();
    const stateDir = join(baseDir, "userdata");
    await mkdir(stateDir, { recursive: true });
    await writeFile(join(stateDir, "environment-id"), "env_123\n", "utf8");
    await writeFile(
      join(stateDir, "server-runtime.json"),
      JSON.stringify({
        version: 1,
        pid: process.pid,
        host: "127.0.0.1",
        port: 3773,
        origin: "http://127.0.0.1:3773",
        startedAt: "2026-04-28T00:00:00.000Z",
      }),
      "utf8",
    );
    const entry = await makeEntry();
    const spawnMock = vi.fn();
    const execMock = vi.fn((_file, _args, _options, callback) =>
      callback(null, "bearer-secret\n", ""),
    );
    const fetchMock = fetchSequence([
      ["/.well-known/t3/environment", descriptor],
      ["/.well-known/t3/environment", descriptor],
      ["/api/auth/session", { authenticated: true, auth: { mode: "desktop" }, role: "owner" }],
    ]);

    const supervisor = await startLocalManagedSupervisor({
      baseDir,
      serverEntry: entry,
      spawnProcess: spawnMock as never,
      execFile: execMock as never,
      fetchOptions: { fetch: fetchMock as unknown as typeof fetch },
    });

    expect(supervisor.owned).toBe(false);
    expect(spawnMock).not.toHaveBeenCalled();
    expect(execMock).toHaveBeenCalledWith(
      expectedNodeExecutable(),
      [entry, "auth", "session", "issue", "--token-only", "--role", "owner", "--base-dir", baseDir],
      { windowsHide: true },
      expect.any(Function),
    );
  });

  it("starts an owned server when local environment-id is missing", async () => {
    const baseDir = await makeBaseDir();
    const entry = await makeEntry();
    const child = makeChild();
    const spawnMock = vi.fn(() => child as ChildProcess);
    const fetchMock = fetchSequence(ownedServerFetchEntries());

    const supervisor = await startLocalManagedSupervisor({
      baseDir,
      serverEntry: entry,
      spawnProcess: spawnMock as never,
      resolvePort: async () => 4557,
      fetchOptions: { fetch: fetchMock as unknown as typeof fetch },
    });

    expect(supervisor.owned).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    await supervisor.stop();
  });

  it("starts an owned server when runtime state is missing or empty", async () => {
    for (const runtimeContents of [null, ""]) {
      const baseDir = await makeBaseDir();
      const stateDir = join(baseDir, "userdata");
      await mkdir(stateDir, { recursive: true });
      await writeFile(join(stateDir, "environment-id"), "env_123\n", "utf8");
      if (runtimeContents !== null) {
        await writeFile(join(stateDir, "server-runtime.json"), runtimeContents, "utf8");
      }
      const entry = await makeEntry();
      const child = makeChild();
      const spawnMock = vi.fn(() => child as ChildProcess);
      const fetchMock = fetchSequence(ownedServerFetchEntries());

      const supervisor = await startLocalManagedSupervisor({
        baseDir,
        serverEntry: entry,
        spawnProcess: spawnMock as never,
        resolvePort: async () => 4558,
        fetchOptions: { fetch: fetchMock as unknown as typeof fetch },
      });

      expect(supervisor.owned).toBe(true);
      expect(spawnMock).toHaveBeenCalledTimes(1);
      await supervisor.stop();
    }
  });

  it("surfaces local owner auth failures instead of spawning a replacement", async () => {
    const baseDir = await makeBaseDir();
    const stateDir = join(baseDir, "userdata");
    await mkdir(stateDir, { recursive: true });
    await writeFile(join(stateDir, "environment-id"), "env_123\n", "utf8");
    await writeRuntimeState(stateDir, { port: 3773, origin: "http://127.0.0.1:3773" });
    const entry = await makeEntry();
    const spawnMock = vi.fn();
    const execMock = vi.fn((_file, _args, _options, callback) =>
      callback(new Error("auth token=secret failed"), "", ""),
    );
    const fetchMock = fetchSequence([["/.well-known/t3/environment", descriptor]]);

    await expect(
      startLocalManagedSupervisor({
        baseDir,
        serverEntry: entry,
        spawnProcess: spawnMock as never,
        execFile: execMock as never,
        fetchOptions: { fetch: fetchMock as unknown as typeof fetch },
      }),
    ).rejects.toThrow(/Local owner session command failed/);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("surfaces incompatible local servers instead of spawning a replacement", async () => {
    const baseDir = await makeBaseDir();
    const stateDir = join(baseDir, "userdata");
    await mkdir(stateDir, { recursive: true });
    await writeFile(join(stateDir, "environment-id"), "env_123\n", "utf8");
    await writeRuntimeState(stateDir, { port: 3773, origin: "http://127.0.0.1:3773" });
    const entry = await makeEntry();
    const spawnMock = vi.fn();
    const fetchMock = fetchSequence([
      [
        "/.well-known/t3/environment",
        { ...descriptor, serverVersion: "0.0.1" } satisfies ExecutionEnvironmentDescriptor,
      ],
    ]);

    await expect(
      startLocalManagedSupervisor({
        baseDir,
        serverEntry: entry,
        spawnProcess: spawnMock as never,
        fetchOptions: { fetch: fetchMock as unknown as typeof fetch },
      }),
    ).rejects.toThrow(/not compatible/);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("cleans stale runtime state before starting a replacement", async () => {
    const baseDir = await makeBaseDir();
    const stateDir = join(baseDir, "userdata");
    await mkdir(stateDir, { recursive: true });
    await writeFile(join(stateDir, "environment-id"), "env_123\n", "utf8");
    const runtimePath = join(stateDir, "server-runtime.json");
    await writeFile(
      runtimePath,
      JSON.stringify({
        version: 1,
        pid: 99999999,
        port: 3773,
        origin: "http://127.0.0.1:3773",
        startedAt: "2026-04-28T00:00:00.000Z",
      }),
      "utf8",
    );
    const entry = await makeEntry();
    const child = makeChild();
    const spawnMock = vi.fn(() => child as ChildProcess);
    const fetchMock = fetchSequence([
      ["/.well-known/t3/environment", descriptor],
      ["/.well-known/t3/environment", descriptor],
      [
        "/api/auth/bootstrap/bearer",
        {
          authenticated: true,
          role: "owner",
          sessionMethod: "bearer-session-token",
          sessionToken: "bearer-secret",
          expiresAt: "2026-05-01T00:00:00.000Z",
        },
      ],
      ["/.well-known/t3/environment", descriptor],
      ["/api/auth/session", { authenticated: true, auth: { mode: "desktop" }, role: "owner" }],
    ]);

    await startLocalManagedSupervisor({
      baseDir,
      serverEntry: entry,
      spawnProcess: spawnMock as never,
      resolvePort: async () => 4556,
      fetchOptions: { fetch: fetchMock as unknown as typeof fetch },
    });

    await expect(readFile(runtimePath, "utf8")).rejects.toThrow();
  });

  it("retries startup on bind failure with a fresh port", async () => {
    const entry = await makeEntry();
    const firstChild = makeChild();
    const secondChild = makeChild();
    const spawnMock = vi
      .fn()
      .mockReturnValueOnce(firstChild as ChildProcess)
      .mockReturnValueOnce(secondChild as ChildProcess);
    const ports = [4555, 4556];
    const fetchMock = fetchSequence([
      ["/.well-known/t3/environment", new Response("not ready", { status: 404 })],
      ["/.well-known/t3/environment", descriptor],
      ["/.well-known/t3/environment", descriptor],
      [
        "/api/auth/bootstrap/bearer",
        {
          authenticated: true,
          role: "owner",
          sessionMethod: "bearer-session-token",
          sessionToken: "bearer-secret",
          expiresAt: "2026-05-01T00:00:00.000Z",
        },
      ],
      ["/.well-known/t3/environment", descriptor],
      ["/api/auth/session", { authenticated: true, auth: { mode: "desktop" }, role: "owner" }],
    ]);

    const supervisor = await startLocalManagedSupervisor({
      baseDir: "/tmp/t3",
      serverEntry: entry,
      newServer: true,
      spawnProcess: spawnMock as never,
      resolvePort: async () => ports.shift() ?? 4556,
      fetchOptions: {
        fetch: vi.fn(async (url: string, init?: RequestInit) => {
          if (spawnMock.mock.calls.length === 1) {
            (firstChild.stdio[2] as PassThrough).write("EADDRINUSE wsToken=startup-secret");
            firstChild.emit("exit", 1, null);
          }
          return fetchMock(url, init);
        }) as unknown as typeof fetch,
      },
    });

    expect(supervisor.owned).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(spawnMock.mock.calls[0]?.[1] as string[] | undefined).toContain("4555");
    expect(spawnMock.mock.calls[1]?.[1] as string[] | undefined).toContain("4556");
    await supervisor.stop();
  });

  it("aborts hung readiness fetches and retries until the descriptor is ready", async () => {
    const entry = await makeEntry();
    const child = makeChild();
    const spawnMock = vi.fn(() => child as ChildProcess);
    let readinessAttempts = 0;
    const fetchMock = vi.fn(async (url: string) => {
      const requestPath = new URL(url).pathname;
      if (requestPath === "/.well-known/t3/environment") {
        readinessAttempts += 1;
        if (readinessAttempts === 1) {
          return neverSettlingResponse();
        }
        return new Response(JSON.stringify(descriptor), { status: 200 });
      }
      if (requestPath === "/api/auth/bootstrap/bearer") {
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
      if (requestPath === "/api/auth/session") {
        return new Response(
          JSON.stringify({ authenticated: true, auth: { mode: "desktop" }, role: "owner" }),
          { status: 200 },
        );
      }
      return new Response("not found", { status: 404 });
    });

    const supervisor = await startLocalManagedSupervisor({
      baseDir: "/tmp/t3",
      serverEntry: entry,
      newServer: true,
      spawnProcess: spawnMock as never,
      resolvePort: async () => 4559,
      fetchOptions: { fetch: fetchMock as unknown as typeof fetch },
      fetchTimeouts: { readinessRequestMs: 5, readinessDeadlineMs: 250 },
    });

    expect(readinessAttempts).toBeGreaterThanOrEqual(2);
    await supervisor.stop();
  });

  it("stops the child when repeated readiness timeouts hit the startup deadline", async () => {
    const entry = await makeEntry();
    const child = makeChild();
    const spawnMock = vi.fn(() => child as ChildProcess);
    const killMock = vi.mocked(child.kill);

    await expect(
      startLocalManagedSupervisor({
        baseDir: "/tmp/t3",
        serverEntry: entry,
        newServer: true,
        spawnProcess: spawnMock as never,
        resolvePort: async () => 4560,
        fetchOptions: { fetch: vi.fn(() => neverSettlingResponse()) as never },
        fetchTimeouts: { readinessRequestMs: 5, readinessDeadlineMs: 35 },
      }),
    ).rejects.toThrow(/Local server did not become ready/);

    expect(killMock).toHaveBeenCalledWith("SIGTERM");
  });

  it("treats a hung attach-first descriptor as stale and starts a fresh owned server", async () => {
    const baseDir = await makeBaseDir();
    const stateDir = join(baseDir, "userdata");
    await mkdir(stateDir, { recursive: true });
    await writeFile(join(stateDir, "environment-id"), "env_123\n", "utf8");
    await writeRuntimeState(stateDir, { port: 3773, origin: "http://127.0.0.1:3773" });
    const entry = await makeEntry();
    const child = makeChild();
    const spawnMock = vi.fn(() => child as ChildProcess);
    const ownedFetch = fetchSequence(ownedServerFetchEntries());
    let attachAttempted = false;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const parsed = new URL(url);
      if (parsed.port === "3773") {
        attachAttempted = true;
        return neverSettlingResponse();
      }
      return ownedFetch(url, init);
    });

    const supervisor = await startLocalManagedSupervisor({
      baseDir,
      serverEntry: entry,
      spawnProcess: spawnMock as never,
      resolvePort: async () => 4561,
      fetchOptions: { fetch: fetchMock as unknown as typeof fetch },
      fetchTimeouts: { attachRequestMs: 5, readinessRequestMs: 5, readinessDeadlineMs: 250 },
    });

    expect(attachAttempted).toBe(true);
    expect(supervisor.owned).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    await supervisor.stop();
  });

  it("bounds bootstrap, session validation, and later ws-token fetches with sanitized timeout errors", async () => {
    const entry = await makeEntry();
    const bootstrapChild = makeChild();
    const spawnMock = vi.fn(() => bootstrapChild as ChildProcess);
    const bootstrapFetch = vi.fn((url: string) => {
      const path = new URL(url).pathname;
      if (path === "/api/auth/bootstrap/bearer") return neverSettlingResponse();
      return Promise.resolve(new Response(JSON.stringify(descriptor), { status: 200 }));
    });

    await expect(
      startLocalManagedSupervisor({
        baseDir: "/tmp/t3",
        serverEntry: entry,
        newServer: true,
        spawnProcess: spawnMock as never,
        resolvePort: async () => 4562,
        fetchOptions: { fetch: bootstrapFetch as unknown as typeof fetch },
        fetchTimeouts: { readinessRequestMs: 5, bootstrapRequestMs: 5 },
      }),
    ).rejects.toThrow(/bootstrap exchange timed out after 5ms/);

    const sessionChild = makeChild();
    spawnMock.mockReturnValue(sessionChild as ChildProcess);
    const sessionFetch = vi.fn((url: string) => {
      const path = new URL(url).pathname;
      if (path === "/api/auth/session") return neverSettlingResponse();
      if (path === "/api/auth/bootstrap/bearer") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              authenticated: true,
              role: "owner",
              sessionMethod: "bearer-session-token",
              sessionToken: "bearer-secret",
              expiresAt: "2026-05-01T00:00:00.000Z",
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(new Response(JSON.stringify(descriptor), { status: 200 }));
    });

    await expect(
      startLocalManagedSupervisor({
        baseDir: "/tmp/t3",
        serverEntry: entry,
        newServer: true,
        spawnProcess: spawnMock as never,
        resolvePort: async () => 4564,
        fetchOptions: { fetch: sessionFetch as unknown as typeof fetch },
        fetchTimeouts: { readinessRequestMs: 5, bootstrapRequestMs: 5 },
      }),
    ).rejects.toThrow(/bootstrap exchange timed out after 5ms/);

    const wsChild = makeChild();
    spawnMock.mockReturnValue(wsChild as ChildProcess);
    const wsFetch = fetchSequence(ownedServerFetchEntries());
    const supervisor = await startLocalManagedSupervisor({
      baseDir: "/tmp/t3",
      serverEntry: entry,
      newServer: true,
      spawnProcess: spawnMock as never,
      resolvePort: async () => 4563,
      fetchOptions: {
        fetch: vi.fn((url: string, init?: RequestInit) => {
          if (new URL(url).pathname === "/api/auth/ws-token") return neverSettlingResponse();
          return wsFetch(url, init);
        }) as unknown as typeof fetch,
      },
      fetchTimeouts: { readinessRequestMs: 5, bootstrapRequestMs: 5 },
    });

    await expect(
      (supervisor.target.webSocketUrlProvider as () => Promise<string>)(),
    ).rejects.toThrow(/bootstrap exchange timed out after 5ms/);
    await supervisor.stop();
  });

  it("restarts an owned server after restartable exits and notifies reconnect listeners", async () => {
    const entry = await makeEntry();
    const firstChild = makeChild();
    const secondChild = makeChild();
    const spawnMock = vi
      .fn()
      .mockReturnValueOnce(firstChild as ChildProcess)
      .mockReturnValueOnce(secondChild as ChildProcess);
    const ports = [4555, 4556];
    const fetchMock = fetchSequence([
      ["/.well-known/t3/environment", descriptor],
      ["/.well-known/t3/environment", descriptor],
      [
        "/api/auth/bootstrap/bearer",
        {
          authenticated: true,
          role: "owner",
          sessionMethod: "bearer-session-token",
          sessionToken: "bearer-secret-1",
          expiresAt: "2026-05-01T00:00:00.000Z",
        },
      ],
      ["/.well-known/t3/environment", descriptor],
      ["/api/auth/session", { authenticated: true, auth: { mode: "desktop" }, role: "owner" }],
      ["/.well-known/t3/environment", descriptor],
      ["/.well-known/t3/environment", descriptor],
      [
        "/api/auth/bootstrap/bearer",
        {
          authenticated: true,
          role: "owner",
          sessionMethod: "bearer-session-token",
          sessionToken: "bearer-secret-2",
          expiresAt: "2026-05-01T00:00:00.000Z",
        },
      ],
      ["/.well-known/t3/environment", descriptor],
      ["/api/auth/session", { authenticated: true, auth: { mode: "desktop" }, role: "owner" }],
    ]);

    const supervisor = await startLocalManagedSupervisor({
      baseDir: "/tmp/t3",
      serverEntry: entry,
      newServer: true,
      spawnProcess: spawnMock as never,
      resolvePort: async () => ports.shift() ?? 4556,
      fetchOptions: { fetch: fetchMock as unknown as typeof fetch },
    });

    await new Promise<void>((resolve) => {
      supervisor.onRestarted(() => {
        resolve();
      });
      firstChild.emit("exit", 2, null);
    });

    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(supervisor.child).toBe(secondChild);
    await supervisor.stop();
  });

  it("validates local-managed startup against a real loopback readiness/auth server", async () => {
    const entry = await makeEntry();
    const child = makeChild();
    const spawnMock = vi.fn(() => child as ChildProcess);
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
        writeJson(response, { authenticated: true, auth: { mode: "desktop" }, role: "owner" });
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
      const supervisor = await startLocalManagedSupervisor({
        baseDir: "/tmp/t3",
        serverEntry: entry,
        newServer: true,
        spawnProcess: spawnMock as never,
        resolvePort: async () => server.port,
      });

      expect(supervisor.owned).toBe(true);
      expect(supervisor.target.httpBaseUrl).toBe(`http://127.0.0.1:${server.port}/`);
      await expect(
        (supervisor.target.webSocketUrlProvider as () => Promise<string>)(),
      ).resolves.toBe(`ws://127.0.0.1:${server.port}/ws?wsToken=ws-secret`);
      await supervisor.stop();
    } finally {
      await server.close();
    }
  });

  it("classifies exits for restart policy", () => {
    expect(classifyExit({ code: 0, signal: null })).toBe("requested");
    expect(classifyExit({ code: null, signal: "SIGTERM" })).toBe("requested");
    expect(classifyExit({ code: 1, signal: null, stderr: "EADDRINUSE" })).toBe("bind-failure");
    expect(classifyExit({ code: 1, signal: null, stderr: "bootstrap token failed" })).toBe(
      "auth-failure",
    );
    expect(classifyExit({ code: 2, signal: null })).toBe("restartable");
    expect(classifyExit({ code: 1, signal: null })).toBe("fatal-startup-error");
  });

  it("documents dev versus userdata state roots", () => {
    expect(localStateRootForDebug("/tmp/t3")).toBe("/tmp/t3/userdata");
    expect(localStateRootForDebug("/tmp/t3", "http://localhost:5173")).toBe("/tmp/t3/dev");
  });
});

function fetchSequence(entries: readonly (readonly [string, unknown])[]) {
  let index = 0;
  return vi.fn(async (url: string, _init?: RequestInit) => {
    const entry = entries[index++];
    if (!entry) return new Response("not found", { status: 404 });
    expect(new URL(url).pathname).toBe(entry[0]);
    if (entry[1] instanceof Response) return entry[1];
    return new Response(JSON.stringify(entry[1]), { status: 200 });
  });
}

function ownedServerFetchEntries(): readonly (readonly [string, unknown])[] {
  return [
    ["/.well-known/t3/environment", descriptor],
    ["/.well-known/t3/environment", descriptor],
    [
      "/api/auth/bootstrap/bearer",
      {
        authenticated: true,
        role: "owner",
        sessionMethod: "bearer-session-token",
        sessionToken: "bearer-secret",
        expiresAt: "2026-05-01T00:00:00.000Z",
      },
    ],
    ["/.well-known/t3/environment", descriptor],
    ["/api/auth/session", { authenticated: true, auth: { mode: "desktop" }, role: "owner" }],
  ];
}

function neverSettlingResponse(): Promise<Response> {
  return new Promise(() => {});
}

async function writeRuntimeState(
  stateDir: string,
  runtime: {
    readonly port: number;
    readonly origin: string;
  },
): Promise<void> {
  await writeFile(
    join(stateDir, "server-runtime.json"),
    JSON.stringify({
      version: 1,
      pid: process.pid,
      startedAt: "2026-04-28T00:00:00.000Z",
      ...runtime,
    }),
    "utf8",
  );
}

function expectedNodeExecutable(): string {
  return "bun" in process.versions ? "node" : process.execPath;
}

function makeChild(): ChildProcess & { bootstrapPipe: PassThrough } {
  const child = new EventEmitter() as unknown as ChildProcess & { bootstrapPipe: PassThrough };
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const bootstrapPipe = new PassThrough();
  Object.defineProperties(child, {
    stdout: { value: stdout },
    stderr: { value: stderr },
    stdio: { value: [null, stdout, stderr, bootstrapPipe] },
    exitCode: { value: null, configurable: true },
    signalCode: { value: null, configurable: true },
  });
  child.bootstrapPipe = bootstrapPipe;
  Object.defineProperty(child, "kill", {
    value: vi.fn(() => {
      child.emit("exit", null, "SIGTERM");
      return true;
    }),
  });
  return child;
}

async function makeEntry(): Promise<string> {
  const dir = await createTempDir();
  const entry = join(dir, "bin.mjs");
  await writeFile(entry, "", "utf8");
  return entry;
}

async function makeBaseDir(): Promise<string> {
  return createTempDir();
}

async function createTempDir(): Promise<string> {
  const parent = process.env.TMPDIR ?? resolve(process.cwd(), "../../.tmp/tui-tests");
  await mkdir(parent, { recursive: true });
  return mkdtemp(join(parent, "x1shell-supervisor-"));
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
