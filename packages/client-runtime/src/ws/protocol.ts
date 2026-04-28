import { WsRpcGroup } from "@t3tools/contracts";
import { Duration, Effect, Layer, Schedule } from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import * as Socket from "effect/unstable/socket/Socket";

import { redactRuntimeSecretText } from "../redaction.ts";

export interface SafeWsConnectionMetadata {
  readonly protocol: "ws:" | "wss:";
  readonly origin: string;
  readonly pathname: "/ws";
  readonly hasQuery: boolean;
  readonly queryParamNames: readonly string[];
}

export interface WsProtocolLifecycleHandlers {
  readonly onAttempt?: (metadata: SafeWsConnectionMetadata) => void;
  readonly onOpen?: (metadata: SafeWsConnectionMetadata) => void;
  readonly onError?: (message: string, metadata: SafeWsConnectionMetadata | null) => void;
  readonly onClose?: (
    details: { readonly code: number; readonly reason: string },
    metadata: SafeWsConnectionMetadata,
  ) => void;
}

export interface WsProtocolRequestTrackingHandlers {
  readonly onRequestSent?: (metadata: { readonly requestId: string; readonly tag: string }) => void;
  readonly onRequestAcknowledged?: (metadata: { readonly requestId: string }) => void;
  readonly onProtocolReset?: () => void;
}

export type WebSocketConstructorLike = new (
  url: string | URL,
  protocols?: string | string[],
) => WebSocket;

export interface WsRpcProtocolOptions {
  readonly lifecycle?: WsProtocolLifecycleHandlers;
  readonly requestTracking?: WsProtocolRequestTrackingHandlers;
  readonly webSocketConstructor?: WebSocketConstructorLike;
  readonly reconnect?: {
    readonly maxRetries?: number;
    readonly delayForRetry?: (retryCount: number) => Duration.Input | null | undefined;
  };
}

export const makeWsRpcProtocolClient = RpcClient.make(WsRpcGroup);
type RpcClientFactory = typeof makeWsRpcProtocolClient;
export type WsRpcProtocolClient =
  RpcClientFactory extends Effect.Effect<infer Client, any, any> ? Client : never;
export type WsRpcProtocolSocketUrlProvider = string | URL | (() => Promise<string | URL>);

const DEFAULT_RECONNECT_MAX_RETRIES = 100;

function formatSocketErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return redactRuntimeSecretText(error.message);
  }
  return redactRuntimeSecretText(error);
}

export function getSafeWsConnectionMetadata(socketUrl: string | URL): SafeWsConnectionMetadata {
  const resolved = new URL(socketUrl);
  if (resolved.protocol !== "ws:" && resolved.protocol !== "wss:") {
    throw new Error(`Unsupported websocket transport URL protocol: ${resolved.protocol}`);
  }

  return {
    protocol: resolved.protocol,
    origin: resolved.origin,
    pathname: "/ws",
    hasQuery: resolved.searchParams.size > 0,
    queryParamNames: [...new Set(resolved.searchParams.keys())].toSorted(),
  };
}

export function resolveWsRpcSocketUrl(rawUrl: string | URL): string {
  const resolved = new URL(rawUrl);
  if (resolved.protocol !== "ws:" && resolved.protocol !== "wss:") {
    throw new Error(`Unsupported websocket transport URL protocol: ${resolved.protocol}`);
  }

  resolved.pathname = "/ws";
  resolved.hash = "";
  return resolved.toString();
}

function resolveWebSocketConstructor(
  provided: WebSocketConstructorLike | undefined,
): WebSocketConstructorLike {
  if (provided) {
    return provided;
  }
  if (typeof globalThis.WebSocket !== "undefined") {
    return globalThis.WebSocket as WebSocketConstructorLike;
  }
  throw new Error("No WebSocket constructor is available. Pass webSocketConstructor explicitly.");
}

export function createWsRpcProtocolLayer(
  url: WsRpcProtocolSocketUrlProvider,
  options: WsRpcProtocolOptions = {},
) {
  const resolvedUrlEffect =
    typeof url === "function"
      ? Effect.promise(() => url()).pipe(
          Effect.map((rawUrl) => resolveWsRpcSocketUrl(rawUrl)),
          Effect.tapError((error) =>
            Effect.sync(() => {
              options.lifecycle?.onError?.(formatSocketErrorMessage(error), null);
            }),
          ),
          Effect.orDie,
        )
      : resolveWsRpcSocketUrl(url);

  const webSocketConstructor = resolveWebSocketConstructor(options.webSocketConstructor);
  const trackingWebSocketConstructorLayer = Layer.succeed(
    Socket.WebSocketConstructor,
    (socketUrl, protocols) => {
      const metadata = getSafeWsConnectionMetadata(socketUrl);
      options.lifecycle?.onAttempt?.(metadata);
      const socket = new webSocketConstructor(socketUrl, protocols);

      socket.addEventListener(
        "open",
        () => {
          options.lifecycle?.onOpen?.(metadata);
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          options.lifecycle?.onError?.("Unable to connect to the T3 server WebSocket.", metadata);
        },
        { once: true },
      );
      socket.addEventListener(
        "close",
        (event) => {
          options.lifecycle?.onClose?.(
            {
              code: event.code,
              reason: redactRuntimeSecretText(event.reason),
            },
            metadata,
          );
        },
        { once: true },
      );

      return socket;
    },
  );
  const socketLayer = Socket.layerWebSocket(resolvedUrlEffect).pipe(
    Layer.provide(trackingWebSocketConstructorLayer),
  );
  const retryPolicy = Schedule.addDelay(
    Schedule.recurs(options.reconnect?.maxRetries ?? DEFAULT_RECONNECT_MAX_RETRIES),
    (retryCount) =>
      Effect.succeed(Duration.fromInputUnsafe(options.reconnect?.delayForRetry?.(retryCount) ?? 0)),
  );
  const protocolLayer = Layer.effect(
    RpcClient.Protocol,
    Effect.map(
      RpcClient.makeProtocolSocket({
        retryPolicy,
        retryTransientErrors: true,
      }),
      (protocol) => ({
        ...protocol,
        run: (clientId, writeResponse) =>
          protocol.run(clientId, (response) => {
            if (response._tag === "Chunk" || response._tag === "Exit") {
              options.requestTracking?.onRequestAcknowledged?.({
                requestId: response.requestId,
              });
            } else if (response._tag === "ClientProtocolError" || response._tag === "Defect") {
              options.requestTracking?.onProtocolReset?.();
            }
            return writeResponse(response);
          }),
        send: (clientId, request, transferables) => {
          if (request._tag === "Request") {
            options.requestTracking?.onRequestSent?.({
              requestId: request.id,
              tag: request.tag,
            });
          }
          return protocol.send(clientId, request, transferables);
        },
      }),
    ),
  );

  return protocolLayer.pipe(Layer.provide(Layer.mergeAll(socketLayer, RpcSerialization.layerJson)));
}
