import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createCliRenderer } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { render } from "@opentui/solid";
import { createEffect, createSignal } from "solid-js";
import { App } from "./app/App.js";
import { TuiRuntimeApp } from "./app/TuiRuntimeApp.js";
import { resolveCliConfig } from "./cli/config.js";
import { readPreferences, writePreferences } from "./cli/preferences.js";
import { resolveBearerAttachTarget, resolveBootstrapAttachTarget } from "./runtime/attach.js";
import { createTuiConnectionController } from "./runtime/connection.js";
import {
  startLocalManagedSupervisor,
  type LocalManagedSupervisor,
} from "./runtime/localManaged.js";
import { createLogger, safeOutputUnknown } from "./runtime/log.js";
import { createDebugBuffer } from "./domain/debug.js";
import { createDefaultTuiModelSelection } from "./domain/providerInstances.js";
import {
  captureProcessListeners,
  removeAddedProcessListeners,
} from "./runtime/processListeners.js";
import { resolveKeyboardPolicy } from "./terminal/keyboard.js";
import { resolveTheme, resolveThemeId } from "./terminal/theme.js";
import { createServerConfigStore } from "./state/serverConfigStore.js";
import { createOrchestrationStore } from "./state/orchestrationStore.js";
import { createThreadDetailStore } from "./state/threadDetailStore.js";

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
  const theme = resolveTheme(preferences.theme ?? config.theme);
  const serverStore = createServerConfigStore();
  const launchCwd = process.cwd();
  const orchestrationStore = createOrchestrationStore({ launchCwd });
  const threadDetailStore = createThreadDetailStore();
  seedHeadlessFixture(process.env, serverStore, orchestrationStore, threadDetailStore);
  const localSupervisor = await maybeStartLocalSupervisor(config, logger).catch((error) => {
    serverStore.setConnection("error", safeOutputUnknown(error));
    return null;
  });
  const controller = await maybeCreateAttachController(
    config,
    serverStore,
    localSupervisor,
    orchestrationStore,
    threadDetailStore,
  ).catch((error) => {
    serverStore.setConnection("error", safeOutputUnknown(error));
    return null;
  });
  const unsubscribeRestart = localSupervisor?.onRestarted(() => controller?.reconnect());
  await controller?.connect().catch((error) => {
    serverStore.setConnection("error", safeOutputUnknown(error));
  });
  let setup: Awaited<ReturnType<typeof createTestRenderer>> | undefined;

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
    await render(
      () => (
        <App
          interruptRequestToken={0}
          paths={config.paths}
          launchCwd={launchCwd}
          theme={theme}
          serverStatus={serverStore.getSnapshot()}
          shellState={orchestrationStore.getSnapshot()}
          threadDetailState={threadDetailStore.getSnapshot()}
          onRequestExit={() => {}}
        />
      ),
      setup.renderer,
    );
    await wait(config.headless.settleMs);
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    await mkdir(dirname(config.headless.framePath), { recursive: true });
    await writeFile(config.headless.framePath, frame, "utf8");
    logger.info("headless frame written", { framePath: config.headless.framePath });
  } finally {
    unsubscribeRestart?.();
    await controller?.dispose();
    await localSupervisor?.stop();
    setup?.renderer.destroy();
  }
}

