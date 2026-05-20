import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  type ProjectId,
  type UploadChatAttachment,
} from "@t3tools/contracts";
import { displayText } from "../domain/display.js";
import { describe, expect, it } from "vitest";
import { transformSolidOpenTuiJsx } from "../../scripts/solid-rolldown-plugin.js";
import {
  canAppendComposerAttachment,
  canHandlePrintableShortcut,
  composerAttachmentLimitMessage,
  appendAddProjectBrowseQuery,
  appendPaletteQuery,
  MAX_ADD_PROJECT_BROWSE_QUERY_LENGTH,
  isPlainTextSequence,
  parseComposerAttachmentInput,
  applyAddProjectBrowseBackspace,
} from "./input.js";
import { resolveCommandPaletteFrame } from "./commandPaletteFrame.js";

const TUI_PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REPO_ROOT_DIR = resolve(TUI_PACKAGE_DIR, "../..");
const HEADLESS_SMOKE_TEST_TIMEOUT_MS = 15_000;
const HEADLESS_SMOKE_CHILD_TIMEOUT_MS = 12_000;
const DIST_SMOKE_TEST_TIMEOUT_MS = 30_000;
const DIST_SMOKE_CHILD_TIMEOUT_MS = 25_000;

describe("resolveCommandPaletteFrame", () => {
  it("centers the palette against the full viewport and places it at the web top offset", () => {
    expect(resolveCommandPaletteFrame({ viewportColumns: 120, viewportRows: 30 })).toEqual({
      left: 18,
      top: 3,
      width: 84,
      height: 18,
    });
  });

  it("does not reserve a sidebar gutter when centering the palette", () => {
    const frame = resolveCommandPaletteFrame({ viewportColumns: 120, viewportRows: 30 });

    expect(frame.left).toBe(18);
    expect(frame.left).not.toBe(36);
  });

  it("uses compact viewport bounds while preserving the web-relative top offset", () => {
    expect(resolveCommandPaletteFrame({ viewportColumns: 60, viewportRows: 20 })).toEqual({
      left: 4,
      top: 2,
      width: 52,
      height: 14,
    });
  });
});

