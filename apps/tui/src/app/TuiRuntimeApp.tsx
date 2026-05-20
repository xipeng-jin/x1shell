import { createSignal, onCleanup } from "solid-js";
import type { ProjectId, ThreadId } from "@t3tools/contracts";
import { App } from "./App.js";
import type { TuiPaths } from "../cli/config.js";
import type { createDebugBuffer } from "../domain/debug.js";
import type { createOrchestrationStore } from "../state/orchestrationStore.js";
import type { createServerConfigStore } from "../state/serverConfigStore.js";
import type { createThreadDetailStore } from "../state/threadDetailStore.js";
import type { TuiTheme } from "../terminal/theme.js";

export function TuiRuntimeApp(props: {
  interruptRequestToken: number;
  paths: TuiPaths;
  launchCwd: string;
  theme: TuiTheme;
  serverStore: ReturnType<typeof createServerConfigStore>;
  orchestrationStore: ReturnType<typeof createOrchestrationStore>;
  threadDetailStore: ReturnType<typeof createThreadDetailStore>;
  debugBuffer: ReturnType<typeof createDebugBuffer>;
  onSelectProject?: (projectId: ProjectId) => void;
  onSelectThread?: (threadId: ThreadId) => void;
  onCreateProjectDraft?: (projectId: ProjectId) => void;
  onCreatePendingProjectDraft?: Parameters<typeof App>[0]["onCreatePendingProjectDraft"];
  onSelectNextThread?: (direction: 1 | -1) => void;
  onNewThread?: () => void;
  onSubmitCommand?: Parameters<typeof App>[0]["onSubmitCommand"];
  onReconnect?: () => Promise<unknown>;
  onRefreshProviders?: () => Promise<unknown>;
  onGetTurnDiff?: Parameters<typeof App>[0]["onGetTurnDiff"];
  onGetFullThreadDiff?: Parameters<typeof App>[0]["onGetFullThreadDiff"];
  onRefreshVcsStatus?: Parameters<typeof App>[0]["onRefreshVcsStatus"];
  onBrowseFilesystem?: Parameters<typeof App>[0]["onBrowseFilesystem"];
  onPreviewTheme?: Parameters<typeof App>[0]["onPreviewTheme"];
  onCommitTheme?: Parameters<typeof App>[0]["onCommitTheme"];
  onCancelThemePreview?: Parameters<typeof App>[0]["onCancelThemePreview"];
  onRequestExit: () => void;
}) {
  const [serverStatus, setServerStatus] = createSignal(props.serverStore.getSnapshot());
  const [shellState, setShellState] = createSignal(props.orchestrationStore.getSnapshot());
  const [threadDetailState, setThreadDetailState] = createSignal(
    props.threadDetailStore.getSnapshot(),
  );
  const [debugEntries, setDebugEntries] = createSignal(props.debugBuffer.getSnapshot());

  const unsubscribers = [
    props.serverStore.subscribe(() => setServerStatus(props.serverStore.getSnapshot())),
    props.orchestrationStore.subscribe(() => setShellState(props.orchestrationStore.getSnapshot())),
    props.threadDetailStore.subscribe(() =>
      setThreadDetailState(props.threadDetailStore.getSnapshot()),
    ),
    props.debugBuffer.subscribe(() => setDebugEntries(props.debugBuffer.getSnapshot())),
  ];
  onCleanup(() => {
    for (const unsubscribe of unsubscribers) unsubscribe();
  });

  return (
    <App
      interruptRequestToken={props.interruptRequestToken}
      paths={props.paths}
      launchCwd={props.launchCwd}
      theme={props.theme}
      serverStatus={serverStatus()}
      shellState={shellState()}
      threadDetailState={threadDetailState()}
      debugEntries={debugEntries()}
      onSelectProject={(projectId) => props.onSelectProject?.(projectId)}
      onSelectThread={(threadId) => props.onSelectThread?.(threadId)}
      onCreateProjectDraft={(projectId) => props.onCreateProjectDraft?.(projectId)}
      {...(props.onCreatePendingProjectDraft
        ? { onCreatePendingProjectDraft: props.onCreatePendingProjectDraft }
        : {})}
      {...(props.onSelectNextThread ? { onSelectNextThread: props.onSelectNextThread } : {})}
      {...(props.onNewThread ? { onNewThread: props.onNewThread } : {})}
      onDraftChange={(projectId, draft) => props.orchestrationStore.setDraft(projectId, draft)}
      onDraftContextChange={(projectId, context) =>
        props.orchestrationStore.setDraftContext(projectId, context)
      }
      onDraftAttachmentsChange={(projectId, attachments) =>
        props.orchestrationStore.setDraftAttachments(projectId, attachments)
      }
      onPromoteProjectDraft={(projectId, threadId) =>
        props.orchestrationStore.promoteProjectDraft(projectId, threadId)
      }
      {...(props.onSubmitCommand ? { onSubmitCommand: props.onSubmitCommand } : {})}
      {...(props.onReconnect ? { onReconnect: props.onReconnect } : {})}
      {...(props.onRefreshProviders ? { onRefreshProviders: props.onRefreshProviders } : {})}
      {...(props.onGetTurnDiff ? { onGetTurnDiff: props.onGetTurnDiff } : {})}
      {...(props.onGetFullThreadDiff ? { onGetFullThreadDiff: props.onGetFullThreadDiff } : {})}
      {...(props.onRefreshVcsStatus ? { onRefreshVcsStatus: props.onRefreshVcsStatus } : {})}
      {...(props.onBrowseFilesystem ? { onBrowseFilesystem: props.onBrowseFilesystem } : {})}
      {...(props.onPreviewTheme ? { onPreviewTheme: props.onPreviewTheme } : {})}
      {...(props.onCommitTheme ? { onCommitTheme: props.onCommitTheme } : {})}
      {...(props.onCancelThemePreview ? { onCancelThemePreview: props.onCancelThemePreview } : {})}
      onRequestExit={props.onRequestExit}
    />
  );
}
