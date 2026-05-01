import type { ServerProvider, ServerConfig } from "@t3tools/contracts";
import type { TuiServerStatusSnapshot } from "../state/serverConfigStore.js";
import { displayText } from "./display.js";
import { providerLabel } from "./providerInstances.js";

export type TuiErrorBannerKind = "info" | "warning" | "danger";

export interface TuiErrorBanner {
  readonly kind: TuiErrorBannerKind;
  readonly title: string;
  readonly detail: string;
  readonly actionHint?: string;
}

export function deriveErrorBanners(input: {
  readonly status: TuiServerStatusSnapshot;
  readonly provider?: ServerProvider | null;
}): readonly TuiErrorBanner[] {
  const banners: TuiErrorBanner[] = [];
  const status = input.status;
  if (status.connection === "connecting") {
    banners.push(info("Connecting", "Opening the RPC session and waiting for shell state."));
  } else if (status.connection === "reconnecting") {
    banners.push(
      info(
        "Reconnecting",
        displayText(status.error ?? "Resubscribing to server streams."),
        "R reconnect",
      ),
    );
  } else if (status.connection === "error") {
    banners.push(
      danger(
        "Connection error",
        displayText(status.error ?? "The TUI is disconnected."),
        "R reconnect",
      ),
    );
  } else if (status.connection === "idle") {
    banners.push(info("Not connected", "No server connection has been established yet."));
  }

  if (status.auth === "none" && status.connection !== "connected") {
    banners.push(
      warning("Attach auth required", "Provide a bearer or bootstrap credential for attach mode."),
    );
  }
  if (status.latestWelcome && !status.latestReady) {
    banners.push(info("Server starting", "The server is up but runtime startup is not ready yet."));
  }
  for (const issue of status.config?.issues ?? []) {
    const message = typeof issue === "string" ? issue : JSON.stringify(issue);
    if (/auth|unauthor/i.test(message)) {
      banners.push(
        warning("Auth issue", displayText(message), "Refresh credentials or reconnect."),
      );
    }
  }

  const providerBanner = deriveProviderBanner(input.provider, status.config);
  if (providerBanner) banners.push(providerBanner);
  return banners.slice(0, 3);
}

function deriveProviderBanner(
  provider: ServerProvider | null | undefined,
  config: ServerConfig | null,
): TuiErrorBanner | null {
  if (!config) return null;
  if (!provider)
    return warning(
      "Provider missing",
      "No provider is available for the selected model.",
      "Refresh providers",
    );
  if (provider.availability === "unavailable") {
    return warning(
      "Provider unavailable",
      displayText(provider.unavailableReason ?? `${providerLabel(provider)} is unavailable.`),
      "Open settings",
    );
  }
  if (!provider.enabled || provider.status === "disabled") {
    return warning(
      "Provider disabled",
      `${displayText(providerLabel(provider))} is disabled.`,
      "Open settings",
    );
  }
  if (provider.auth.status === "unauthenticated") {
    return warning(
      "Provider auth required",
      `${displayText(providerLabel(provider))} is not authenticated.`,
      "Attach auth in the web UI or provider CLI",
    );
  }
  if (provider.status === "error") {
    return danger(
      "Provider error",
      displayText(provider.message ?? `${providerLabel(provider)} is unavailable.`),
      "Refresh providers",
    );
  }
  if (provider.status === "warning") {
    return warning(
      "Provider warning",
      displayText(provider.message ?? `${providerLabel(provider)} reported a warning.`),
      "Refresh providers",
    );
  }
  return null;
}

function info(title: string, detail: string, actionHint?: string): TuiErrorBanner {
  return { kind: "info", title, detail, ...(actionHint ? { actionHint } : {}) };
}

function warning(title: string, detail: string, actionHint?: string): TuiErrorBanner {
  return { kind: "warning", title, detail, ...(actionHint ? { actionHint } : {}) };
}

function danger(title: string, detail: string, actionHint?: string): TuiErrorBanner {
  return { kind: "danger", title, detail, ...(actionHint ? { actionHint } : {}) };
}
