import { useSyncExternalStore } from "react";
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
  theme: TuiTheme;
  serverStore: ReturnType<typeof createServerConfigStore>;
  orchestrationStore: ReturnType<typeof createOrchestrationStore>;
  threadDetailStore: ReturnType<typeof createThreadDetailStore>;
  debugBuffer: ReturnType<typeof createDebugBuffer>;
  onSelectProject?: (projectId: ProjectId) => void;
  onSelectThread?: (threadId: ThreadId) => void;
  onCreateProjectDraft?: (projectId: ProjectId) => void;
  onSelectNextThread?: (direction: 1 | -1) => void;
  onNewThread?: () => void;
  onSubmitCommand?: Parameters<typeof App>[0]["onSubmitCommand"];
  onReconnect?: () => Promise<unknown>;
  onRefreshProviders?: () => Promise<unknown>;
  onGetTurnDiff?: Parameters<typeof App>[0]["onGetTurnDiff"];
  onGetFullThreadDiff?: Parameters<typeof App>[0]["onGetFullThreadDiff"];
  onRefreshVcsStatus?: Parameters<typeof App>[0]["onRefreshVcsStatus"];
  onRequestExit: () => void;
}) {
  const serverStatus = useSyncExternalStore(
    props.serverStore.subscribe,
    props.serverStore.getSnapshot,
    props.serverStore.getSnapshot,
  );
  const shellState = useSyncExternalStore(
    props.orchestrationStore.subscribe,
    props.orchestrationStore.getSnapshot,
    props.orchestrationStore.getSnapshot,
  );
  const threadDetailState = useSyncExternalStore(
    props.threadDetailStore.subscribe,
    props.threadDetailStore.getSnapshot,
    props.threadDetailStore.getSnapshot,
  );
  const debugEntries = useSyncExternalStore(
    props.debugBuffer.subscribe,
    props.debugBuffer.getSnapshot,
    props.debugBuffer.getSnapshot,
  );

  return (
    <App
      interruptRequestToken={props.interruptRequestToken}
      paths={props.paths}
      theme={props.theme}
      serverStatus={serverStatus}
      shellState={shellState}
      threadDetailState={threadDetailState}
      debugEntries={debugEntries}
      onSelectProject={(projectId) => props.onSelectProject?.(projectId)}
      onSelectThread={(threadId) => props.onSelectThread?.(threadId)}
      onCreateProjectDraft={(projectId) => props.onCreateProjectDraft?.(projectId)}
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
      onRequestExit={props.onRequestExit}
    />
  );
}
