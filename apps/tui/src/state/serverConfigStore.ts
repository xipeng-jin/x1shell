import type {
  OrchestrationShellSnapshot,
  OrchestrationShellStreamItem,
  ServerConfig,
  ServerConfigStreamEvent,
  ServerLifecycleStreamReadyEvent,
  ServerLifecycleStreamEvent,
  ServerLifecycleStreamWelcomeEvent,
} from "@t3tools/contracts";

export interface TuiServerStatusSnapshot {
  readonly connection: "idle" | "connecting" | "connected" | "reconnecting" | "error";
  readonly auth: "none" | "bearer" | "bootstrap" | "owner";
  readonly config: ServerConfig | null;
  readonly latestWelcome: ServerLifecycleStreamWelcomeEvent | null;
  readonly latestReady: ServerLifecycleStreamReadyEvent | null;
  readonly shell: OrchestrationShellSnapshot | null;
  readonly error: string | null;
}

export type TuiServerStatusListener = (snapshot: TuiServerStatusSnapshot) => void;

export function createServerConfigStore(initial?: Partial<TuiServerStatusSnapshot>) {
  let snapshot: TuiServerStatusSnapshot = {
    connection: "idle",
    auth: "none",
    config: null,
    latestWelcome: null,
    latestReady: null,
    shell: null,
    error: null,
    ...initial,
  };
  const listeners = new Set<TuiServerStatusListener>();

  const emit = () => {
    for (const listener of listeners) {
      listener(snapshot);
    }
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: TuiServerStatusListener) => {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    setConnection: (
      connection: TuiServerStatusSnapshot["connection"],
      error: string | null = null,
    ) => {
      snapshot = { ...snapshot, connection, error };
      emit();
    },
    setAuth: (auth: TuiServerStatusSnapshot["auth"]) => {
      snapshot = { ...snapshot, auth };
      emit();
    },
    setConfig: (config: ServerConfig) => {
      snapshot = { ...snapshot, config };
      emit();
    },
    applyConfigEvent: (event: ServerConfigStreamEvent) => {
      if (event.type === "snapshot") {
        snapshot = { ...snapshot, config: event.config };
      } else if (snapshot.config && event.type === "providerStatuses") {
        snapshot = {
          ...snapshot,
          config: { ...snapshot.config, providers: event.payload.providers },
        };
      } else if (snapshot.config && event.type === "settingsUpdated") {
        snapshot = {
          ...snapshot,
          config: { ...snapshot.config, settings: event.payload.settings },
        };
      } else if (snapshot.config && event.type === "keybindingsUpdated") {
        snapshot = {
          ...snapshot,
          config: {
            ...snapshot.config,
            keybindings: event.payload.keybindings,
            issues: event.payload.issues,
          },
        };
      }
      emit();
    },
    applyLifecycleEvent: (event: ServerLifecycleStreamEvent) => {
      snapshot = {
        ...snapshot,
        latestWelcome: event.type === "welcome" ? event : snapshot.latestWelcome,
        latestReady: event.type === "ready" ? event : snapshot.latestReady,
      };
      emit();
    },
    applyShellItem: (item: OrchestrationShellStreamItem) => {
      if (item.kind === "snapshot") {
        snapshot = { ...snapshot, shell: item.snapshot };
      } else if (snapshot.shell) {
        snapshot = { ...snapshot, shell: applyShellEvent(snapshot.shell, item) };
      }
      emit();
    },
  };
}

function applyShellEvent(
  snapshot: OrchestrationShellSnapshot,
  item: Exclude<OrchestrationShellStreamItem, { kind: "snapshot" }>,
): OrchestrationShellSnapshot {
  if (item.sequence <= snapshot.snapshotSequence) return snapshot;
  if (item.kind === "project-upserted") {
    return {
      ...snapshot,
      snapshotSequence: item.sequence,
      projects: upsertById(snapshot.projects, item.project),
    };
  }
  if (item.kind === "project-removed") {
    return {
      ...snapshot,
      snapshotSequence: item.sequence,
      projects: snapshot.projects.filter((project) => project.id !== item.projectId),
    };
  }
  if (item.kind === "thread-upserted") {
    return {
      ...snapshot,
      snapshotSequence: item.sequence,
      threads: upsertById(snapshot.threads, item.thread),
    };
  }
  return {
    ...snapshot,
    snapshotSequence: item.sequence,
    threads: snapshot.threads.filter((thread) => thread.id !== item.threadId),
  };
}

function upsertById<T extends { readonly id: string }>(values: readonly T[], value: T): T[] {
  const next = values.filter((entry) => entry.id !== value.id);
  next.push(value);
  return next;
}
