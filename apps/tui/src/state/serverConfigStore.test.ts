import { DEFAULT_SERVER_SETTINGS, EnvironmentId, type ServerConfig } from "@t3tools/contracts";
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
});
