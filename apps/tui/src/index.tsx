import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createCliRenderer } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot } from "@opentui/react";
import { App } from "./app/App.js";
import { resolveCliConfig } from "./cli/config.js";
import { readPreferences } from "./cli/preferences.js";
import {
  resolveBearerAttachTarget,
  resolveBootstrapAttachTarget,
  resolveLocalAttachTarget,
} from "./runtime/attach.js";
import { createTuiConnectionController } from "./runtime/connection.js";
import { createLogger, safeOutputUnknown } from "./runtime/log.js";
import {
  captureProcessListeners,
  removeAddedProcessListeners,
} from "./runtime/processListeners.js";
import { resolveKeyboardPolicy } from "./terminal/keyboard.js";
import { resolveTheme } from "./terminal/theme.js";
import { createServerConfigStore } from "./state/serverConfigStore.js";

type ProcessEventName =
  | "SIGINT"
  | "SIGTERM"
  | "SIGHUP"
  | "uncaughtException"
  | "unhandledRejection";

export async function main(): Promise<void> {
  const config = resolveCliConfig(process.argv.slice(2), process.env);
  const preferences = await readPreferences(config.paths);
  const logger = createLogger({ logFile: config.paths.logFile, verbose: config.verbose });

  try {
    if (config.headless.enabled) {
      await runHeadless(config, preferences, logger);
      await logger.close();
      return;
    }

    await runInteractive(config, preferences, logger);
  } catch (error) {
    logger.error("x1shell TUI startup failed", error);
    process.stderr.write(`${safeOutputUnknown(error)}\n`);
    await logger.close();
    process.exitCode = 1;
  }
}

async function runHeadless(
  config: ReturnType<typeof resolveCliConfig>,
  preferences: Awaited<ReturnType<typeof readPreferences>>,
  logger: ReturnType<typeof createLogger>,
): Promise<void> {
  const theme = resolveTheme(config.theme ?? preferences.theme);
  const serverStore = createServerConfigStore();
  const controller = await maybeCreateAttachController(config, serverStore);
  await controller?.connect().catch((error) => {
    serverStore.setConnection("error", safeOutputUnknown(error));
  });
  let setup: Awaited<ReturnType<typeof createTestRenderer>> | undefined;
  let root: ReturnType<typeof createRoot> | undefined;

  try {
    setup = await createTestRenderer({
      width: config.headless.width,
      height: config.headless.height,
      screenMode: "main-screen",
      consoleMode: "disabled",
      externalOutputMode: "passthrough",
      backgroundColor: theme.palette.canvas,
      useKittyKeyboard: { events: true },
    });
    root = createRoot(setup.renderer);
    root.render(
      <App interruptRequestToken={0} paths={config.paths} theme={theme} onRequestExit={() => {}} />,
    );
    await wait(config.headless.settleMs);
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    await mkdir(dirname(config.headless.framePath), { recursive: true });
    await writeFile(config.headless.framePath, frame, "utf8");
    logger.info("headless frame written", { framePath: config.headless.framePath });
  } finally {
    await controller?.dispose();
    root?.unmount();
    setup?.renderer.destroy();
  }
}