describe("App headless smoke", () => {
  it("keeps the root start:tui script pointed at source mode", () => {
    const rootPackage = JSON.parse(readFileSync(join(REPO_ROOT_DIR, "package.json"), "utf8")) as {
      readonly scripts?: Record<string, string>;
    };
    const tuiPackage = JSON.parse(readFileSync(join(TUI_PACKAGE_DIR, "package.json"), "utf8")) as {
      readonly bin?: Record<string, string>;
      readonly scripts?: Record<string, string>;
    };
    const startTui = rootPackage.scripts?.["start:tui"] ?? "";

    expect(startTui).toContain("--preload @opentui/solid/preload");
    expect(startTui).toContain("src/index.tsx");
    expect(startTui).not.toContain("bin/x1shell.js");
    expect(tuiPackage.scripts?.start).toBe("bun --preload @opentui/solid/preload ./dist/index.mjs");
    expect(tuiPackage.bin?.x1shell).toBe("./bin/x1shell.js");
  });

  it("lowers OpenTUI Solid TSX through the build plugin", async () => {
    const transformed = await transformSolidOpenTuiJsx(
      'const label: string = "Hello"; export const view = <box><text>{label}</text></box>;',
      join(TUI_PACKAGE_DIR, "src", "__plugin-test.tsx"),
    );

    expect(transformed.code).not.toContain("<box");
    expect(transformed.code).not.toContain("<text");
    expect(transformed.code).toContain("@opentui/solid");
    expect(transformed.code).toContain("createElement");
  });

  it(
    "builds and launches the packaged dist entry with Solid JSX lowered",
    () => {
      const dir = createTempDir("x1shell-tui-dist-");
      const framePath = join(dir, "frame.txt");

      execFileSync("bun", ["run", "tsdown"], {
        cwd: TUI_PACKAGE_DIR,
        stdio: "pipe",
        timeout: DIST_SMOKE_CHILD_TIMEOUT_MS,
      });

      const dist = readFileSync(join(TUI_PACKAGE_DIR, "dist", "index.mjs"), "utf8");
      expect(dist).not.toMatch(/<box|<text|<span|<strong|<em/);

      execFileSync(
        "bun",
        [
          "--preload",
          "@opentui/solid/preload",
          "./dist/index.mjs",
          "--headless",
          "--headless-width=90",
          "--headless-height=24",
          `--headless-frame=${framePath}`,
        ],
        {
          cwd: TUI_PACKAGE_DIR,
          env: headlessSmokeEnv(dir, { X1SHELL_HEADLESS_FIXTURE: "1" }),
          stdio: "pipe",
          timeout: HEADLESS_SMOKE_CHILD_TIMEOUT_MS,
        },
      );

      const frame = readFileSync(framePath, "utf8");
      expect(frame).toContain("X1Shell");
      expect(frame).toContain("Thread Shell Fresh");
      expect(frame).toContain("draft");
      expect(frame).toContain("Full access");
    },
    DIST_SMOKE_TEST_TIMEOUT_MS,
  );

  it(
    "launches root start:tui from source even when ignored dist output exists",
    () => {
      const dir = createTempDir("x1shell-root-start-tui-");
      const framePath = join(dir, "frame.txt");

      execFileSync("bun", ["run", "tsdown"], {
        cwd: TUI_PACKAGE_DIR,
        stdio: "pipe",
        timeout: DIST_SMOKE_CHILD_TIMEOUT_MS,
      });
      const distEntryPath = join(TUI_PACKAGE_DIR, "dist", "index.mjs");
      const realDistEntry = readFileSync(distEntryPath, "utf8");

      try {
        writeFileSync(
          distEntryPath,
          `throw new Error("stale dist sentinel: root start:tui must not load dist");\n`,
          "utf8",
        );

        execFileSync(
          "bun",
          [
            "start:tui",
            "--",
            "--headless",
            "--headless-width=90",
            "--headless-height=24",
            `--headless-frame=${framePath}`,
          ],
          {
            cwd: REPO_ROOT_DIR,
            env: headlessSmokeEnv(dir, { X1SHELL_HEADLESS_FIXTURE: "1" }),
            stdio: "pipe",
            timeout: HEADLESS_SMOKE_CHILD_TIMEOUT_MS,
          },
        );
      } finally {
        writeFileSync(distEntryPath, realDistEntry, "utf8");
      }

      const frame = readFileSync(framePath, "utf8");
      expect(frame).toContain("X1Shell");
      expect(frame).toContain("Thread Shell Fresh");
      expect(frame).toContain("draft");
      expect(frame).toContain("Full access");
    },
    DIST_SMOKE_TEST_TIMEOUT_MS,
  );

  it(
    "captures a static boot frame",
    () => {
      const dir = createTempDir("x1shell-tui-headless-");
      const framePath = join(dir, "frame.txt");

      captureHeadlessFrame(framePath, {
        "--headless-width": "110",
        "--headless-height": "24",
        X1SHELL_CONFIG_HOME: join(dir, "X1SHELL_TOKEN=secret", "config"),
        X1SHELL_DATA_HOME: join(dir, "data"),
        X1SHELL_CACHE_HOME: join(dir, "cache"),
        X1SHELL_STATE_HOME: join(dir, "state"),
      });

      const frame = readFileSync(framePath, "utf8");

      expect(frame).toContain("X1Shell");
      expect(frame).toContain("ALPHA");
      expect(frame).toContain("PROJECTS");
      expect(frame).toContain("Connecting workspace");
      expect(frame).toContain("Opening the RPC session");
      expect(frame).toContain("and waiting for shell");
      expect(frame).toContain("state.");
      expect(frame).toContain("New thread [tui]");
      expect(frame).toContain("Ask anything or @tag files/folders");
      expect(frame).toContain("▄▄▄   ▄▄▄");
      expect(frame).toContain("GPT-5");
      expect(frame).not.toContain("booting workspace");
      expect(frame).not.toContain("Opening the RPC session...");
      expect(frame).not.toContain("Attach auth required");
      expect(frame).not.toContain("No model");
      expect(frame).not.toContain("Local");
      expect(frame).not.toContain("secret");
      expect(frame).not.toContain("shell seq");
      expect(frame).not.toContain("X1SHELL_TOKEN");
      expect(frame).not.toContain("help/palette");
    },
    HEADLESS_SMOKE_TEST_TIMEOUT_MS,
  );

  it(
    "opens Add Project from the sidebar plus and browses server filesystem entries",
    () => {
      const dir = createTempDir("x1shell-tui-add-project-smoke-");
      const framePath = join(dir, "frames.txt");
      execFileSync("bun", ["run", "src/test/openTuiAddProjectPaletteSmoke.tsx", framePath], {
        cwd: TUI_PACKAGE_DIR,
        stdio: "pipe",
        timeout: HEADLESS_SMOKE_CHILD_TIMEOUT_MS,
      });

      const frames = readFileSync(framePath, "utf8");
      expect(frames).toContain("Add project");
      expect(frames).toContain("Sources");
      expect(frames).toContain("Local folder");
      expect(frames).toContain("Add project / Local folder");
      expect(frames).toContain("~/");
      expect(frames).toContain("workspace");
      expect(frames).not.toContain("token=secret");
    },
    HEADLESS_SMOKE_TEST_TIMEOUT_MS,
  );

  it(
    "captures a compact logo boot frame on narrow terminals",
    () => {
      const dir = createTempDir("x1shell-tui-narrow-");
      const framePath = join(dir, "frame.txt");

      captureHeadlessFrame(framePath, {
        "--headless-width": "60",
        "--headless-height": "20",
        X1SHELL_CONFIG_HOME: join(dir, "config"),
        X1SHELL_DATA_HOME: join(dir, "data"),
        X1SHELL_CACHE_HOME: join(dir, "cache"),
        X1SHELL_STATE_HOME: join(dir, "state"),
      });

      const frame = readFileSync(framePath, "utf8");
      expect(frame).toContain("New thread [tui]");
      expect(frame).toContain("X1SHELL");
      expect(frame).not.toContain("▄▄▄   ▄▄▄");
      expect(frame).not.toContain("booting workspace");
    },
    HEADLESS_SMOKE_TEST_TIMEOUT_MS,
  );

  it(
    "renders shell projects, threads, detail, composer, and sanitized text",
    () => {
      const dir = createTempDir("x1shell-tui-fixture-");
      const framePath = join(dir, "frame.txt");

      captureHeadlessFrame(framePath, {
        "--headless-width": "120",
        "--headless-height": "28",
        X1SHELL_HEADLESS_FIXTURE: "1",
        X1SHELL_CONFIG_HOME: join(dir, "config"),
        X1SHELL_DATA_HOME: join(dir, "data"),
        X1SHELL_CACHE_HOME: join(dir, "cache"),
        X1SHELL_STATE_HOME: join(dir, "state"),
      });

      const frame = readFileSync(framePath, "utf8");
      expect(frame).toContain("X1Shell");
      expect(frame).toContain("ALPHA");
      expect(frame).toContain("PROJECTS");
      expect(frame).toContain("Thread Shell Fresh");
      expect(frame).not.toContain("Thread Detail Stale");
      expect(frame).toContain("hello link");
      expect(frame).toContain("Plan with");
      expect(frame).toContain("draft");
      expect(frame).toContain("Local");
      expect(frame).toContain("Full access");
      expect(frame).not.toContain("Threads");
      expect(frame).not.toContain("shell seq");
      expect(frame).not.toContain("Message agent");
      expect(frame).not.toContain("\u001b]8");
      expect(frame).not.toContain("evil.example");
      expect(frame).not.toContain("plan-secret");
    },
    HEADLESS_SMOKE_TEST_TIMEOUT_MS,
  );

  it("treats pending user-input shortcut letters as plain text", () => {
    for (const key of ["d", "p", "g", "m", "r", "i", "R", "?", ","]) {
      expect(isPlainTextSequence({ name: key, sequence: key })).toBe(true);
    }
  });

  it("only handles printable global shortcuts from an empty composer", () => {
    expect(canHandlePrintableShortcut({ composerText: "", visiblePanel: null, keyName: "?" })).toBe(
      true,
    );
    expect(
      canHandlePrintableShortcut({ composerText: "?", visiblePanel: null, keyName: "?" }),
    ).toBe(false);
    expect(
      canHandlePrintableShortcut({ composerText: "", visiblePanel: "diff", keyName: "t" }),
    ).toBe(true);
    expect(
      canHandlePrintableShortcut({ composerText: "draft", visiblePanel: "diff", keyName: "t" }),
    ).toBe(false);
  });

  it("routes pasted image attachments through the composer parser", () => {
    const projectId = "project-a" as ProjectId;
    const dataUrl = parseComposerAttachmentInput("data:image/png;base64,QUJD", projectId);
    expect(dataUrl?.attachment).toMatchObject({
      type: "image",
      mimeType: "image/png",
      sizeBytes: 3,
      dataUrl: "data:image/png;base64,QUJD",
    });

    const dir = createTempDir("x1shell-tui-composer-image-");
    const imagePath = join(dir, "paste.png");
    writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const localImage = parseComposerAttachmentInput(`file://${imagePath}`, projectId);
    expect(localImage?.attachment).toMatchObject({
      type: "image",
      name: "paste.png",
      mimeType: "image/png",
      sizeBytes: 4,
      dataUrl: "data:image/png;base64,iVBORw==",
    });
    expect(parseComposerAttachmentInput("data:image/png;base64,QUJD", null)).toBeNull();
  });

  it("sanitizes and bounds pasted command palette query text", () => {
    const query = appendPaletteQuery(
      "",
      `open\u001b]8;;https://evil.example\u0007link\u001b]8;;\u0007 token=palette-secret`,
    );

    expect(query).toContain("open");
    expect(query).toContain("link");
    expect(query).not.toContain("\u001b]8");
    expect(query).not.toContain("evil.example");
    expect(query).not.toContain("palette-secret");

    const hugeDataUrl = `data:image/png;base64,${"A".repeat(10_000)}`;
    expect(appendPaletteQuery("", hugeDataUrl)).toHaveLength(160);
  });

  it("keeps Add Project browse input raw except terminal-control stripping and path bounds", () => {
    const query = appendAddProjectBrowseQuery(
      "/repo/",
      "token=valid-path\u001b]8;;https://evil.example\u0007link\nnested\rchild",
    );

    expect(query).toBe("/repo/token=valid-pathlinknestedchild");
    expect(query).not.toContain("\u001b]8");
    expect(query).not.toContain("evil.example");
    expect(query).not.toContain("\n");
    expect(query).not.toContain("\r");
    expect(query).toContain("token=valid-path");

    expect(appendAddProjectBrowseQuery("", "a".repeat(10_000))).toHaveLength(
      MAX_ADD_PROJECT_BROWSE_QUERY_LENGTH,
    );
  });

  it("returns Add Project browse to sources when Backspace deletes the final character", () => {
    expect(applyAddProjectBrowseBackspace("~/")).toEqual({ kind: "browse", query: "~" });
    expect(applyAddProjectBrowseBackspace("a")).toEqual({ kind: "sources" });
    expect(applyAddProjectBrowseBackspace("")).toEqual({ kind: "sources" });
  });

  it("bounds composer image attachment count to the provider contract", () => {
    const attachment: UploadChatAttachment = {
      type: "image",
      name: "paste.png",
      mimeType: "image/png",
      sizeBytes: 3,
      dataUrl: "data:image/png;base64,QUJD",
    };

    expect(
      canAppendComposerAttachment(Array(PROVIDER_SEND_TURN_MAX_ATTACHMENTS - 1).fill(attachment)),
    ).toBe(true);
    expect(
      canAppendComposerAttachment(Array(PROVIDER_SEND_TURN_MAX_ATTACHMENTS).fill(attachment)),
    ).toBe(false);
    expect(composerAttachmentLimitMessage()).toContain(String(PROVIDER_SEND_TURN_MAX_ATTACHMENTS));
  });

  it("formats async action failures for submit error display without preserving controls", () => {
    const message = displayText(
      String(
        new Error("RpcClientDefect token=submit-secret \u001b]8;;https://evil.example\u0007link"),
      ),
    );

    expect(message).toContain("RpcClientDefect");
    expect(message).toContain("link");
    expect(message).not.toContain("\u001b]8");
    expect(message).not.toContain("evil.example");
    expect(message).not.toContain("submit-secret");
  });
});

