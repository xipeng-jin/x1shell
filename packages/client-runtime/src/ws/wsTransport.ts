import { Cause, Duration, Effect, Exit, ManagedRuntime, Scope, Stream } from "effect";
import { RpcClient } from "effect/unstable/rpc";

import { redactRuntimeSecretText } from "../redaction.ts";
import {
  createWsRpcProtocolLayer,
  makeWsRpcProtocolClient,
  type WsProtocolRequestTrackingHandlers,
  type WsRpcProtocolClient,
  type WsRpcProtocolOptions,
  type WsRpcProtocolSocketUrlProvider,
} from "./protocol.ts";
import { isTransportConnectionErrorMessage } from "./transportError.ts";

interface SubscribeOptions {
  readonly retryDelay?: Duration.Input;
  readonly onResubscribe?: () => void;
}

export interface RequestOptions {
  readonly timeout?: Duration.Input;
}

interface TransportSession {
  readonly clientPromise: Promise<WsRpcProtocolClient>;
  readonly clientScope: Scope.Closeable;
  readonly runtime: ManagedRuntime.ManagedRuntime<RpcClient.Protocol, never>;
}

export interface WsTransportOptions extends WsRpcProtocolOptions {
  readonly onSubscriptionError?: (metadata: { readonly message: string }) => void;
  readonly onSubscriptionDisconnect?: (metadata: { readonly message: string }) => void;
}

const DEFAULT_SUBSCRIPTION_RETRY_DELAY_MS = Duration.millis(250);
const NOOP: () => void = () => undefined;

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return redactRuntimeSecretText(error.message);
  }
  return redactRuntimeSecretText(error);
}

export class WsTransport {
  private readonly url: WsRpcProtocolSocketUrlProvider;
  private readonly options: WsTransportOptions;
  private disposed = false;
  private hasReportedTransportDisconnect = false;
  private reconnectChain: Promise<void> = Promise.resolve();
  private session: TransportSession;

  constructor(url: WsRpcProtocolSocketUrlProvider, options: WsTransportOptions = {}) {
    this.url = url;
    this.options = options;
    this.session = this.createSession();
  }

  async request<TSuccess>(
    execute: (client: WsRpcProtocolClient) => Effect.Effect<TSuccess, Error, never>,
    _options?: RequestOptions,
  ): Promise<TSuccess> {
    if (this.disposed) {
      throw new Error("Transport disposed");
    }

    const session = this.session;
    const client = await session.clientPromise;
    return await session.runtime.runPromise(Effect.suspend(() => execute(client)));
  }

  async requestStream<TValue>(
    connect: (client: WsRpcProtocolClient) => Stream.Stream<TValue, Error, never>,
    listener: (value: TValue) => void,
  ): Promise<void> {
    if (this.disposed) {
      throw new Error("Transport disposed");
    }

    const session = this.session;
    const client = await session.clientPromise;
    await session.runtime.runPromise(
      Stream.runForEach(connect(client), (value) =>
        Effect.sync(() => {
          try {
            listener(value);
          } catch {
            // Listener errors must not corrupt protocol stream cleanup.
          }
        }),
      ),
    );
  }

