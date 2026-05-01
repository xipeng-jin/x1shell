import { describe, expect, it } from "vitest";
import { deriveErrorBanners } from "./errors.js";

describe("TUI error banner derivation", () => {
  it("guides reconnect and attach auth states", () => {
    const banners = deriveErrorBanners({
      status: {
        connection: "error",
        auth: "none",
        config: null,
        latestWelcome: null,
        latestReady: null,
        shell: null,
        error: "wsToken=secret failed",
      },
    });

    expect(banners.map((banner) => banner.title)).toEqual(
      expect.arrayContaining(["Connection error", "Attach auth required"]),
    );
    expect(banners[0]?.detail).not.toContain("secret");
  });

  it("reports provider authentication problems", () => {
    const banners = deriveErrorBanners({
      status: {
        connection: "connected",
        auth: "owner",
        config: { issues: [] } as never,
        latestWelcome: null,
        latestReady: null,
        shell: null,
        error: null,
      },
      provider: {
        instanceId: "codex",
        driver: "codex",
        displayName: "Codex",
        enabled: true,
        installed: true,
        status: "ready",
        auth: { status: "unauthenticated" },
        models: [],
      } as never,
    });

    expect(banners[0]).toMatchObject({ title: "Provider auth required" });
  });

  it("reports unavailable provider instances before disabled state", () => {
    const banners = deriveErrorBanners({
      status: {
        connection: "connected",
        auth: "owner",
        config: { issues: [] } as never,
        latestWelcome: null,
        latestReady: null,
        shell: null,
        error: null,
      },
      provider: {
        instanceId: "codex_fork",
        driver: "forkDriver",
        displayName: "Fork Driver",
        enabled: false,
        installed: false,
        availability: "unavailable",
        unavailableReason: "Driver forkDriver is not available in this build.",
        status: "disabled",
        auth: { status: "unknown" },
        models: [],
      } as never,
    });

    expect(banners[0]).toMatchObject({
      title: "Provider unavailable",
      detail: "Driver forkDriver is not available in this build.",
      actionHint: "Open settings",
    });
  });
});
