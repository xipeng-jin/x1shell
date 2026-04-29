import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  type ProjectId,
  type UploadChatAttachment,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import {
  canAppendComposerAttachment,
  canHandlePrintableShortcut,
  composerAttachmentLimitMessage,
  isPlainTextSequence,
  parseComposerAttachmentInput,
} from "./input.js";

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
        cwd: process.cwd(),
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
    expect(frame).toContain("110x24");
    expect(frame).toContain("Waiting for shell snapshot.");
    expect(frame).not.toContain("secret");
    expect(frame).toContain("X1SHELL_TOKEN=[");
    expect(frame).toContain("REDACTED]/config");
  });

  it("renders shell projects, threads, detail, composer, and sanitized text", () => {
    const dir = createTempDir("x1shell-tui-phase6-");
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
        cwd: process.cwd(),
        env: {
          ...process.env,
          X1SHELL_HEADLESS_PHASE6_FIXTURE: "1",
          X1SHELL_CONFIG_HOME: join(dir, "config"),
          X1SHELL_DATA_HOME: join(dir, "data"),
          X1SHELL_CACHE_HOME: join(dir, "cache"),
          X1SHELL_STATE_HOME: join(dir, "state"),
        },
        stdio: "pipe",
      },
    );

    const frame = readFileSync(framePath, "utf8");
    expect(frame).toContain("Project");
    expect(frame).toContain("Thread Shell Fresh");
    expect(frame).not.toContain("Thread Detail Stale");
    expect(frame).toContain("assistant");
    expect(frame).toContain("hello link");
    expect(frame).toContain("Plan with");
    expect(frame).toContain("draft");
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
});

function createTempDir(prefix: string): string {
  const parent = process.env.TMPDIR ?? resolve(process.cwd(), "../../.tmp/tui-tests");
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(join(parent, prefix));
}