function createTempDir(prefix: string): string {
  const parent = process.env.TMPDIR ?? resolve(process.cwd(), "../../.tmp/tui-tests");
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(join(parent, prefix));
}

function captureHeadlessFrame(
  framePath: string,
  options: {
    readonly "--headless-width": string;
    readonly "--headless-height": string;
    readonly X1SHELL_CONFIG_HOME: string;
    readonly X1SHELL_DATA_HOME: string;
    readonly X1SHELL_CACHE_HOME: string;
    readonly X1SHELL_STATE_HOME: string;
    readonly X1SHELL_HEADLESS_FIXTURE?: string;
  },
): void {
  execFileSync(
    "bun",
    [
      "run",
      "src/index.tsx",
      "--headless",
      `--headless-width=${options["--headless-width"]}`,
      `--headless-height=${options["--headless-height"]}`,
      `--headless-frame=${framePath}`,
    ],
    {
      cwd: TUI_PACKAGE_DIR,
      env: headlessSmokeEnv(dirname(framePath), options),
      stdio: "pipe",
      timeout: HEADLESS_SMOKE_CHILD_TIMEOUT_MS,
    },
  );
}

function headlessSmokeEnv(
  dir: string,
  options: {
    readonly X1SHELL_CONFIG_HOME?: string;
    readonly X1SHELL_DATA_HOME?: string;
    readonly X1SHELL_CACHE_HOME?: string;
    readonly X1SHELL_STATE_HOME?: string;
    readonly X1SHELL_HEADLESS_FIXTURE?: string;
  },
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    X1SHELL_HEADLESS_FIXTURE: options.X1SHELL_HEADLESS_FIXTURE ?? "0",
    X1SHELL_HEADLESS_SETTLE_MS: "25",
    X1SHELL_SERVER_ENTRY: "",
    X1SHELL_CONFIG_HOME: options.X1SHELL_CONFIG_HOME ?? join(dir, "config"),
    X1SHELL_DATA_HOME: options.X1SHELL_DATA_HOME ?? join(dir, "data"),
    X1SHELL_CACHE_HOME: options.X1SHELL_CACHE_HOME ?? join(dir, "cache"),
    X1SHELL_STATE_HOME: options.X1SHELL_STATE_HOME ?? join(dir, "state"),
  };
}
