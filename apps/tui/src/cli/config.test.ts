import { describe, expect, it } from "vitest";
import { resolveCliConfig } from "./config.js";

describe("CLI attach config", () => {
  it("parses attach URL and stdin credential channels", () => {
    const config = resolveCliConfig([
      "--attach",
      "https://remote.example.com/base",
      "--attach-bearer-stdin",
      "--base-dir",
      "/tmp/t3",
      "--dev-url",
      "http://localhost:5173",
    ]);

    expect(config.attach).toMatchObject({
      mode: "remote",
      url: "https://remote.example.com/base",
      bearerStdin: true,
      credentialStdin: false,
      baseDir: "/tmp/t3",
      devUrl: "http://localhost:5173",
    });
  });

  it("accepts an explicit local auth server entry without using positional args", () => {
    const config = resolveCliConfig([
      "--server-entry",
      "/repo/apps/server/dist/bin.mjs",
      "--base-dir",
      "/tmp/t3",
    ]);

    expect(config.attach).toMatchObject({
      mode: "local",
      serverEntry: "/repo/apps/server/dist/bin.mjs",
      baseDir: "/tmp/t3",
    });
  });

  it("rejects positional credentials", () => {
    expect(() => resolveCliConfig(["https://remote.example.com", "secret"])).toThrow(
      /positional credentials/,
    );
  });

  it("rejects attach URLs containing wsToken", () => {
    expect(() => resolveCliConfig(["--attach", "ws://localhost:3773/ws?wsToken=secret"])).toThrow(
      /credential parameter 'wsToken'/,
    );
  });

  it("rejects credential-bearing attach URLs", () => {
    expect(() => resolveCliConfig(["--attach", "https://user:secret@example.com"])).toThrow(
      /embedded credentials/,
    );
    expect(() => resolveCliConfig(["--attach", "https://example.com?credential=secret"])).toThrow(
      /credential parameter/,
    );
    expect(() => resolveCliConfig(["--attach", "https://example.com/#token=secret"])).toThrow(
      /credential fragment/,
    );
  });

  it("requires explicit local auth server entries to be absolute paths", () => {
    expect(() => resolveCliConfig(["--server-entry", "t3"])).toThrow(/absolute path/);
    expect(() =>
      resolveCliConfig([], {
        ...process.env,
        X1SHELL_SERVER_ENTRY: "t3",
      }),
    ).toThrow(/absolute path/);
  });

  it("rejects ambiguous stdin credential channels", () => {
    expect(() =>
      resolveCliConfig([
        "--attach",
        "http://localhost:3773",
        "--attach-bearer-stdin",
        "--attach-credential-stdin",
      ]),
    ).toThrow(/only one/);
  });
});
