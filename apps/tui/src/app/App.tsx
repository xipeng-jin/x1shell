import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type React from "react";
import { useMemo, useState } from "react";
import type { ClientOrchestrationCommand, ProjectId, ThreadId } from "@t3tools/contracts";
import type { TuiPaths } from "../cli/config.js";
import {
  buildExistingThreadTurnStart,
  buildNewThreadTurnStart,
  buildThreadApprovalResponse,
  buildThreadArchive,
  buildThreadSessionStop,
  buildThreadTurnInterrupt,
  buildThreadUnarchive,
  buildThreadUserInputResponse,
  canArchiveThread,
  canStopThreadSession,
} from "../domain/commands.js";
import {
  createConversationDisplayCache,
  displayProject,
  displayText,
  displayThread,
} from "../domain/display.js";
import {
  buildUserInputAnswers,
  derivePendingApprovals,
  derivePendingUserInputs,
} from "../domain/pendingActions.js";
import type { TuiServerStatusSnapshot } from "../state/serverConfigStore.js";
import type { TuiShellState } from "../state/orchestrationStore.js";
import type { ThreadDetailState } from "../state/threadDetailStore.js";
import { SafeMarkdown } from "../terminal/safeMarkdown.js";
import type { TuiTheme } from "../terminal/theme.js";

