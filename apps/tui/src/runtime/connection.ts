import {
  createWsRpcClient,
  WsTransport,
  type WebSocketConstructorLike,
  type WsProtocolLifecycleHandlers,
  type WsProtocolRequestTrackingHandlers,
  type WsRpcClient,
  type WsRpcProtocolSocketUrlProvider,
} from "@t3tools/client-runtime/ws";
import {
  resolveAuthenticatedWebSocketUrl,
  type EnvironmentFetchOptions,
} from "@t3tools/client-runtime/environment";
import type { AttachTarget } from "./attach.js";
import { safeOutputText } from "./log.js";
import { createStreamBatcher, type StreamBatcher } from "./streamBatcher.js";
import type { createServerConfigStore } from "../state/serverConfigStore.js";
import type { createOrchestrationStore } from "../state/orchestrationStore.js";
import type { createThreadDetailStore } from "../state/threadDetailStore.js";
import { isSnapshotRequiredThreadEvent } from "../state/threadDetailStore.js";
import type { ThreadId } from "@t3tools/contracts";

type ServerConfigStore = ReturnType<typeof createServerConfigStore>;
type OrchestrationStore = ReturnType<typeof createOrchestrationStore>;
type ThreadDetailStore = ReturnType<typeof createThreadDetailStore>;

const INITIAL_RECONNECT_DELAY_MS = 250;
const MAX_RECONNECT_DELAY_MS = 5_000;

export interface TuiWsConnectionOptions {
  readonly lifecycle?: WsProtocolLifecycleHandlers;
  readonly requestTracking?: WsProtocolRequestTrackingHandlers;
  readonly webSocketConstructor?: WebSocketConstructorLike;
  readonly onSubscriptionError?: (metadata: { readonly message: string }) => void;
  readonly onSubscriptionDisconnect?: (metadata: { readonly message: string }) => void;
}

export interface TuiWsConnection {
  readonly client: WsRpcClient;
  readonly transport: WsTransport;
  readonly dispose: () => Promise<void>;
}

export function createTuiWsConnection(
  url: WsRpcProtocolSocketUrlProvider,
  options: TuiWsConnectionOptions = {},
): TuiWsConnection {
  const transport = new WsTransport(url, options);
  const client = createWsRpcClient(transport);
  return {
    client,
    transport,
    dispose: () => transport.dispose(),
  };
}

export function resolveTuiAuthenticatedWebSocketUrl(input: {
  readonly wsBaseUrl: string | URL;
  readonly httpBaseUrl: string | URL;
  readonly bearerToken: string;
  readonly options?: EnvironmentFetchOptions;
}): Promise<string> {
  return resolveAuthenticatedWebSocketUrl(input);
}

export interface TuiConnectionController {
  readonly connect: () => Promise<void>;
  readonly reconnect: () => Promise<void>;
  readonly setActiveThread: (threadId: ThreadId | null) => void;
  readonly dispatchCommand: WsRpcClient["orchestration"]["dispatchCommand"];
  readonly dispose: () => Promise<void>;
}

