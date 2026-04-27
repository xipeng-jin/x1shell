const REDACTED = "[REDACTED]";
const SENSITIVE_KEY_PATTERN =
  /authorization|cookie|pairing|wstoken|auth[-_]?token|token|credential|bootstrap|secret|password|api[-_]?key/i;
const SENSITIVE_KEY_FRAGMENT =
  "(?:cookie|pairing|wstoken|ws[-_]?token|auth[-_]?token|token|credential|bootstrap|secret|password|api[-_]?key)";
const QUOTED_AUTHORIZATION_PATTERN =
  /(["'])Authorization\1(\s*[:=]\s*)("[^"]*"|'[^']*'|[^,;&}\n\r]+)/gi;
const AUTHORIZATION_PATTERN =
  /\bAuthorization\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|(?:Bearer|Basic|Digest|Token)\s+[^\s,;}]+|[^\s,;}]+)/gi;
const COOKIE_PATTERN = /\bCookie\s*[:=]\s*[^;\n\r]+(?:;[^;\n\r]+)*/gi;
const KEY_VALUE_PATTERN = new RegExp(
  `(^|[\\s,{/\\\\])(["']?)([A-Za-z0-9_-]*${SENSITIVE_KEY_FRAGMENT}[A-Za-z0-9_-]*)\\2(\\s*[:=]\\s*)("[^"]*"|'[^']*'|[^\\s,;&}\\n\\r/\\\\]+)`,
  "gi",
);
const SPACED_COLON_KEY_VALUE_PATTERN = new RegExp(
  `(^|[\\s,{/\\\\])(["']?)([A-Za-z0-9_-]*${SENSITIVE_KEY_FRAGMENT}[A-Za-z0-9_-]*)\\2(\\s*:\\s*)([^,;&}\\n\\r/\\\\]+)`,
  "gi",
);
const CLI_KEY_VALUE_PATTERN = new RegExp(
  `(--[A-Za-z0-9-]*${SENSITIVE_KEY_FRAGMENT}[A-Za-z0-9-]*)(=|\\s+)("[^"]*"|'[^']*'|[^\\s,;&}\\n\\r]+)`,
  "gi",
);

export function redactText(value: string): string {
  return value
    .replace(/(?:https?|wss?):\/\/[^\s"'<>]+/gi, (match) => redactUrl(match))
    .replace(
      QUOTED_AUTHORIZATION_PATTERN,
      (_match, quote: string, separator: string) =>
        `${quote}Authorization${quote}${separator}${REDACTED}`,
    )
    .replace(AUTHORIZATION_PATTERN, `Authorization: ${REDACTED}`)
    .replace(COOKIE_PATTERN, `Cookie: ${REDACTED}`)
    .replace(
      KEY_VALUE_PATTERN,
      (_match, prefix: string, quote: string, key: string, separator: string) =>
        `${prefix}${quote}${key}${quote}${separator}${REDACTED}`,
    )
    .replace(
      SPACED_COLON_KEY_VALUE_PATTERN,
      (_match, prefix: string, quote: string, key: string, separator: string) =>
        `${prefix}${quote}${key}${quote}${separator}${REDACTED}`,
    )
    .replace(
      CLI_KEY_VALUE_PATTERN,
      (_match, key: string, separator: string) => `${key}${separator}${REDACTED}`,
    );
}

export function redactUnknown(value: unknown): string {
  if (value instanceof Error) {
    return redactText(value.stack ?? value.message);
  }
  if (typeof value === "string") return redactText(value);
  return redactText(
    JSON.stringify(redactValue(value), stringifyUnknownReplacer, 2) ?? String(value),
  );
}

export function redactValue<T>(value: T): T {
  return redactStructured(value, new WeakSet()) as T;
}

function redactStructured(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return redactText(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactStructured(item, seen));
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = isSensitiveKey(key) ? REDACTED : redactStructured(entry, seen);
  }
  return output;
}

function stringifyUnknownReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  return value;
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    let changed = false;
    if (url.username || url.password) {
      url.username = REDACTED;
      url.password = REDACTED;
      changed = true;
    }
    for (const key of Array.from(url.searchParams.keys())) {
      url.searchParams.set(key, REDACTED);
      changed = true;
    }
    if (url.hash) {
      const hash = url.hash.slice(1);
      if (hash.includes("=")) {
        const params = new URLSearchParams(hash);
        for (const key of Array.from(params.keys())) {
          params.set(key, REDACTED);
        }
        url.hash = params.toString();
        changed = true;
      } else if (shouldRedactOpaqueHash(url, hash)) {
        url.hash = REDACTED;
        changed = true;
      }
    }
    return changed ? url.toString() : value;
  } catch {
    return value;
  }
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key.replaceAll("_", "").replaceAll("-", ""));
}

function shouldRedactOpaqueHash(url: URL, hash: string): boolean {
  if (isSensitiveKey(hash)) return true;
  const path = url.pathname.toLowerCase();
  return /(?:auth|pair|login|callback|bootstrap|credential|token|session)/.test(path);
}
