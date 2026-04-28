import { describe, expect, it } from "vitest";
import { resolveCliConfig } from "./config.js";

describe("CLI attach config", () => {
  const testEnv = {
    HOME: "/home/test",
    PWD: "/work/repo",
    XDG_DATA_HOME: "/tmp/x1-data",
  };
  it("parses attach URL and stdin credential channels", () => {
    const config = resolveCliConfig(
      [
        "--attach",
        "https://remote.example.com/base",
        "--attach-bearer-stdin",
        "--base-dir",
        "/tmp/t3",
        "--dev-url",
        "http://localhost:5173",
      ],
      testEnv,
    );

    expect(config.attach).toMatchObject({
      mode: "remote",
      url: "https://remote.example.com/base",
      bearerStdin: true,
      credentialStdin: false,
      baseDir: "/tmp/t3",
      explicitBaseDir: true,
      devUrl: "http://localhost:5173",
      newServer: false,
    });
  });

  it("accepts an explicit local-managed server entry without using positional args", () => {
    const config = resolveCliConfig(
      ["--server-entry", "/repo/apps/server/dist/bin.mjs", "--base-dir", "/tmp/t3"],
      testEnv,
    );

    expect(config.attach).toMatchObject({
      mode: "local-managed",
      serverEntry: "/repo/apps/server/dist/bin.mjs",
      baseDir: "/tmp/t3",
      explicitBaseDir: true,
    });
  });

  it("derives an isolated base dir for explicit --new-server unless base dir is explicit", () => {
    const isolated = resolveCliConfig(["--new-server"], testEnv);
    expect(isolated.attach).toMatchObject({
      mode: "local-managed",
      newServer: true,
      explicitBaseDir: false,
    });
    expect(isolated.attach.baseDir).toMatch(/^\/tmp\/x1-data\/x1shell\/servers\/repo-/);

    const explicit = resolveCliConfig(["--new-server", "--base-dir", "/tmp/isolated"], testEnv);
    expect(explicit.attach.baseDir).toBe("/tmp/isolated");
    expect(explicit.attach.explicitBaseDir).toBe(true);
  });

  it("does not treat T3CODE_HOME as an isolated --new-server base dir", () => {
    const config = resolveCliConfig(["--new-server"], {
      ...testEnv,
      T3CODE_HOME: "/home/test/.t3",
    });

    expect(config.attach.baseDir).toMatch(/^\/tmp\/x1-data\/x1shell\/servers\/repo-/);
    expect(config.attach.baseDir).not.toBe("/home/test/.t3");
    expect(config.attach.explicitBaseDir).toBe(true);
  });

  it("rejects --new-server when an explicit base dir reuses the default state root", () => {
    expect(() =>
      resolveCliConfig(["--new-server", "--base-dir", "/home/test/.t3"], testEnv),
    ).toThrow(/requires an isolated --base-dir/);
    expect(() => resolveCliConfig(["--new-server", "--base-dir", "~/.t3"], testEnv)).toThrow(
      /requires an isolated --base-dir/,
    );
    expect(() =>
      resolveCliConfig(["--new-server", "--base-dir", "/custom/t3"], {
        ...testEnv,
        T3CODE_HOME: "/custom/t3",
      }),
    ).toThrow(/requires an isolated --base-dir/);
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
