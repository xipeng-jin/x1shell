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

export interface TuiWsConnectionOptions {
  readonly lifecycle?: WsProtocolLifecycleHandlers;
  readonly requestTracking?: WsProtocolRequestTrackingHandlers;
  readonly webSocketConstructor?: WebSocketConstructorLike;
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
