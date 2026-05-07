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
import {
  canAppendComposerAttachment,
  canHandlePrintableShortcut,
  composerAttachmentLimitMessage,
  appendPaletteQuery,
  isPlainTextSequence,
  parseComposerAttachmentInput,
} from "./input.js";

const TUI_PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("App headless smoke", () => {
  it("captures a static boot frame", () => {
    const dir = createTempDir("x1shell-tui-headless-");
    const framePath = join(dir, "frame.txt");

    execFileSync(
      "bun",
      [
        "run",
        "src/index.tsx",
        "--headless",
        "--headless-width=110",
        "--headless-height=24",
        `--headless-frame=${framePath}`,
      ],
      {
        cwd: TUI_PACKAGE_DIR,
        env: {
          ...process.env,
          X1SHELL_CONFIG_HOME: join(dir, "X1SHELL_TOKEN=secret", "config"),
          X1SHELL_DATA_HOME: join(dir, "data"),
          X1SHELL_CACHE_HOME: join(dir, "cache"),
          X1SHELL_STATE_HOME: join(dir, "state"),
        },
        stdio: "pipe",
      },
    );

    const frame = readFileSync(framePath, "utf8");

    expect(frame).toContain("X1Shell");
    expect(frame).toContain("ALPHA");
    expect(frame).toContain("PROJECTS");
    expect(frame).toContain("Ask for follow-up changes or attach images");
    expect(frame).toContain("GPT-5");
    expect(frame).toContain("booting workspace");
    expect(frame).not.toContain("Attach auth required");
    expect(frame).not.toContain("No model");
    expect(frame).not.toContain("Local");
    expect(frame).not.toContain("secret");
    expect(frame).not.toContain("shell seq");
    expect(frame).not.toContain("X1SHELL_TOKEN");
    expect(frame).not.toContain("help/palette");
  });

  it("renders shell projects, threads, detail, composer, and sanitized text", () => {
    const dir = createTempDir("x1shell-tui-fixture-");
    const framePath = join(dir, "frame.txt");

    execFileSync(
      "bun",
      [
        "run",
        "src/index.tsx",
        "--headless",
        "--headless-width=120",
        "--headless-height=28",
        `--headless-frame=${framePath}`,
      ],
      {
        cwd: TUI_PACKAGE_DIR,
        env: {
          ...process.env,
          X1SHELL_HEADLESS_FIXTURE: "1",
          X1SHELL_CONFIG_HOME: join(dir, "config"),
          X1SHELL_DATA_HOME: join(dir, "data"),
          X1SHELL_CACHE_HOME: join(dir, "cache"),
          X1SHELL_STATE_HOME: join(dir, "state"),
        },
        stdio: "pipe",
      },
    );

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
  });

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
