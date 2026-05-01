import { describe, expect, it } from "vitest";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { findProviderInstance } from "./providerInstances.js";

describe("TUI provider instance helpers", () => {
  it("does not fall back to another provider when the selected instance is missing", () => {
    const providers = [provider({ instanceId: "codex", driver: "codex", displayName: "Codex" })];

    expect(findProviderInstance(providers, ProviderInstanceId.make("codex_work"))).toBeNull();
  });

  it("falls back to the first selectable provider when no instance is selected", () => {
    const codex = provider({ instanceId: "codex", driver: "codex", displayName: "Codex" });
    const providers = [
      provider({
        instanceId: "missing_driver",
        driver: "forkDriver",
        displayName: "Missing Driver",
        enabled: false,
        installed: false,
        availability: "unavailable",
      }),
      codex,
    ];

    expect(findProviderInstance(providers, null)).toBe(codex);
  });
});

function provider(input: {
  readonly instanceId: string;
  readonly driver: string;
  readonly displayName: string;
  readonly enabled?: boolean;
  readonly installed?: boolean;
  readonly availability?: ServerProvider["availability"];
}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(input.instanceId),
    driver: ProviderDriverKind.make(input.driver),
    displayName: input.displayName,
    enabled: input.enabled ?? true,
    installed: input.installed ?? true,
    version: null,
    status: input.enabled === false ? "disabled" : "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-04-30T00:00:00.000Z",
    availability: input.availability,
    models: [],
    slashCommands: [],
    skills: [],
  };
}