export function App(props: {
  interruptRequestToken: number;
  paths: TuiPaths;
  theme: TuiTheme;
  serverStatus?: TuiServerStatusSnapshot;
  shellState?: TuiShellState;
  threadDetailState?: ThreadDetailState;
  onSelectNextThread?: (direction: 1 | -1) => void;
  onNewThread?: () => void;
  onDraftChange?: (projectId: ProjectId, draft: string) => void;
  onPromoteProjectDraft?: (projectId: ProjectId, threadId: ThreadId) => void;
  onSubmitCommand?: (command: ClientOrchestrationCommand) => Promise<unknown>;
  onRequestExit: () => void;
}): React.ReactNode {
  const dimensions = useTerminalDimensions();
  const compact = dimensions.width < 96;
  const status = props.serverStatus ?? DEFAULT_STATUS;
  const shell = props.shellState ?? DEFAULT_SHELL;
  const activeThreadShell = shell.selectedThreadId
    ? shell.threads.find((thread) => thread.id === shell.selectedThreadId)
    : null;
  const activeProject = shell.selectedProjectId
    ? shell.projects.find((project) => project.id === shell.selectedProjectId)
    : shell.projects[0];
  const activeDetail = shell.selectedThreadId
    ? (props.threadDetailState?.entries[shell.selectedThreadId]?.thread ?? null)
    : null;
  const activeThreadHeader = activeThreadShell ?? activeDetail;
  const draftProjectId = activeProject?.id ?? activeThreadShell?.projectId ?? null;
  const draft = draftProjectId ? (shell.draftByProjectId[draftProjectId] ?? "") : "";
  const [localDraft, setLocalDraft] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [customInputAnswer, setCustomInputAnswer] = useState("");
  const [selectedInputOptions, setSelectedInputOptions] = useState<
    Record<string, readonly number[]>
  >({});
  const composerText = draftProjectId ? draft : localDraft;
  const displayCache = useMemo(() => createConversationDisplayCache({ windowSize: 40 }), []);
  const timeline = useMemo(
    () => displayCache.buildTimeline(activeDetail),
    [activeDetail, displayCache],
  );
  const pendingApprovals = useMemo(
    () => derivePendingApprovals(activeDetail?.activities ?? []),
    [activeDetail?.activities],
  );
  const pendingUserInputs = useMemo(
    () => derivePendingUserInputs(activeDetail?.activities ?? []),
    [activeDetail?.activities],
  );
  const shellAllowsPendingApproval = activeThreadShell?.hasPendingApprovals ?? true;
  const shellAllowsPendingUserInput = activeThreadShell?.hasPendingUserInput ?? true;
  const activePendingApproval = shellAllowsPendingApproval ? (pendingApprovals[0] ?? null) : null;
  const activePendingUserInput = shellAllowsPendingUserInput
    ? (pendingUserInputs[0] ?? null)
    : null;

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      if (activeThreadHeader?.session?.status === "running" && activeThreadHeader.id) {
        void props.onSubmitCommand?.(
          buildThreadTurnInterrupt({
            threadId: activeThreadHeader.id,
            turnId: activeThreadHeader.session.activeTurnId,
          }),
        );
      } else {
        props.onRequestExit();
      }
      return;
    }
    if (activePendingApproval && activeThreadHeader?.id && composerText.length === 0) {
      const decision =
        key.name === "y"
          ? "accept"
          : key.name === "s"
            ? "acceptForSession"
            : key.name === "n"
              ? "decline"
              : key.name === "c"
                ? "cancel"
                : null;
      if (decision) {
        void props.onSubmitCommand?.(
          buildThreadApprovalResponse({
            threadId: activeThreadHeader.id,
            requestId: activePendingApproval.requestId,
            decision,
          }),
        );
        return;
      }
    }
    if (activePendingUserInput && activeThreadHeader?.id) {
      const activeQuestion = activePendingUserInput.questions[0];
      if (/^[1-9]$/.test(key.name)) {
        toggleUserInputOption(Number(key.name) - 1, activeQuestion?.id);
        return;
      }
      if (key.name === "backspace") {
        setCustomInputAnswer(customInputAnswer.slice(0, -1));
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        const answers = buildUserInputAnswers({
          pending: activePendingUserInput,
          selectedOptions: selectedInputOptions,
          customAnswer: customInputAnswer,
          ...(activeQuestion ? { questionIds: new Set([activeQuestion.id]) } : {}),
        });
        void props.onSubmitCommand?.(
          buildThreadUserInputResponse({
            threadId: activeThreadHeader.id,
            requestId: activePendingUserInput.requestId,
            answers,
          }),
        );
        setCustomInputAnswer("");
        setSelectedInputOptions({});
        return;
      }
      if (!key.ctrl && !key.meta && key.sequence && key.sequence.length === 1) {
        setCustomInputAnswer(customInputAnswer + key.sequence);
        return;
      }
    }
    if (key.name === "q" && composerText.length === 0) {
      props.onRequestExit();
      return;
    }
    if (composerText.length === 0 && key.name === "up") {
      props.onSelectNextThread?.(-1);
      return;
    }
    if (composerText.length === 0 && key.name === "down") {
      props.onSelectNextThread?.(1);
      return;
    }
    if (key.ctrl && key.name === "n") {
      props.onNewThread?.();
      return;
    }
    if (composerText.length === 0 && key.name === "s" && canStopThreadSession(activeThreadHeader)) {
      void props.onSubmitCommand?.(buildThreadSessionStop({ threadId: activeThreadHeader!.id }));
      return;
    }
    if (composerText.length === 0 && key.name === "a" && activeThreadHeader?.id) {
      if (activeThreadHeader.archivedAt) {
        void props.onSubmitCommand?.(buildThreadUnarchive({ threadId: activeThreadHeader.id }));
      } else if (canArchiveThread(activeThreadHeader)) {
        void props.onSubmitCommand?.(buildThreadArchive({ threadId: activeThreadHeader.id }));
      }
      return;
    }
    if (key.name === "backspace") {
      updateDraft(composerText.slice(0, -1));
      return;
    }
    if (key.name === "return" || key.name === "enter") {
      void submit();
      return;
    }
    if (!key.ctrl && !key.meta && key.sequence && key.sequence.length === 1) {
      updateDraft(composerText + key.sequence);
    }
  });

  function updateDraft(next: string) {
    setSubmitError(null);
    if (draftProjectId) props.onDraftChange?.(draftProjectId, next);
    else setLocalDraft(next);
  }

  async function submit() {
    const text = composerText.trim();
    if (!text || !props.onSubmitCommand) return;
    try {
      if (activeThreadShell) {
        await props.onSubmitCommand(
          buildExistingThreadTurnStart({ thread: activeThreadShell, text }),
        );
      } else if (activeProject) {
        const command = buildNewThreadTurnStart({ project: activeProject, text });
        await props.onSubmitCommand(command);
        props.onPromoteProjectDraft?.(activeProject.id, command.threadId);
      } else {
        return;
      }
      if (draftProjectId) props.onDraftChange?.(draftProjectId, "");
      else setLocalDraft("");
    } catch (error) {
      setSubmitError(displayText(String(error)));
    }
  }

  function toggleUserInputOption(index: number, questionId: string | undefined) {
    if (!questionId || !activePendingUserInput) return;
    const question = activePendingUserInput.questions.find((entry) => entry.id === questionId);
    if (!question || !question.options[index]) return;
    setSelectedInputOptions((existing) => {
      const current = existing[questionId] ?? [];
      const next = question.multiSelect
        ? current.includes(index)
          ? current.filter((value) => value !== index)
          : [...current, index]
        : [index];
      return { ...existing, [questionId]: next };
    });
  }

  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor={props.theme.palette.canvas}
    >
      <box
        height={3}
        paddingLeft={2}
        paddingRight={2}
        border
        borderColor={props.theme.palette.border}
      >
        <text fg={props.theme.palette.accent} attributes={1}>
          {`X1Shell | ${dimensions.width}x${dimensions.height} | ${status.connection} | shell seq ${shell.lastAppliedSequence}`}
        </text>
      </box>

      <box flexGrow={1} flexDirection={compact ? "column" : "row"}>
        <Sidebar shell={shell} compact={compact} theme={props.theme} />
        <box flexGrow={1} paddingLeft={2} paddingTop={1} paddingRight={2}>
          <ThreadHeader thread={activeThreadHeader} theme={props.theme} />
          <box flexGrow={1} flexDirection="column">
            {timeline.length === 0 ? (
              <text fg={props.theme.palette.muted}>
                {status.connection === "connected"
                  ? "No messages yet."
                  : "Waiting for shell snapshot."}
              </text>
            ) : (
              timeline.slice(-18).map((entry) =>
                entry.kind === "message" ? (
                  <box key={entry.key} flexDirection="column" marginBottom={1}>
                    <text fg={props.theme.palette.muted}>{entry.role}</text>
                    <SafeMarkdown fg={props.theme.palette.text} content={entry.markdown} />
                  </box>
                ) : (
                  <text key={entry.key} fg={props.theme.palette.muted}>
                    {entry.text}
                  </text>
                ),
              )
            )}
          </box>
        </box>
      </box>

      <box
        height={activePendingApproval || activePendingUserInput ? 9 : 5}
        paddingLeft={2}
        paddingRight={2}
        border
        borderColor={props.theme.palette.border}
      >
        {activePendingApproval ? (
          <PendingApprovalPanel approval={activePendingApproval} theme={props.theme} />
        ) : activePendingUserInput ? (
          <PendingUserInputPanel
            pending={activePendingUserInput}
            customAnswer={customInputAnswer}
            selectedOptions={selectedInputOptions}
            theme={props.theme}
          />
        ) : null}
        <text
          fg={props.theme.palette.muted}
        >{`↑/↓ select | ^n new | ^c interrupt/exit | a archive | s stop | enter send | q exits`}</text>
        <text fg={props.theme.palette.muted}>{displayText(props.paths.configDir)}</text>
        <input focused value={composerText} placeholder="Message agent..." />
        {submitError ? <text fg={props.theme.palette.danger}>{submitError}</text> : null}
      </box>
    </box>
  );
}

