const SECRET_FIELD_NAMES =
  "(?:authorization|bearer|wsToken|token|credential|bootstrap|cookie|password|secret)";

const URL_WITH_AUTH_OR_QUERY_OR_FRAGMENT = /\b(?:https?|wss?):\/\/[^\s"'<>`]+/giu;
const AUTHORIZATION_HEADER = /\b(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;}\]\n\r]+/giu;
const BEARER_VALUE = /\b(bearer\s+)[^\s,;}\]\n\r]+/giu;
const SECRET_KEY_VALUE = new RegExp(
  `\\b(${SECRET_FIELD_NAMES}\\s*[:=]\\s*)(["'])?[^"',;}&\\]\\s]+\\2?`,
  "giu",
);
const SECRET_JSON_VALUE = new RegExp(
  `(["']${SECRET_FIELD_NAMES}["']\\s*:\\s*)(["'])[^"']+\\2`,
  "giu",
);
const SECRET_QUERY_VALUE = new RegExp(`([?&]${SECRET_FIELD_NAMES}=)[^&#\\s]+`, "giu");

function redactUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.username) url.username = "[REDACTED]";
    if (url.password) url.password = "[REDACTED]";
    for (const name of new Set(url.searchParams.keys())) {
      url.searchParams.set(name, "[REDACTED]");
    }
    url.hash = url.hash ? "#[REDACTED]" : "";
    return url.toString();
  } catch {
    return rawUrl;
  }
}

export function redactRuntimeSecretText(value: unknown): string {
  return String(value)
    .replace(URL_WITH_AUTH_OR_QUERY_OR_FRAGMENT, (match) => redactUrl(match))
    .replace(AUTHORIZATION_HEADER, "$1[REDACTED]")
    .replace(BEARER_VALUE, "$1[REDACTED]")
    .replace(SECRET_JSON_VALUE, "$1$2[REDACTED]$2")
    .replace(SECRET_KEY_VALUE, "$1[REDACTED]")
    .replace(SECRET_QUERY_VALUE, "$1[REDACTED]");
}
