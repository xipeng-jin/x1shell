import { describe, expect, it } from "vitest";
import { redactText, redactUnknown, redactValue } from "./redaction.js";

describe("redaction", () => {
  it("redacts sensitive headers and key-value tokens", () => {
    const input =
      "Authorization: Bearer abc wsToken=def token: ghi credential='jkl' bootstrap=\"mno\" Cookie: sid=secret";

    const redacted = redactText(input);

    expect(redacted).not.toContain("abc");
    expect(redacted).not.toContain("def");
    expect(redacted).not.toContain("ghi");
    expect(redacted).not.toContain("jkl");
    expect(redacted).not.toContain("mno");
    expect(redacted).not.toContain("sid=secret");
    expect(redacted).toContain("[REDACTED]");
  });

  it("redacts common raw Authorization string formats", () => {
    const redacted = redactText(
      'Authorization: Basic dXNlcjpwYXNz {"Authorization":"Bearer secret"} authorization="Token hidden"',
    );

    expect(redacted).not.toContain("dXNlcjpwYXNz");
    expect(redacted).not.toContain("secret");
    expect(redacted).not.toContain("hidden");
    expect(redacted).toContain("Authorization: [REDACTED]");
    expect(redacted).toContain('"Authorization":[REDACTED]');
    expect(redacted.match(/Authorization: \[REDACTED\]/g)).toHaveLength(2);
  });

  it("redacts pairing URL query strings and fragments", () => {
    const redacted = redactText(
      "open http://127.0.0.1:4090/pair?wsToken=abc&credential=def#bootstrap=ghi",
    );

    expect(redacted).not.toContain("abc");
    expect(redacted).not.toContain("def");
    expect(redacted).not.toContain("ghi");
    expect(redacted).toContain("wsToken=%5BREDACTED%5D");
    expect(redacted).toContain("credential=%5BREDACTED%5D");
    expect(redacted).toContain("bootstrap=%5BREDACTED%5D");
  });

  it("redacts WebSocket URLs with sensitive query values", () => {
    const redacted = redactText(
      "connect ws://127.0.0.1/ws?wsToken=secret and wss://example.test/ws?token=secret2",
    );

    expect(redacted).not.toContain("secret");
    expect(redacted).not.toContain("secret2");
    expect(redacted).toContain("wsToken=%5BREDACTED%5D");
    expect(redacted).toContain("token=%5BREDACTED%5D");
  });

  it("redacts token-like URL parameter names", () => {
    const redacted = redactText(
      "open https://example.test/callback?access_token=one&authToken=two&desktopBootstrapToken=three",
    );

    expect(redacted).not.toContain("one");
    expect(redacted).not.toContain("two");
    expect(redacted).not.toContain("three");
    expect(redacted).toContain("access_token=%5BREDACTED%5D");
    expect(redacted).toContain("authToken=%5BREDACTED%5D");
    expect(redacted).toContain("desktopBootstrapToken=%5BREDACTED%5D");
  });

  it("redacts all URL query values and parameterized hash values", () => {
    const redacted = redactText(
      "open https://example.test/callback?code=one&state=two#session=three&next=four",
    );

    expect(redacted).not.toContain("one");
    expect(redacted).not.toContain("two");
    expect(redacted).not.toContain("three");
    expect(redacted).not.toContain("four");
    expect(redacted).toContain("code=%5BREDACTED%5D");
    expect(redacted).toContain("state=%5BREDACTED%5D");
    expect(redacted).toContain("session=%5BREDACTED%5D");
    expect(redacted).toContain("next=%5BREDACTED%5D");
  });

  it("redacts URL username and password userinfo", () => {
    const redacted = redactText("open https://user-secret:password-secret@example.test/path");

    expect(redacted).not.toContain("user-secret");
    expect(redacted).not.toContain("password-secret");
    expect(redacted).toContain("%5BREDACTED%5D:%5BREDACTED%5D@example.test");
  });

  it("keeps non-parameter URL fragments unless the fragment name is sensitive", () => {
    expect(redactText("open https://example.test/docs#install")).toContain("#install");
    expect(redactText("open https://example.test/docs#token")).not.toContain("#token");
  });

  it("redacts opaque pairing and auth URL fragments", () => {
    const redacted = redactText(
      "open https://example.test/pair#opaque-secret and https://example.test/callback#session-token",
    );

    expect(redacted).not.toContain("opaque-secret");
    expect(redacted).not.toContain("session-token");
    expect(redacted.match(/#\[REDACTED\]/g)).toHaveLength(2);
  });

  it("redacts JSON-like raw string credentials", () => {
    const redacted = redactText('payload {"token":"secret","cookie":"sid=secret"}');

    expect(redacted).not.toContain("secret");
    expect(redacted).not.toContain("sid=secret");
    expect(redacted).toContain('"token":[REDACTED]');
    expect(redacted).toContain('"cookie":[REDACTED]');
  });

  it("redacts token-like raw key names", () => {
    const redacted = redactText(
      "access_token=one authToken=two desktopBootstrapToken=three X1SHELL_TOKEN=four --bootstrap-token five api_key=six password=seven secret=eight",
    );

    expect(redacted).not.toContain("one");
    expect(redacted).not.toContain("two");
    expect(redacted).not.toContain("three");
    expect(redacted).not.toContain("four");
    expect(redacted).not.toContain("five");
    expect(redacted).not.toContain("six");
    expect(redacted).not.toContain("seven");
    expect(redacted).not.toContain("eight");
    expect(redacted).toContain("access_token=[REDACTED]");
    expect(redacted).toContain("authToken=[REDACTED]");
    expect(redacted).toContain("desktopBootstrapToken=[REDACTED]");
    expect(redacted).toContain("X1SHELL_TOKEN=[REDACTED]");
    expect(redacted).toContain("--bootstrap-token [REDACTED]");
    expect(redacted).toContain("api_key=[REDACTED]");
    expect(redacted).toContain("password=[REDACTED]");
    expect(redacted).toContain("secret=[REDACTED]");
  });

  it("redacts token-like path segments", () => {
    const redacted = redactText("/tmp/X1SHELL_TOKEN=secret/config");

    expect(redacted).not.toContain("secret");
    expect(redacted).toContain("/X1SHELL_TOKEN=[REDACTED]/config");
  });

  it("redacts unquoted sensitive values that contain spaces", () => {
    const redacted = redactText("failed token: secret value\nnext line");

    expect(redacted).not.toContain("secret value");
    expect(redacted).toContain("token: [REDACTED]");
    expect(redacted).toContain("next line");
  });

  it("redacts full bootstrap envelopes and nested structured values", () => {
    const redacted = redactValue({
      type: "bootstrap",
      bootstrap: {
        token: "secret-token",
        credential: "secret-credential",
        access_token: "secret-access",
        desktopBootstrapToken: "secret-desktop",
        apiKey: "secret-api-key",
        password: "secret-password",
      },
      pairing: "secret-pairing",
      nested: {
        Authorization: "Bearer secret-auth",
        cookie: "secret-cookie",
      },
    });

    expect(JSON.stringify(redacted)).not.toContain("secret");
    expect(redacted).toMatchObject({
      bootstrap: "[REDACTED]",
      pairing: "[REDACTED]",
      nested: {
        Authorization: "[REDACTED]",
        cookie: "[REDACTED]",
      },
    });
  });

  it("redacts errors before string output", () => {
    const error = new Error("failed with token=secret");

    expect(redactUnknown(error)).not.toContain("secret");
  });

  it("stringifies BigInt unknown values without throwing", () => {
    expect(() => redactUnknown(42n)).not.toThrow();
    expect(redactUnknown({ count: 42n })).toContain('"count": "42"');
  });
});
