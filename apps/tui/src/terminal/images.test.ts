import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseImageAttachmentText } from "./images.js";

describe("TUI terminal image attachment parsing", () => {
  it("accepts pasted image data URLs", () => {
    expect(parseImageAttachmentText("data:image/png;base64,QUJD")?.attachment).toMatchObject({
      type: "image",
      mimeType: "image/png",
      sizeBytes: 3,
    });
  });

  it("converts explicit local image paths to bounded data URL attachments", () => {
    const dir = mkdtempSync(join(tmpdir(), "x1shell-tui-image-"));
    const path = join(dir, "screenshot.png");
    writeFileSync(path, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    expect(parseImageAttachmentText(`file://${path}`)?.attachment).toMatchObject({
      type: "image",
      name: "screenshot.png",
      sizeBytes: 4,
      dataUrl: "data:image/png;base64,iVBORw==",
    });
  });

  it("rejects non-images and oversized data URLs", () => {
    expect(parseImageAttachmentText("https://example.com/a.png")).toBeNull();
    expect(parseImageAttachmentText("data:text/plain;base64,QUJD")).toBeNull();
  });
});