function seedHeadlessFixture(
  env: NodeJS.ProcessEnv,
  serverStore: ReturnType<typeof createServerConfigStore>,
  orchestrationStore: ReturnType<typeof createOrchestrationStore>,
  threadDetailStore: ReturnType<typeof createThreadDetailStore>,
) {
  if (env.X1SHELL_HEADLESS_FIXTURE !== "1") return;
  serverStore.setConnection("connected");
  orchestrationStore.applyShellItem({
    kind: "snapshot",
    snapshot: {
      snapshotSequence: 42,
      updatedAt: "2026-04-28T00:00:00.000Z",
      projects: [
        {
          id: "project-a",
          title: "Project",
          workspaceRoot: "/repo/project",
          defaultModelSelection: createDefaultTuiModelSelection(),
          scripts: [],
          createdAt: "2026-04-28T00:00:00.000Z",
          updatedAt: "2026-04-28T00:00:00.000Z",
        } as never,
      ],
      threads: [
        {
          id: "thread-a",
          projectId: "project-a",
          title: "Thread Shell Fresh",
          modelSelection: createDefaultTuiModelSelection(),
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: "main",
          worktreePath: "/repo/project",
          latestTurn: null,
          createdAt: "2026-04-28T00:00:00.000Z",
          updatedAt: "2026-04-28T00:00:00.000Z",
          archivedAt: null,
          session: null,
          latestUserMessageAt: null,
          hasPendingApprovals: false,
          hasPendingUserInput: false,
          hasActionableProposedPlan: false,
        } as never,
      ],
    },
  });
  orchestrationStore.setDraft("project-a" as never, "draft");
  threadDetailStore.applyThreadItem("thread-a" as never, {
    kind: "snapshot",
    snapshot: {
      snapshotSequence: 43,
      thread: {
        id: "thread-a",
        projectId: "project-a",
        title: "Thread Detail Stale",
        modelSelection: createDefaultTuiModelSelection(),
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: "main",
        worktreePath: "/repo/project",
        latestTurn: null,
        createdAt: "2026-04-28T00:00:00.000Z",
        updatedAt: "2026-04-28T00:00:00.000Z",
        archivedAt: null,
        deletedAt: null,
        messages: [
          {
            id: "message-a",
            role: "assistant",
            text: "hello \u001b]8;;https://evil.example\u0007link\u001b]8;;\u0007",
            attachments: [],
            turnId: null,
            streaming: false,
            createdAt: "2026-04-28T00:00:00.000Z",
            updatedAt: "2026-04-28T00:00:00.000Z",
          },
        ],
        proposedPlans: [
          {
            id: "plan-a",
            turnId: null,
            planMarkdown: "Plan with token=plan-secret and [link](https://evil.example/plan)",
            implementedAt: null,
            implementationThreadId: null,
            createdAt: "2026-04-28T00:00:02.000Z",
            updatedAt: "2026-04-28T00:00:02.000Z",
          },
        ],
        activities: [
          {
            id: "event-a",
            tone: "tool",
            kind: "tool",
            summary: "ran ls",
            payload: {},
            turnId: null,
            sequence: 43,
            createdAt: "2026-04-28T00:00:01.000Z",
          },
        ],
        checkpoints: [],
        session: null,
      } as never,
    },
  });
}

