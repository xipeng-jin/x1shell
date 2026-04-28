import { describe, expect, it } from "vitest";

import { redactRuntimeSecretText } from "./redaction.ts";

describe("runtime secret redaction", () => {
  it("redacts credential-like values from callback and error strings", () => {
    const redacted = redactRuntimeSecretText(
      [
        "Authorization: Bearer bearer-secret",
        "wsToken=socket-secret",
        "token=plain-token",
        "credential=pairing-token",
        "bootstrap=bootstrap-token",
        "cookie=session-cookie",
        "wss://user:pass@remote.example.com/base?debug=1&token=query-token#fragment",
      ].join(" "),
    );

    expect(redacted).toContain("[REDACTED]");
    expect(redacted).not.toContain("bearer-secret");
    expect(redacted).not.toContain("socket-secret");
    expect(redacted).not.toContain("plain-token");
    expect(redacted).not.toContain("pairing-token");
    expect(redacted).not.toContain("bootstrap-token");
    expect(redacted).not.toContain("session-cookie");
    expect(redacted).not.toContain("query-token");
    expect(redacted).not.toContain("#fragment");
  });
});
