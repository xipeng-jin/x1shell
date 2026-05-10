import { EnvironmentId, type SourceControlDiscoveryResult } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resetAppAtomRegistryForTests } from "../rpc/atomRegistry";
import {
  getSourceControlDiscoverySnapshot,
  refreshSourceControlDiscovery,
  resetSourceControlDiscoveryStateForTests,
} from "./sourceControlDiscoveryState";

const serviceHarness = vi.hoisted(() => ({
  connections: new Map<string, any>(),
}));

const primaryHarness = vi.hoisted(() => ({
  descriptor: null as { environmentId: string } | null,
}));

const localApiHarness = vi.hoisted(() => ({
  server: null as { discoverSourceControl: ReturnType<typeof vi.fn> } | null,
}));

vi.mock("../environments/primary", () => ({
  readPrimaryEnvironmentDescriptor: () => primaryHarness.descriptor,
}));

vi.mock("../environments/runtime", () => ({
  readEnvironmentConnection: (environmentId: string) =>
    serviceHarness.connections.get(environmentId) ?? null,
}));

vi.mock("../localApi", () => ({
  readLocalApi: () => (localApiHarness.server ? { server: localApiHarness.server } : null),
}));

const EMPTY_RESULT: SourceControlDiscoveryResult = {
  versionControlSystems: [],
  sourceControlProviders: [],
};

const PRIMARY_RESULT: SourceControlDiscoveryResult = {
  versionControlSystems: [],
  sourceControlProviders: [
    {
      kind: "github",
      label: "GitHub",
      status: "available",
      version: Option.none(),
      installHint: "Install GitHub CLI.",
      detail: Option.none(),
      auth: {
        status: "authenticated",
        account: Option.some("primary-user"),
        host: Option.some("github.com"),
        detail: Option.none(),
      },
    },
  ],
};

const REMOTE_RESULT: SourceControlDiscoveryResult = {
  versionControlSystems: [],
  sourceControlProviders: [
    {
      kind: "gitlab",
      label: "GitLab",
      status: "available",
      version: Option.none(),
      installHint: "Install GitLab CLI.",
      detail: Option.none(),
      auth: {
        status: "authenticated",
        account: Option.some("remote-user"),
        host: Option.some("gitlab.com"),
        detail: Option.none(),
      },
    },
  ],
};

const PRIMARY_ENVIRONMENT_ID = EnvironmentId.make("environment-primary");
const REMOTE_ENVIRONMENT_ID = EnvironmentId.make("environment-remote");

function registerDiscoveryClient(environmentId: string, result: SourceControlDiscoveryResult) {
  const discoverSourceControl = vi.fn(async () => result);
  serviceHarness.connections.set(environmentId, {
    client: {
      server: {
        discoverSourceControl,
      },
    },
  });
  return discoverSourceControl;
}

afterEach(() => {
  serviceHarness.connections.clear();
  primaryHarness.descriptor = null;
  localApiHarness.server = null;
  resetSourceControlDiscoveryStateForTests();
  resetAppAtomRegistryForTests();
});

describe("sourceControlDiscoveryState", () => {
  it("uses the primary environment connection for null and primary targets", async () => {
    primaryHarness.descriptor = { environmentId: PRIMARY_ENVIRONMENT_ID };
    const primaryDiscovery = registerDiscoveryClient(PRIMARY_ENVIRONMENT_ID, PRIMARY_RESULT);

    await expect(refreshSourceControlDiscovery()).resolves.toBe(PRIMARY_RESULT);
    await expect(
      refreshSourceControlDiscovery({ environmentId: PRIMARY_ENVIRONMENT_ID }),
    ).resolves.toBe(PRIMARY_RESULT);

    expect(primaryDiscovery).toHaveBeenCalledTimes(2);
    expect(getSourceControlDiscoverySnapshot({ environmentId: PRIMARY_ENVIRONMENT_ID }).data).toBe(
      PRIMARY_RESULT,
    );
  });

  it("uses the active remote environment connection for remote targets", async () => {
    primaryHarness.descriptor = { environmentId: PRIMARY_ENVIRONMENT_ID };
    const primaryDiscovery = registerDiscoveryClient(PRIMARY_ENVIRONMENT_ID, PRIMARY_RESULT);
    const remoteDiscovery = registerDiscoveryClient(REMOTE_ENVIRONMENT_ID, REMOTE_RESULT);

    await expect(
      refreshSourceControlDiscovery({ environmentId: REMOTE_ENVIRONMENT_ID }),
    ).resolves.toBe(REMOTE_RESULT);

    expect(remoteDiscovery).toHaveBeenCalledOnce();
    expect(primaryDiscovery).not.toHaveBeenCalled();
    expect(getSourceControlDiscoverySnapshot({ environmentId: REMOTE_ENVIRONMENT_ID }).data).toBe(
      REMOTE_RESULT,
    );
  });

  it("falls back to the local API when the primary connection is unavailable", async () => {
    const localDiscovery = vi.fn(async () => EMPTY_RESULT);
    localApiHarness.server = {
      discoverSourceControl: localDiscovery,
    };

    await expect(refreshSourceControlDiscovery()).resolves.toBe(EMPTY_RESULT);

    expect(localDiscovery).toHaveBeenCalledOnce();
  });
});
