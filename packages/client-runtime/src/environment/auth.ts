import type {
  AuthBearerBootstrapResult,
  AuthSessionState,
  AuthWebSocketTokenResult,
  ExecutionEnvironmentDescriptor,
} from "@t3tools/contracts";

import { redactRuntimeSecretText } from "../redaction.ts";

export class EnvironmentAuthHttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "EnvironmentAuthHttpError";
    this.status = status;
  }
}

export interface SafeHttpEndpointMetadata {
  readonly origin: string;
  readonly pathname: string;
  readonly method: "GET" | "POST";
}

export interface EnvironmentAuthCallbacks {
  readonly onRequest?: (metadata: SafeHttpEndpointMetadata) => void;
  readonly onError?: (metadata: SafeHttpEndpointMetadata, message: string) => void;
}

export interface EnvironmentFetchOptions {
  readonly fetch?: typeof fetch;
  readonly callbacks?: EnvironmentAuthCallbacks;
}

function endpointUrl(httpBaseUrl: string | URL, pathname: string): URL {
  const url = new URL(httpBaseUrl);
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url;
}

function metadataFor(url: URL, method: "GET" | "POST"): SafeHttpEndpointMetadata {
  return {
    origin: url.origin,
    pathname: url.pathname,
    method,
  };
}

async function readAuthErrorMessage(response: Response, fallbackMessage: string): Promise<string> {
  const text = await response.text();
  if (!text) {
    return fallbackMessage;
  }

  try {
    const parsed = JSON.parse(text) as { readonly error?: string };
    if (typeof parsed.error === "string" && parsed.error.length > 0) {
      return redactRuntimeSecretText(parsed.error);
    }
  } catch {
    // Fall back to raw text below.
  }

  return redactRuntimeSecretText(text);
}

async function fetchJson<T>(input: {
  readonly httpBaseUrl: string | URL;
  readonly pathname: string;
  readonly method?: "GET" | "POST";
  readonly bearerToken?: string;
  readonly body?: unknown;
  readonly options?: EnvironmentFetchOptions;
}): Promise<T> {
  const requestUrl = endpointUrl(input.httpBaseUrl, input.pathname);
  const method = input.method ?? "GET";
  const metadata = metadataFor(requestUrl, method);
  const fetchImpl = input.options?.fetch ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error("No fetch implementation is available. Pass fetch explicitly.");
  }

  input.options?.callbacks?.onRequest?.(metadata);

  let response: Response;
  try {
    response = await fetchImpl(requestUrl.toString(), {
      method,
      headers: {
        ...(input.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(input.bearerToken ? { authorization: `Bearer ${input.bearerToken}` } : {}),
      },
      ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
    });
  } catch (error) {
    const safeCause = new Error(redactRuntimeSecretText(error));
    const message = redactRuntimeSecretText(
      `Failed to fetch auth endpoint ${metadata.origin}${metadata.pathname} (${(error as Error).message}).`,
    );
    input.options?.callbacks?.onError?.(metadata, message);
    // eslint-disable-next-line preserve-caught-error -- Raw fetch errors can contain bearer tokens; keep only a sanitized cause.
    throw new Error(message, { cause: safeCause });
  }

  if (!response.ok) {
    const message = await readAuthErrorMessage(
      response,
      `Auth request failed (${response.status}).`,
    );
    input.options?.callbacks?.onError?.(metadata, message);
    throw new EnvironmentAuthHttpError(message, response.status);
  }

  return (await response.json()) as T;
}

export async function bootstrapBearerSession(input: {
  readonly httpBaseUrl: string | URL;
  readonly credential: string;
  readonly options?: EnvironmentFetchOptions;
}): Promise<AuthBearerBootstrapResult> {
  return fetchJson<AuthBearerBootstrapResult>({
    httpBaseUrl: input.httpBaseUrl,
    pathname: "/api/auth/bootstrap/bearer",
    method: "POST",
    body: {
      credential: input.credential,
    },
    ...(input.options ? { options: input.options } : {}),
  });
}

export async function fetchSessionState(input: {
  readonly httpBaseUrl: string | URL;
  readonly bearerToken: string;
  readonly options?: EnvironmentFetchOptions;
}): Promise<AuthSessionState> {
  return fetchJson<AuthSessionState>({
    httpBaseUrl: input.httpBaseUrl,
    pathname: "/api/auth/session",
    bearerToken: input.bearerToken,
    ...(input.options ? { options: input.options } : {}),
  });
}

export async function fetchEnvironmentDescriptor(input: {
  readonly httpBaseUrl: string | URL;
  readonly options?: EnvironmentFetchOptions;
}): Promise<ExecutionEnvironmentDescriptor> {
  return fetchJson<ExecutionEnvironmentDescriptor>({
    httpBaseUrl: input.httpBaseUrl,
    pathname: "/.well-known/t3/environment",
    ...(input.options ? { options: input.options } : {}),
  });
}

export async function issueWebSocketToken(input: {
  readonly httpBaseUrl: string | URL;
  readonly bearerToken: string;
  readonly options?: EnvironmentFetchOptions;
}): Promise<AuthWebSocketTokenResult> {
  return fetchJson<AuthWebSocketTokenResult>({
    httpBaseUrl: input.httpBaseUrl,
    pathname: "/api/auth/ws-token",
    method: "POST",
    bearerToken: input.bearerToken,
    ...(input.options ? { options: input.options } : {}),
  });
}

export async function resolveAuthenticatedWebSocketUrl(input: {
  readonly wsBaseUrl: string | URL;
  readonly httpBaseUrl: string | URL;
  readonly bearerToken: string;
  readonly options?: EnvironmentFetchOptions;
}): Promise<string> {
  const issued = await issueWebSocketToken({
    httpBaseUrl: input.httpBaseUrl,
    bearerToken: input.bearerToken,
    ...(input.options ? { options: input.options } : {}),
  });
  const url = new URL(input.wsBaseUrl);
  url.pathname = "/ws";
  url.searchParams.set("wsToken", issued.token);
  url.hash = "";
  return url.toString();
}
