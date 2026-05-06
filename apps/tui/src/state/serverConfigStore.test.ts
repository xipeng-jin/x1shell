import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerConfig,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import { createServerConfigStore } from "./serverConfigStore.js";

function makeConfig(): ServerConfig {
  return {
    environment: {
      environmentId: EnvironmentId.make("env_123"),
      label: "local",
      platform: { os: "linux", arch: "x64" },
      serverVersion: "0.0.21",
      capabilities: { repositoryIdentity: true },
    },
    auth: {
      policy: "desktop-managed-local",
      bootstrapMethods: ["desktop-bootstrap"],
      sessionMethods: ["bearer-session-token"],
      sessionCookieName: "t3.sid",
    },
    cwd: "/work/project",
    keybindingsConfigPath: "/tmp/keybindings.json",
    keybindings: [],
    issues: [],
    providers: [],
    availableEditors: [],
    observability: {
      logsDirectoryPath: "/tmp/logs",
      localTracingEnabled: false,
      otlpTracesEnabled: false,
      otlpMetricsEnabled: false,
    },
    settings: DEFAULT_SERVER_SETTINGS,
  };
}

describe("TUI server config store", () => {
  it("applies keybinding updates from server config stream events", () => {
    const store = createServerConfigStore();
    store.setConfig(makeConfig());

    store.applyConfigEvent({
      version: 1,
      type: "keybindingsUpdated",
      payload: {
        keybindings: [
          {
            command: "chat.new",
            shortcut: {
              key: "n",
              metaKey: false,
              ctrlKey: true,
              shiftKey: false,
              altKey: false,
              modKey: false,
            },
          },
        ],
        issues: [
          {
            kind: "keybindings.invalid-entry",
            message: "Invalid keybinding.",
            index: 0,
          },
        ],
      },
    });

    expect(store.getSnapshot().config?.keybindings).toEqual([
      expect.objectContaining({ command: "chat.new" }),
    ]);
    expect(store.getSnapshot().config?.issues).toEqual([
      expect.objectContaining({ kind: "keybindings.invalid-entry" }),
    ]);
  });

  it("accepts provider status advisory metadata without changing config handling", () => {
    const store = createServerConfigStore();
    store.setConfig(makeConfig());

    const provider: ServerProvider = {
      instanceId: ProviderInstanceId.make("codex_work"),
      driver: ProviderDriverKind.make("codex"),
      displayName: "Codex Work",
      enabled: true,
      installed: true,
      version: "0.50.0",
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-04-30T00:00:00.000Z",
      models: [],
      slashCommands: [],
      skills: [],
      versionAdvisory: {
        status: "behind_latest",
        currentVersion: "0.50.0",
        latestVersion: "0.51.0",
        updateCommand: "npm install -g @openai/codex@latest",
        canUpdate: true,
        checkedAt: "2026-04-30T00:00:00.000Z",
        message: null,
      },
      updateState: {
        status: "running",
        startedAt: "2026-04-30T00:00:01.000Z",
        finishedAt: null,
        message: "Updating Codex...",
        output: null,
      },
    };

    store.applyConfigEvent({
      version: 1,
      type: "providerStatuses",
      payload: { providers: [provider] },
    });

    expect(store.getSnapshot().config?.providers).toEqual([provider]);
    expect(store.getSnapshot().config?.issues).toEqual([]);
  });
});