async function runInteractive(
  config: ReturnType<typeof resolveCliConfig>,
  preferences: Awaited<ReturnType<typeof readPreferences>>,
  logger: ReturnType<typeof createLogger>,
): Promise<void> {
  const keyboard = resolveKeyboardPolicy(process.env, preferences);
  const theme = resolveTheme(config.theme ?? preferences.theme);
  const setup = await createInteractiveRenderer(keyboard, theme);
  const { renderer, root } = setup;
  let shuttingDown = false;
  const interruptRequestToken = 0;
  const serverStore = createServerConfigStore();
  const controller = await maybeCreateAttachController(config, serverStore).catch((error) => {
    serverStore.setConnection("error", safeOutputUnknown(error));
    return null;
  });

  const render = () => {
    root.render(
      <App
        interruptRequestToken={interruptRequestToken}
        paths={config.paths}
        theme={theme}
        serverStatus={serverStore.getSnapshot()}
        onRequestExit={() => void shutdown(0)}
      />,
    );
  };

  const shutdown = async (code = 0, error?: unknown) => {
    if (shuttingDown) return;
    shuttingDown = true;

    try {
      await controller?.dispose();
    } catch (disposeError) {
      logger.error("failed to dispose TUI connection", disposeError);
    }

    try {
      root.unmount();
    } catch (unmountError) {
      logger.error("failed to unmount TUI root", unmountError);
    }

    try {
      renderer.destroy();
    } catch (destroyError) {
      logger.error("failed to destroy TUI renderer", destroyError);
    }

    if (error !== undefined) {
      logger.error("x1shell TUI shutdown after error", error);
      process.stderr.write(`${safeOutputUnknown(error)}\n`);
      process.exitCode = code || 1;
    } else {
      process.exitCode = code;
    }

    void logger.close().finally(() => {
      setTimeout(() => process.exit(process.exitCode ?? code), 20).unref();
    });
  };

  const handlers = [
    ["SIGINT", () => void shutdown(130)],
    ["SIGTERM", () => void shutdown(0)],
    ["SIGHUP", () => void shutdown(0)],
    ["uncaughtException", (error: unknown) => void shutdown(1, error)],
    ["unhandledRejection", (error: unknown) => void shutdown(1, error)],
  ] as const satisfies readonly (readonly [ProcessEventName, (...args: never[]) => void])[];

  for (const [event, handler] of handlers) {
    process.on(event, handler);
  }

  renderer.once("destroy", () => {
    for (const [event, handler] of handlers) {
      process.off(event, handler);
    }
  });

  try {
    const unsubscribeServerStore = serverStore.subscribe(() => render());
    renderer.once("destroy", unsubscribeServerStore);
    render();
    void controller?.connect().catch((error) => {
      serverStore.setConnection("error", safeOutputUnknown(error));
    });
  } catch (error) {
    root.unmount();
    renderer.destroy();
    throw error;
  }
}

async function maybeCreateAttachController(
  config: ReturnType<typeof resolveCliConfig>,
  serverStore: ReturnType<typeof createServerConfigStore>,
) {
  if (config.attach.mode === "local") {
    if (!config.attach.serverEntry) {
      return null;
    }
    const target = await resolveLocalAttachTarget({
      baseDir: config.attach.baseDir,
      ...(config.attach.devUrl ? { devUrl: config.attach.devUrl } : {}),
      serverEntry: config.attach.serverEntry,
    });
    serverStore.setAuth("owner");
    return createTuiConnectionController({ target, store: serverStore });
  }
  if (!config.attach.url) {
    return null;
  }
  const secret =
    config.attach.bearerStdin || config.attach.credentialStdin
      ? await readStdinSecret()
      : await promptMasked("Attach credential: ");
  const target = config.attach.credentialStdin
    ? await resolveBootstrapAttachTarget({ baseUrl: config.attach.url, credential: secret })
    : await resolveBearerAttachTarget({ baseUrl: config.attach.url, bearerToken: secret });
  serverStore.setAuth(config.attach.credentialStdin ? "bootstrap" : "bearer");
  return createTuiConnectionController({ target, store: serverStore });
}

async function readStdinSecret(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function promptMasked(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      "Attach credentials require --attach-bearer-stdin or --attach-credential-stdin when stdin is not interactive.",
    );
  }
  process.stdout.write(prompt);
  const wasRaw = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let value = "";
  return await new Promise((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (text === "\u0003") {
        cleanup();
        reject(new Error("Attach credential prompt interrupted."));
        return;
      }
      if (text === "\r" || text === "\n") {
        process.stdout.write("\n");
        cleanup();
        resolve(value);
        return;
      }
      if (text === "\u007f") {
        value = value.slice(0, -1);
        return;
      }
      value += text;
    };
    const cleanup = () => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(wasRaw);
      process.stdin.pause();
    };
    process.stdin.on("data", onData);
  });
}

async function createInteractiveRenderer(
  keyboard: ReturnType<typeof resolveKeyboardPolicy>,
  theme: ReturnType<typeof resolveTheme>,
) {
  const existingErrorListeners = captureProcessListeners(ERROR_PROCESS_EVENTS);
  const renderer = await createCliRenderer({
    screenMode: "alternate-screen",
    externalOutputMode: "passthrough",
    consoleMode: "disabled",
    openConsoleOnError: false,
    exitOnCtrlC: false,
    exitSignals: [],
    useMouse: keyboard.useMouse,
    enableMouseMovement: keyboard.enableMouseMovement,
    useKittyKeyboard: keyboard.useKittyKeyboard ? { events: true } : null,
    backgroundColor: theme.palette.canvas,
  });
  removeAddedProcessListeners(existingErrorListeners);

  try {
    const root = createRoot(renderer);
    return { renderer, root };
  } catch (error) {
    renderer.destroy();
    throw error;
  }
}

const ERROR_PROCESS_EVENTS = ["uncaughtException", "unhandledRejection"] as const;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (import.meta.main) {
  await main();
}