function PendingApprovalPanel(props: {
  approval: ReturnType<typeof derivePendingApprovals>[number];
  theme: TuiTheme;
}) {
  return (
    <box flexDirection="column">
      <text
        fg={props.theme.palette.accent}
      >{`Approval: ${displayText(props.approval.requestKind)}`}</text>
      {props.approval.detail ? (
        <text fg={props.theme.palette.muted}>{displayText(props.approval.detail)}</text>
      ) : null}
      <text fg={props.theme.palette.muted}>y accept | s session | n decline | c cancel</text>
    </box>
  );
}

function PendingUserInputPanel(props: {
  pending: ReturnType<typeof derivePendingUserInputs>[number];
  selectedOptions: Readonly<Record<string, readonly number[]>>;
  customAnswer: string;
  theme: TuiTheme;
}) {
  const question = props.pending.questions[0];
  if (!question) return null;
  const selected = props.selectedOptions[question.id] ?? [];
  return (
    <box flexDirection="column">
      <text fg={props.theme.palette.accent}>{displayText(question.header)}</text>
      <text fg={props.theme.palette.text}>{displayText(question.question)}</text>
      <text fg={props.theme.palette.muted}>
        {question.options
          .slice(0, 9)
          .map(
            (option, index) =>
              `${index + 1}${selected.includes(index) ? "*" : ""}:${displayText(option.label)}`,
          )
          .join("  ")}
      </text>
      <text fg={props.theme.palette.muted}>{`custom: ${displayText(props.customAnswer)}`}</text>
    </box>
  );
}