export function createTuiConnectionController(input: {
  readonly target: AttachTarget;
  readonly store: ServerConfigStore;
  readonly orchestrationStore?: OrchestrationStore;
  readonly threadDetailStore?: ThreadDetailStore;
  readonly options?: TuiWsConnectionOptions;
  readonly createConnection?: typeof createTuiWsConnection;
}): TuiConnectionController {
  let current: TuiWsConnection | null = null;
  let unsubscribeConfig: (() => void) | null = null;
  let unsubscribeLifecycle: (() => void) | null = null;
  let unsubscribeShell: (() => void) | null = null;
  let unsubscribeThread: (() => void) | null = null;
  let shellBatcher: StreamBatcher<Parameters<OrchestrationStore["applyShellItem"]>[0]> | null =
    null;
  let threadBatcher: StreamBatcher<Parameters<ThreadDetailStore["applyThreadItem"]>[1]> | null =
    null;
  let subscribedThreadId: ThreadId | null = null;
  let subscribedThreadGeneration: number | null = null;
  let activeThreadId: ThreadId | null = null;
  let reconnectChain: Promise<void> = Promise.resolve();
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
  let disposed = false;
  let connectionGeneration = 0;

  const clearReconnectTimer = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const disposeCurrent = async () => {
    connectionGeneration += 1;
    shellBatcher?.dispose();
    threadBatcher?.dispose();
    shellBatcher = null;
    threadBatcher = null;
    unsubscribeShell?.();
    releaseThreadSubscription({ evict: false });
    unsubscribeLifecycle?.();
    unsubscribeConfig?.();
    unsubscribeShell = null;
    unsubscribeLifecycle = null;
    unsubscribeConfig = null;
    await current?.dispose();
    current = null;
  };

  const handleSubscriptionIssue = (
    generation: number,
    kind: "disconnect" | "error",
    metadata: { readonly message: string },
  ) => {
    if (disposed || generation !== connectionGeneration) return;
    input.store.setConnection("reconnecting", safeOutputText(metadata.message));
    if (kind === "disconnect") {
      input.options?.onSubscriptionDisconnect?.(metadata);
    } else {
      input.options?.onSubscriptionError?.(metadata);
    }
    void scheduleReconnect({ generation });
  };

  const connectFresh = async (status: "connecting" | "reconnecting") => {
    if (disposed) {
      throw new Error("Connection controller disposed");
    }
    input.store.setConnection(status);
    await disposeCurrent();
    const generation = connectionGeneration;
    const connectionFactory = input.createConnection ?? createTuiWsConnection;
    const connection = connectionFactory(input.target.webSocketUrlProvider, {
      ...input.options,
      onSubscriptionDisconnect: (metadata) => {
        handleSubscriptionIssue(generation, "disconnect", metadata);
      },
      onSubscriptionError: (metadata) => {
        handleSubscriptionIssue(generation, "error", metadata);
      },
    });
    current = connection;
    const firstShellSnapshot = deferred<void>();
    shellBatcher = createStreamBatcher({
      onFlush: (items) => {
        input.orchestrationStore?.applyShellItems(items);
        reconcileActiveThreadSubscription(connection, generation);
      },
    });
    unsubscribeConfig = connection.client.server.subscribeConfig((event) => {
      input.store.applyConfigEvent(event);
    });
    void connection.client.server.getConfig().then(
      (config) => {
        if (!disposed && current === connection && generation === connectionGeneration) {
          input.store.setConfig(config);
        }
      },
      (error) => {
        if (!disposed && current === connection && generation === connectionGeneration) {
          input.store.setConnection("error", safeOutputText(String(error)));
        }
      },
    );
    unsubscribeLifecycle = connection.client.server.subscribeLifecycle((event) => {
      input.store.applyLifecycleEvent(event);
    });
    unsubscribeShell = connection.client.orchestration.subscribeShell((item) => {
      if (disposed || current !== connection || generation !== connectionGeneration) {
        return;
      }
      input.store.applyShellItem(item);
      shellBatcher?.push(item);
      if (item.kind === "snapshot") {
        shellBatcher?.flush();
        reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
        input.store.setConnection("connected");
        firstShellSnapshot.resolve();
      }
    });
    if (activeThreadId) {
      subscribeActiveThread(connection, generation, activeThreadId);
    }
    await withTimeout(
      firstShellSnapshot.promise,
      15_000,
      "Timed out waiting for initial shell snapshot.",
    );
  };

  const subscribeActiveThread = (
    connection: TuiWsConnection,
    generation: number,
    threadId: ThreadId,
    options: { readonly force?: boolean } = {},
  ) => {
    if (
      !options.force &&
      unsubscribeThread &&
      subscribedThreadId === threadId &&
      subscribedThreadGeneration === generation
    ) {
      return;
    }
    const previousThreadId = subscribedThreadId;
    releaseThreadSubscription({
      evict: Boolean(previousThreadId && previousThreadId !== threadId && !options.force),
    });
    subscribedThreadId = threadId;
    subscribedThreadGeneration = generation;
    threadBatcher?.dispose();
    threadBatcher = createStreamBatcher({
      onFlush: (items) => input.threadDetailStore?.applyThreadItems(threadId, items),
    });
    unsubscribeThread = connection.client.orchestration.subscribeThread({ threadId }, (item) => {
      if (disposed || current !== connection || generation !== connectionGeneration) return;
      if (isSnapshotRequiredThreadEvent(item)) {
        subscribeActiveThread(connection, generation, threadId, { force: true });
        return;
      }
      threadBatcher?.push(item);
      if (item.kind === "snapshot") threadBatcher?.flush();
    });
  };

  const releaseThreadSubscription = (options: { readonly evict: boolean }) => {
    const previousThreadId = subscribedThreadId;
    unsubscribeThread?.();
    threadBatcher?.dispose();
    threadBatcher = null;
    unsubscribeThread = null;
    subscribedThreadId = null;
    subscribedThreadGeneration = null;
    if (options.evict && previousThreadId) {
      input.threadDetailStore?.clearThread(previousThreadId);
    }
  };

  const reconcileActiveThreadSubscription = (connection: TuiWsConnection, generation: number) => {
    const shell = input.orchestrationStore?.getSnapshot();
    if (!shell) return;
    const selectedThreadId = shell?.selectedThreadId ?? null;
    if (!selectedThreadId) {
      activeThreadId = null;
      releaseThreadSubscription({ evict: true });
      return;
    }
    activeThreadId = selectedThreadId;
    subscribeActiveThread(connection, generation, selectedThreadId);
  };

  const scheduleReconnect = (
    options: { readonly immediate?: boolean; readonly generation?: number } = {},
  ) => {
    if (disposed) {
      return Promise.resolve();
    }
    if (options.generation !== undefined && options.generation !== connectionGeneration) {
      return reconnectChain;
    }
    if (reconnectTimer) {
      return reconnectChain;
    }
    const delayMs = options.immediate ? 0 : reconnectDelayMs;
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
    reconnectChain = reconnectChain
      .then(
        () =>
          new Promise<void>((resolve) => {
            reconnectTimer = setTimeout(() => {
              reconnectTimer = null;
              resolve();
            }, delayMs);
            reconnectTimer.unref?.();
          }),
      )
      .then(() => {
        if (
          disposed ||
          (options.generation !== undefined && options.generation !== connectionGeneration)
        ) {
          return undefined;
        }
        return connectFresh("reconnecting");
      })
      .catch((error) => {
        clearReconnectTimer();
        input.store.setConnection("error", safeOutputText(String(error)));
      });
    return reconnectChain;
  };

  return {
    connect: () => connectFresh("connecting"),
    reconnect: () => scheduleReconnect({ immediate: true }),
    setActiveThread: (threadId) => {
      activeThreadId = threadId;
      if (current && threadId) {
        subscribeActiveThread(current, connectionGeneration, threadId);
      } else {
        releaseThreadSubscription({ evict: true });
      }
    },
    dispatchCommand: (command) => {
      if (!current) return Promise.reject(new Error("Not connected."));
      return current.client.orchestration.dispatchCommand(command);
    },
    dispose: async () => {
      disposed = true;
      clearReconnectTimer();
      await disposeCurrent();
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
