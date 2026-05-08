import React from "react";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot } from "@opentui/react";
import { TuiRuntimeApp } from "../app/TuiRuntimeApp.js";
import { createDebugBuffer } from "../domain/debug.js";
import { createOrchestrationStore } from "../state/orchestrationStore.js";
import { createServerConfigStore } from "../state/serverConfigStore.js";
import { createThreadDetailStore } from "../state/threadDetailStore.js";
import { resolveTheme } from "../terminal/theme.js";

const setup = await createTestRenderer({
  width: 100,
  height: 30,
  screenMode: "main-screen",
  consoleMode: "disabled",
  externalOutputMode: "passthrough",
});
const root = createRoot(setup.renderer);

try {
  const serverStore = createServerConfigStore();
  const orchestrationStore = createOrchestrationStore();
  const threadDetailStore = createThreadDetailStore();
  const debugBuffer = createDebugBuffer();

  root.render(
    React.createElement(TuiRuntimeApp, {
      interruptRequestToken: 0,
      paths: {
        configDir: "/tmp/x1shell/config",
        dataDir: "/tmp/x1shell/data",
        cacheDir: "/tmp/x1shell/cache",
        logDir: "/tmp/x1shell/logs",
        imageCacheDir: "/tmp/x1shell/cache/images",
        prefsFile: "/tmp/x1shell/config/preferences.json",
        logFile: "/tmp/x1shell/tui.log",
        headlessFrameFile: "/tmp/x1shell/frame.txt",
      },
      launchCwd: "/tmp/x1shell",
      theme: resolveTheme(undefined),
      serverStore,
      orchestrationStore,
      threadDetailStore,
      debugBuffer,
      onRequestExit: () => {},
    }),
  );
  await settleEffects();
  serverStore.setConnection("connecting");
  await settleEffects();

  const baseline = listenerCounts(setup.renderer);
  for (let index = 0; index < 16; index += 1) {
    serverStore.setConnection(index % 2 === 0 ? "connecting" : "connected");
    debugBuffer.push("info", `tick ${index}`);
    await settleEffects();
  }

  console.log(JSON.stringify({ baseline, after: listenerCounts(setup.renderer) }));
} finally {
  root.unmount();
  setup.renderer.destroy();
}

function listenerCounts(renderer: Awaited<ReturnType<typeof createTestRenderer>>["renderer"]) {
  return {
    keypress: renderer.keyInput.listenerCount("keypress"),
    resize: renderer.listenerCount("resize"),
    selection: renderer.listenerCount("selection"),
  };
}

function settleEffects(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}