function Sidebar(props: { shell: TuiShellState; compact: boolean; theme: TuiTheme }) {
  return (
    <box
      width={props.compact ? "100%" : 34}
      height={props.compact ? 9 : "100%"}
      paddingLeft={2}
      paddingTop={1}
      border
      borderColor={props.theme.palette.border}
      backgroundColor={props.theme.palette.panel}
      flexDirection="column"
    >
      <text fg={props.theme.palette.text} attributes={1}>
        Projects
      </text>
      {props.shell.projects.slice(0, 4).map((project) => {
        const display = displayProject(project);
        return (
          <text
            key={project.id}
            fg={
              project.id === props.shell.selectedProjectId
                ? props.theme.palette.accent
                : props.theme.palette.muted
            }
          >
            {display.title}
          </text>
        );
      })}
      <text fg={props.theme.palette.text} attributes={1}>
        Threads
      </text>
      {props.shell.threads
        .filter(
          (thread) => !thread.archivedAt && thread.projectId === props.shell.selectedProjectId,
        )
        .slice(0, 12)
        .map((thread) => {
          const display = displayThread(thread);
          return (
            <text
              key={thread.id}
              fg={
                thread.id === props.shell.selectedThreadId
                  ? props.theme.palette.accent
                  : props.theme.palette.muted
              }
            >
              {`${thread.id === props.shell.selectedThreadId ? "> " : "  "}${display.title}`}
            </text>
          );
        })}
    </box>
  );
}

function ThreadHeader(props: {
  thread: ReturnType<typeof displayThread> extends never
    ? never
    : Parameters<typeof displayThread>[0] | null | undefined;
  theme: TuiTheme;
}) {
  if (!props.thread) {
    return (
      <text fg={props.theme.palette.text} attributes={1}>
        New thread
      </text>
    );
  }
  const display = displayThread(props.thread);
  return (
    <box flexDirection="column" marginBottom={1}>
      <text fg={props.theme.palette.text} attributes={1}>
        {display.title}
      </text>
      <text fg={props.theme.palette.muted}>
        {`${display.provider}/${display.model} | ${display.session}${display.branch ? ` | ${display.branch}` : ""}`}
      </text>
    </box>
  );
}

const DEFAULT_STATUS: TuiServerStatusSnapshot = {
  connection: "idle",
  auth: "none",
  config: null,
  latestWelcome: null,
  latestReady: null,
  shell: null,
  error: null,
};

const DEFAULT_SHELL: TuiShellState = {
  projects: [],
  threads: [],
  updatedAt: null,
  lastAppliedSequence: 0,
  selectedProjectId: null,
  selectedThreadId: null,
  draftByProjectId: {},
  pendingDraftThreadIdByProjectId: {},
};
