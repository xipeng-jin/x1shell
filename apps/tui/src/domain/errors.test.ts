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
        provider: "codex",
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
});
