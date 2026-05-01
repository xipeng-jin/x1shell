import {
  defaultInstanceIdForDriver,
  PROVIDER_DISPLAY_NAMES,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";

export interface TuiProviderInstanceEntry {
  readonly instanceId: ProviderInstanceId;
  readonly driver: ProviderDriverKind;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly installed: boolean;
  readonly available: boolean;
  readonly provider: ServerProvider;
  readonly models: readonly ServerProviderModel[];
}

export const DEFAULT_TUI_PROVIDER_DRIVER = ProviderDriverKind.make("codex");
export const DEFAULT_TUI_PROVIDER_INSTANCE_ID = defaultInstanceIdForDriver(
  DEFAULT_TUI_PROVIDER_DRIVER,
);

export function createDefaultTuiModelSelection(model = "gpt-5") {
  return {
    instanceId: DEFAULT_TUI_PROVIDER_INSTANCE_ID,
    model,
  };
}

export function deriveProviderInstanceEntries(
  providers: readonly ServerProvider[],
): readonly TuiProviderInstanceEntry[] {
  return providers.map((provider) => {
    const instanceId = provider.instanceId;
    const driver = provider.driver;
    return {
      instanceId,
      driver,
      displayName: providerLabel(provider),
      enabled: provider.enabled,
      installed: provider.installed,
      available: provider.availability !== "unavailable",
      provider,
      models: provider.models,
    };
  });
}

export function findProviderInstance(
  providers: readonly ServerProvider[],
  instanceId: ProviderInstanceId | null | undefined,
): ServerProvider | null {
  const entries = deriveProviderInstanceEntries(providers);
  if (instanceId) {
    const selected = entries.find((entry) => entry.instanceId === instanceId);
    return selected?.provider ?? null;
  }
  return (
    entries.find((entry) => entry.enabled && entry.installed && entry.available)?.provider ?? null
  );
}

export function providerLabel(provider: ServerProvider): string {
  const explicitName = provider.displayName?.trim();
  if (explicitName && explicitName !== driverLabel(provider.driver)) return explicitName;
  const defaultId = defaultInstanceIdForDriver(provider.driver);
  if (provider.instanceId !== defaultId) return humanizeProviderSlug(provider.instanceId);
  return explicitName || driverLabel(provider.driver);
}

export function driverLabel(driver: ProviderDriverKind): string {
  return PROVIDER_DISPLAY_NAMES[driver] ?? humanizeProviderSlug(driver);
}

export function providerSelectable(provider: ServerProvider): boolean {
  return provider.enabled && provider.installed && provider.availability !== "unavailable";
}

function humanizeProviderSlug(slug: string): string {
  return slug
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(" ")
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}