  subscribe<TValue>(
    connect: (client: WsRpcProtocolClient) => Stream.Stream<TValue, Error, never>,
    listener: (value: TValue) => void,
    options?: SubscribeOptions,
  ): () => void {
    if (this.disposed) {
      return () => undefined;
    }

    let active = true;
    let hasReceivedValue = false;
    const retryDelayMs = Duration.toMillis(
      Duration.fromInputUnsafe(options?.retryDelay ?? DEFAULT_SUBSCRIPTION_RETRY_DELAY_MS),
    );
    let cancelCurrentStream: () => void = NOOP;

    void (async () => {
      for (;;) {
        if (!active || this.disposed) {
          return;
        }

        const session = this.session;
        try {
          if (hasReceivedValue) {
            try {
              options?.onResubscribe?.();
            } catch {
              // Reconnect hooks are advisory and must not block stream recovery.
            }
          }

          const runningStream = this.runStreamOnSession(
            session,
            connect,
            listener,
            () => active,
            () => {
              this.hasReportedTransportDisconnect = false;
              hasReceivedValue = true;
            },
          );
          cancelCurrentStream = runningStream.cancel;
          await runningStream.completed;
          cancelCurrentStream = NOOP;
        } catch (error) {
          cancelCurrentStream = NOOP;
          if (!active || this.disposed) {
            return;
          }

          if (session !== this.session) {
            continue;
          }

          const formattedError = formatErrorMessage(error);
          if (!isTransportConnectionErrorMessage(formattedError)) {
            this.options.onSubscriptionError?.({ message: formattedError });
            return;
          }

          if (!this.hasReportedTransportDisconnect) {
            this.options.onSubscriptionDisconnect?.({ message: formattedError });
          }
          this.hasReportedTransportDisconnect = true;
          await sleep(retryDelayMs);
        }
      }
    })();

    return () => {
      active = false;
      cancelCurrentStream();
    };
  }

  async reconnect() {
    if (this.disposed) {
      throw new Error("Transport disposed");
    }

    const reconnectOperation = this.reconnectChain.then(async () => {
      if (this.disposed) {
        throw new Error("Transport disposed");
      }

      this.options.requestTracking?.onProtocolReset?.();
      const previousSession = this.session;
      this.session = this.createSession();
      await this.closeSession(previousSession);
    });

    this.reconnectChain = reconnectOperation.catch(() => undefined);
    await reconnectOperation;
  }

  async dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    await this.closeSession(this.session);
  }

  private closeSession(session: TransportSession) {
    return session.runtime.runPromise(Scope.close(session.clientScope, Exit.void)).finally(() => {
      session.runtime.dispose();
    });
  }

  private createSession(): TransportSession {
    const protocolOptions: WsRpcProtocolOptions & {
      readonly requestTracking?: WsProtocolRequestTrackingHandlers;
    } = {
      ...(this.options.lifecycle ? { lifecycle: this.options.lifecycle } : {}),
      ...(this.options.reconnect ? { reconnect: this.options.reconnect } : {}),
      ...(this.options.requestTracking ? { requestTracking: this.options.requestTracking } : {}),
      ...(this.options.webSocketConstructor
        ? { webSocketConstructor: this.options.webSocketConstructor }
        : {}),
    };
    const runtime = ManagedRuntime.make(createWsRpcProtocolLayer(this.url, protocolOptions));
    const clientScope = runtime.runSync(Scope.make());
    return {
      runtime,
      clientScope,
      clientPromise: runtime.runPromise(Scope.provide(clientScope)(makeWsRpcProtocolClient)),
    };
  }

  private runStreamOnSession<TValue>(
    session: TransportSession,
    connect: (client: WsRpcProtocolClient) => Stream.Stream<TValue, Error, never>,
    listener: (value: TValue) => void,
    isActive: () => boolean,
    markValueReceived: () => void,
  ): {
    readonly cancel: () => void;
    readonly completed: Promise<void>;
  } {
    let resolveCompleted!: () => void;
    let rejectCompleted!: (error: unknown) => void;
    const completed = new Promise<void>((resolve, reject) => {
      resolveCompleted = resolve;
      rejectCompleted = reject;
    });
    const cancel = session.runtime.runCallback(
      Effect.promise(() => session.clientPromise).pipe(
        Effect.flatMap((client) =>
          Stream.runForEach(connect(client), (value) =>
            Effect.sync(() => {
              if (!isActive()) {
                return;
              }

              markValueReceived();
              try {
                listener(value);
              } catch {
                // Listener errors must not terminate live subscriptions.
              }
            }),
          ),
        ),
      ),
      {
        onExit: (exit) => {
          if (Exit.isSuccess(exit)) {
            resolveCompleted();
            return;
          }

          rejectCompleted(Cause.squash(exit.cause));
        },
      },
    );

    return {
      cancel,
      completed,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
