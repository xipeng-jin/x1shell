import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import type { ProjectId } from "@t3tools/contracts";
import { App } from "../app/App.js";
import { createDefaultTuiModelSelection } from "../domain/providerInstances.js";
import { createOrchestrationStore } from "../state/orchestrationStore.js";
import { resolveTheme } from "../terminal/theme.js";

const framePath = process.argv[2];
if (!framePath) throw new Error("frame path argument is required");

const projectId = "project-a" as ProjectId;
const theme = resolveTheme("dark");
const first = await createHarness();
let composerFrame = "";
let paletteFrame = "";
try {
  await first.setup.renderOnce();
  await first.setup.mockInput.pasteBracketedText("pasted composer text");
  await first.setup.renderOnce();
  composerFrame = first.setup.captureCharFrame();

  first.setup.mockInput.pressKey("p", { ctrl: true });
  await first.setup.renderOnce();
  await first.setup.mockInput.pasteBracketedText("help");
  await first.setup.renderOnce();
  paletteFrame = first.setup.captureCharFrame();
} finally {
  first.unsubscribe();
  first.setup.renderer.destroy();
}

const second = await createHarness();
let attachmentFrame = "";
try {
  await second.setup.renderOnce();
  await second.setup.mockInput.pasteBracketedText("data:image/png;base64,QUJD");
  await second.setup.renderOnce();
  attachmentFrame = second.setup.captureCharFrame();
} finally {
  second.unsubscribe();
  second.setup.renderer.destroy();
}

await mkdir(dirname(framePath), { recursive: true });
await writeFile(
  framePath,
  [
    "=== composer ===",
    composerFrame,
    "=== palette ===",
    paletteFrame,
    "=== attachment ===",
    attachmentFrame,
  ].join("\n"),
  "utf8",
);

async function createHarness() {
  const store = createOrchestrationStore({ launchCwd: "/repo/project" });
  store.applyShellItem({
    kind: "snapshot",
    snapshot: {
      snapshotSequence: 1,
      updatedAt: "2026-05-20T00:00:00.000Z",
      projects: [
        {
          id: projectId,
          title: "Project",
          workspaceRoot: "/repo/project",
          defaultModelSelection: createDefaultTuiModelSelection(),
          scripts: [],
          createdAt: "2026-05-20T00:00:00.000Z",
          updatedAt: "2026-05-20T00:00:00.000Z",
        } as never,
      ],
      threads: [],
    },
  });
  const [shellState, setShellState] = createSignal(store.getSnapshot());
  const unsubscribe = store.subscribe(() => setShellState(store.getSnapshot()));
  const setup = await testRender(
    () => (
      <App
        interruptRequestToken={0}
        paths={{} as never}
        launchCwd="/repo/project"
        theme={theme}
        serverStatus={{
          connection: "connected",
          auth: "owner",
          latestWelcome: null,
          latestReady: null,
          shell: null,
          error: null,
          config: {
            cwd: "/repo/project",
            providers: [],
            settings: { addProjectBaseDirectory: "/home/tester" },
            environment: { platform: { os: "linux" } },
          } as never,
        }}
        shellState={shellState()}
        onDraftChange={(id, draft) => store.setDraft(id, draft)}
        onRequestExit={() => {}}
      />
    ),
    {
      width: 100,
      height: 24,
      screenMode: "main-screen",
      consoleMode: "disabled",
      externalOutputMode: "passthrough",
      backgroundColor: theme.palette.canvas,
    },
  );
  return { setup, unsubscribe };
}
