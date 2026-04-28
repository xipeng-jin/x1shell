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
import type { createServerConfigStore } from "../state/serverConfigStore.js";
import type { createOrchestrationStore } from "../state/orchestrationStore.js";
import type { createThreadDetailStore } from "../state/threadDetailStore.js";
import { isSnapshotRequiredThreadEvent } from "../state/threadDetailStore.js";
import type { ThreadId } from "@t3tools/contracts";

type ServerConfigStore = ReturnType<typeof createServerConfigStore>;
type OrchestrationStore = ReturnType<typeof createOrchestrationStore>;
type ThreadDetailStore = ReturnType<typeof createThreadDetailStore>;

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
  let subscribedThreadId: ThreadId | null = null;
  let subscribedThreadGeneration: number | null = null;
  let activeThreadId: ThreadId | null = null;
  let reconnectChain: Promise<void> = Promise.resolve();
  let disposed = false;
  let connectionGeneration = 0;

  const disposeCurrent = async () => {
    connectionGeneration += 1;
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
        input.store.setConnection("reconnecting", safeOutputText(metadata.message));
        input.options?.onSubscriptionDisconnect?.(metadata);
        void scheduleReconnect();
      },
      onSubscriptionError: (metadata) => {
        input.store.setConnection("error", safeOutputText(metadata.message));
        input.options?.onSubscriptionError?.(metadata);
      },
    });
    current = connection;
    const firstShellSnapshot = deferred<void>();
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
      input.orchestrationStore?.applyShellItem(item);
      reconcileActiveThreadSubscription(connection, generation);
      if (item.kind === "snapshot") {
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
    unsubscribeThread = connection.client.orchestration.subscribeThread({ threadId }, (item) => {
      if (disposed || current !== connection || generation !== connectionGeneration) return;
      if (isSnapshotRequiredThreadEvent(item)) {
        subscribeActiveThread(connection, generation, threadId, { force: true });
        return;
      }
      input.threadDetailStore?.applyThreadItem(threadId, item);
    });
  };

  const releaseThreadSubscription = (options: { readonly evict: boolean }) => {
    const previousThreadId = subscribedThreadId;
    unsubscribeThread?.();
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

  const scheduleReconnect = () => {
    if (disposed) {
      return Promise.resolve();
    }
    reconnectChain = reconnectChain
      .then(() => connectFresh("reconnecting"))
      .catch((error) => {
        input.store.setConnection("error", safeOutputText(String(error)));
      });
    return reconnectChain;
  };

  return {
    connect: () => connectFresh("connecting"),
    reconnect: scheduleReconnect,
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