async function runInteractive(
  config: ReturnType<typeof resolveCliConfig>,
  preferences: Awaited<ReturnType<typeof readPreferences>>,
  logger: ReturnType<typeof createLogger>,
): Promise<void> {
  const keyboard = resolveKeyboardPolicy(process.env, preferences);
  const theme = resolveTheme(preferences.theme ?? config.theme);
  const setup = await createInteractiveRenderer(keyboard, theme);
  const { renderer } = setup;
  let shuttingDown = false;
  const interruptRequestToken = 0;
  const serverStore = createServerConfigStore();
  const launchCwd = process.cwd();
  const orchestrationStore = createOrchestrationStore({ launchCwd });
  const threadDetailStore = createThreadDetailStore();
  const debugBuffer = createDebugBuffer();
  let localSupervisor: LocalManagedSupervisor | null = null;
  let controller: Awaited<ReturnType<typeof maybeCreateAttachController>> | null = null;
  let unsubscribeRestart: (() => void) | undefined;

  const shutdown = async (code = 0, error?: unknown) => {
    if (shuttingDown) return;
    shuttingDown = true;

    try {
      unsubscribeRestart?.();
      await controller?.dispose();
      await localSupervisor?.stop();
    } catch (disposeError) {
      logger.error("failed to dispose TUI connection", disposeError);
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
    await render(() => {
      const initialThemeId = resolveThemeId(preferences.theme ?? config.theme);
      const [themeId, setThemeId] = createSignal(initialThemeId);
      let committedThemeId = initialThemeId;
      let themeCommitSequence = 0;
      const activeTheme = () => resolveTheme(themeId());

      createEffect(() => {
        renderer.setBackgroundColor(activeTheme().palette.canvas);
      });

      return (
        <TuiRuntimeApp
          interruptRequestToken={interruptRequestToken}
          paths={config.paths}
          launchCwd={launchCwd}
          theme={activeTheme()}
          serverStore={serverStore}
          orchestrationStore={orchestrationStore}
          threadDetailStore={threadDetailStore}
          debugBuffer={debugBuffer}
          onSelectProject={(projectId) => {
            orchestrationStore.selectProject(projectId);
            controller?.setActiveThread(null);
          }}
          onSelectThread={(threadId) => {
            orchestrationStore.selectThread(threadId);
            controller?.setActiveThread(threadId);
          }}
          onCreateProjectDraft={(projectId) => {
            orchestrationStore.createProjectDraft(projectId);
            controller?.setActiveThread(null);
          }}
          onCreatePendingProjectDraft={(input) => {
            orchestrationStore.createPendingProjectDraft(input);
            controller?.setActiveThread(null);
          }}
          onSelectNextThread={(direction) => {
            orchestrationStore.selectNextThread(direction);
            controller?.setActiveThread(orchestrationStore.getSnapshot().selectedThreadId);
          }}
          onNewThread={() => {
            orchestrationStore.createProjectDraft();
            controller?.setActiveThread(null);
          }}
          onSubmitCommand={(command) => {
            if (!controller) return Promise.reject(new Error("Not connected."));
            debugBuffer.push("info", "dispatch command", { type: command.type });
            return controller.dispatchCommand(command);
          }}
          onReconnect={async () => {
            debugBuffer.push("info", "manual reconnect");
            await controller?.reconnect();
          }}
          onRefreshProviders={async () => {
            debugBuffer.push("info", "refresh providers");
            await controller?.refreshProviders();
          }}
          onGetTurnDiff={(input) => {
            debugBuffer.push("info", "load turn diff", input);
            if (!controller) return Promise.reject(new Error("Not connected."));
            return controller.getTurnDiff(input);
          }}
          onGetFullThreadDiff={(input) => {
            debugBuffer.push("info", "load full thread diff", input);
            if (!controller) return Promise.reject(new Error("Not connected."));
            return controller.getFullThreadDiff(input);
          }}
          onRefreshVcsStatus={(cwd) => {
            debugBuffer.push("info", "refresh vcs status", { cwd });
            if (!controller) return Promise.reject(new Error("Not connected."));
            return controller.refreshVcsStatus(cwd);
          }}
          onBrowseFilesystem={(input) => {
            debugBuffer.push("info", "browse filesystem", { partialPath: input.partialPath });
            if (!controller) return Promise.reject(new Error("Not connected."));
            return controller.browseFilesystem(input);
          }}
          onPreviewTheme={(nextThemeId) => setThemeId(nextThemeId)}
          onCancelThemePreview={() => setThemeId(committedThemeId)}
          onCommitTheme={async (nextThemeId) => {
            const sequence = ++themeCommitSequence;
            const latestPreferences = await readPreferences(config.paths);
            if (sequence !== themeCommitSequence) return;
            await writePreferences(config.paths, { ...latestPreferences, theme: nextThemeId });
            if (sequence !== themeCommitSequence) return;
            committedThemeId = nextThemeId;
            setThemeId(nextThemeId);
          }}
          onRequestExit={() => void shutdown(0)}
        />
      );
    }, renderer);
    void bootstrapConnection({
      config,
      logger,
      serverStore,
      orchestrationStore,
      threadDetailStore,
      setLocalSupervisor: (next) => {
        localSupervisor = next;
      },
      setController: (next) => {
        controller = next;
      },
      setUnsubscribeRestart: (next) => {
        unsubscribeRestart = next;
      },
      getController: () => controller,
      isShuttingDown: () => shuttingDown,
    });
  } catch (error) {
    renderer.destroy();
    throw error;
  }
}

async function bootstrapConnection(input: {
  readonly config: ReturnType<typeof resolveCliConfig>;
  readonly logger: ReturnType<typeof createLogger>;
  readonly serverStore: ReturnType<typeof createServerConfigStore>;
  readonly orchestrationStore: ReturnType<typeof createOrchestrationStore>;
  readonly threadDetailStore: ReturnType<typeof createThreadDetailStore>;
  readonly setLocalSupervisor: (supervisor: LocalManagedSupervisor | null) => void;
  readonly setController: (
    controller: Awaited<ReturnType<typeof maybeCreateAttachController>> | null,
  ) => void;
  readonly setUnsubscribeRestart: (unsubscribe: (() => void) | undefined) => void;
  readonly getController: () => Awaited<ReturnType<typeof maybeCreateAttachController>> | null;
  readonly isShuttingDown: () => boolean;
}): Promise<void> {
  if (input.isShuttingDown()) return;
  input.serverStore.setConnection("connecting");

  const localSupervisor = await maybeStartLocalSupervisor(input.config, input.logger).catch(
    (error) => {
      input.serverStore.setConnection("error", safeOutputUnknown(error));
      return null;
    },
  );
  if (input.isShuttingDown()) {
    await localSupervisor?.stop();
    return;
  }
  input.setLocalSupervisor(localSupervisor);

  const controller = await maybeCreateAttachController(
    input.config,
    input.serverStore,
    localSupervisor,
    input.orchestrationStore,
    input.threadDetailStore,
  ).catch((error) => {
    input.serverStore.setConnection("error", safeOutputUnknown(error));
    return null;
  });
  if (input.isShuttingDown()) {
    await controller?.dispose();
    await localSupervisor?.stop();
    return;
  }
  input.setController(controller);
  input.setUnsubscribeRestart(
    localSupervisor?.onRestarted(() => input.getController()?.reconnect()),
  );

  await controller?.connect().catch((error) => {
    input.serverStore.setConnection("error", safeOutputUnknown(error));
  });
}

async function maybeCreateAttachController(
  config: ReturnType<typeof resolveCliConfig>,
  serverStore: ReturnType<typeof createServerConfigStore>,
  localSupervisor: LocalManagedSupervisor | null | undefined,
  orchestrationStore: ReturnType<typeof createOrchestrationStore>,
  threadDetailStore: ReturnType<typeof createThreadDetailStore>,
) {
  if (config.attach.mode === "local-managed") {
    if (!localSupervisor) return null;
    const target = localSupervisor.target;
    serverStore.setAuth("owner");
    return createTuiConnectionController({
      target,
      store: serverStore,
      orchestrationStore,
      threadDetailStore,
    });
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
  return createTuiConnectionController({
    target,
    store: serverStore,
    orchestrationStore,
    threadDetailStore,
  });
}

async function maybeStartLocalSupervisor(
  config: ReturnType<typeof resolveCliConfig>,
  logger: ReturnType<typeof createLogger>,
): Promise<LocalManagedSupervisor | null> {
  if (config.attach.mode !== "local-managed") return null;
  if (config.headless.enabled && !config.attach.serverEntry && !config.attach.newServer)
    return null;
  return startLocalManagedSupervisor({
    baseDir: config.attach.baseDir,
    ...(config.attach.devUrl ? { devUrl: config.attach.devUrl } : {}),
    ...(config.attach.serverEntry ? { serverEntry: config.attach.serverEntry } : {}),
    newServer: config.attach.newServer,
    cwd: process.cwd(),
    logger,
  });
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
    return { renderer };
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
