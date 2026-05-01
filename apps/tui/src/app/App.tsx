import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type ClientOrchestrationCommand,
  type GitStatusResult,
  type ModelSelection,
  type OrchestrationGetFullThreadDiffInput,
  type OrchestrationGetFullThreadDiffResult,
  type OrchestrationGetTurnDiffInput,
  type OrchestrationGetTurnDiffResult,
  type ProviderInteractionMode,
  type ProjectId,
  type RuntimeMode,
  type ServerProvider,
  type ThreadId,
  type UploadChatAttachment,
} from "@t3tools/contracts";
import type { TuiPaths } from "../cli/config.js";
import {
  buildExistingThreadTurnStart,
  buildNewThreadTurnStart,
  buildThreadInteractionModeSet,
  buildThreadMetaUpdate,
  buildThreadRuntimeModeSet,
  buildThreadApprovalResponse,
  buildThreadArchive,
  buildThreadSessionStop,
  buildThreadTurnInterrupt,
  buildThreadUnarchive,
  buildThreadUserInputResponse,
  canArchiveThread,
  canStopThreadSession,
} from "../domain/commands.js";
import type { TuiDebugEntry } from "../domain/debug.js";
import {
  buildFullThreadDiffInput,
  buildTurnDiffInput,
  diffCacheKey,
  sanitizeDiffText,
  type TuiDiffMode,
} from "../domain/diff.js";
import { deriveErrorBanners } from "../domain/errors.js";
import { TUI_ACTIONS, type TuiActionId } from "../domain/keybindings.js";
import {
  createConversationDisplayCache,
  displayProject,
  displayText,
  displayThread,
} from "../domain/display.js";
import {
  deriveProviderInstanceEntries,
  findProviderInstance,
  providerSelectable,
} from "../domain/providerInstances.js";
import {
  buildUserInputAnswers,
  derivePendingApprovals,
  derivePendingUserInputs,
} from "../domain/pendingActions.js";
import {
  canAppendComposerAttachment,
  canHandlePrintableShortcut,
  composerAttachmentLimitMessage,
  appendPaletteQuery,
  isPlainTextSequence,
  parseComposerAttachmentInput,
} from "./input.js";
import type { TuiServerStatusSnapshot } from "../state/serverConfigStore.js";
import type { TuiShellState } from "../state/orchestrationStore.js";
import type { ThreadDetailState } from "../state/threadDetailStore.js";
import { SafeMarkdown } from "../terminal/safeMarkdown.js";
import type { TuiTheme } from "../terminal/theme.js";
import { CommandPalette } from "../ui/CommandPalette.js";
import { ControlsPanel } from "../ui/ControlsPanel.js";
import { DebugPanel } from "../ui/DebugPanel.js";
import { DiffPanel } from "../ui/DiffPanel.js";
import { ErrorBanners } from "../ui/ErrorBanners.js";
import { KeyboardHelp } from "../ui/KeyboardHelp.js";
import { SettingsPanel } from "../ui/SettingsPanel.js";

const MAX_DIFF_CACHE_ENTRIES = 12;

type DraftControlContext = {
  readonly modelSelection?: ModelSelection;
  readonly runtimeMode?: RuntimeMode;
  readonly interactionMode?: ProviderInteractionMode;
};

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
  onDraftContextChange?: (
    projectId: ProjectId,
    context: {
      readonly modelSelection?: ModelSelection;
      readonly runtimeMode?: RuntimeMode;
      readonly interactionMode?: ProviderInteractionMode;
    },
  ) => void;
  onDraftAttachmentsChange?: (
    projectId: ProjectId,
    attachments: readonly UploadChatAttachment[],
  ) => void;
  onPromoteProjectDraft?: (projectId: ProjectId, threadId: ThreadId) => void;
  onSubmitCommand?: (command: ClientOrchestrationCommand) => Promise<unknown>;
  onReconnect?: () => Promise<unknown>;
  onRefreshProviders?: () => Promise<unknown>;
  onGetTurnDiff?: (input: OrchestrationGetTurnDiffInput) => Promise<OrchestrationGetTurnDiffResult>;
  onGetFullThreadDiff?: (
    input: OrchestrationGetFullThreadDiffInput,
  ) => Promise<OrchestrationGetFullThreadDiffResult>;
  onRefreshGitStatus?: (cwd: string) => Promise<GitStatusResult>;
  debugEntries?: readonly TuiDebugEntry[];
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
  const projectDraftContext = draftProjectId
    ? (shell.draftContextByProjectId[draftProjectId] ?? {})
    : {};
  const draftAttachments = draftProjectId
    ? (shell.draftAttachmentsByProjectId[draftProjectId] ?? [])
    : [];
  const [localDraft, setLocalDraft] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [visiblePanel, setVisiblePanel] = useState<
    null | "palette" | "help" | "diff" | "debug" | "settings"
  >(null);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteSelectedIndex, setPaletteSelectedIndex] = useState(0);
  const [diffState, setDiffState] = useState<{
    readonly loading: boolean;
    readonly title: string;
    readonly text: string;
    readonly error: string | null;
  }>({ loading: false, title: "Diff", text: "", error: null });
  const [diffCache, setDiffCache] = useState<Readonly<Record<string, string>>>({});
  const diffRequestRef = useRef(0);
  const activeDiffThreadIdRef = useRef<ThreadId | null>(null);
  const [gitStatus, setGitStatus] = useState<GitStatusResult | null>(null);
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const [customInputAnswers, setCustomInputAnswers] = useState<Readonly<Record<string, string>>>(
    {},
  );
  const [threadControlContextById, setThreadControlContextById] = useState<
    Readonly<Record<string, DraftControlContext>>
  >({});
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
  const threadControlContext = activeThreadHeader?.id
    ? (threadControlContextById[activeThreadHeader.id] ?? {})
    : {};
  const selectedControlContext = activeThreadHeader ? threadControlContext : projectDraftContext;
  const selectedModelSelection =
    selectedControlContext.modelSelection ??
    activeThreadHeader?.modelSelection ??
    activeProject?.defaultModelSelection ??
    null;
  const selectedRuntimeMode =
    selectedControlContext.runtimeMode ?? activeThreadHeader?.runtimeMode ?? DEFAULT_RUNTIME_MODE;
  const selectedInteractionMode =
    selectedControlContext.interactionMode ??
    activeThreadHeader?.interactionMode ??
    DEFAULT_PROVIDER_INTERACTION_MODE;
  const selectedProvider = findProvider(status.config?.providers ?? [], selectedModelSelection);
  const banners = deriveErrorBanners({ status, provider: selectedProvider });
  const paletteActions = useMemo(() => filterPaletteActions(paletteQuery), [paletteQuery]);
  activeDiffThreadIdRef.current = activeDetail?.id ?? null;

  useEffect(() => {
    diffRequestRef.current += 1;
    setDiffState({ loading: false, title: "Diff", text: "", error: null });
  }, [activeDetail?.id]);

  useEffect(() => {
    setActiveQuestionIndex(0);
    setCustomInputAnswers({});
    setSelectedInputOptions({});
  }, [activePendingUserInput?.requestId, activeThreadHeader?.id]);

  useEffect(() => {
    setPaletteSelectedIndex(0);
  }, [paletteQuery]);

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
    if (visiblePanel === "palette") {
      if (key.name === "escape") {
        setVisiblePanel(null);
        setPaletteQuery("");
        return;
      }
      if (key.name === "up") {
        setPaletteSelectedIndex((index) =>
          Math.max(0, Math.min(index - 1, paletteActions.length - 1)),
        );
        return;
      }
      if (key.name === "down") {
        setPaletteSelectedIndex((index) =>
          Math.max(0, Math.min(index + 1, paletteActions.length - 1)),
        );
        return;
      }
      if (key.name === "backspace") {
        setPaletteQuery((query) => query.slice(0, -1));
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        const action = paletteActions[paletteSelectedIndex];
        if (action) {
          setVisiblePanel(null);
          setPaletteQuery("");
          void performAction(action.id);
        }
        return;
      }
      if (isPlainTextSequence(key)) {
        setPaletteQuery((query) => appendPaletteQuery(query, key.sequence));
        return;
      }
    }
    if (activePendingUserInput && activeThreadHeader?.id) {
      const boundedQuestionIndex = Math.min(
        activeQuestionIndex,
        Math.max(activePendingUserInput.questions.length - 1, 0),
      );
      const activeQuestion = activePendingUserInput.questions[boundedQuestionIndex];
      const activeQuestionId = activeQuestion?.id;
      const activeCustomInputAnswer = activeQuestionId
        ? (customInputAnswers[activeQuestionId] ?? "")
        : "";
      if (key.name === "left") {
        setActiveQuestionIndex(Math.max(0, boundedQuestionIndex - 1));
        return;
      }
      if (key.name === "right") {
        setActiveQuestionIndex(
          Math.min(activePendingUserInput.questions.length - 1, boundedQuestionIndex + 1),
        );
        return;
      }
      if (/^[1-9]$/.test(key.name)) {
        toggleUserInputOption(Number(key.name) - 1, activeQuestion?.id);
        return;
      }
      if (key.name === "backspace") {
        if (activeQuestionId) {
          setCustomInputAnswers((existing) =>
            setCustomInputAnswer(existing, activeQuestionId, activeCustomInputAnswer.slice(0, -1)),
          );
        }
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        const answers = buildUserInputAnswers({
          pending: activePendingUserInput,
          selectedOptions: selectedInputOptions,
          customAnswers: customInputAnswers,
        });
        void props.onSubmitCommand?.(
          buildThreadUserInputResponse({
            threadId: activeThreadHeader.id,
            requestId: activePendingUserInput.requestId,
            answers,
          }),
        );
        setCustomInputAnswers({});
        setSelectedInputOptions({});
        return;
      }
      if (isPlainTextSequence(key)) {
        if (activeQuestionId) {
          setCustomInputAnswers((existing) =>
            setCustomInputAnswer(
              existing,
              activeQuestionId,
              activeCustomInputAnswer + key.sequence,
            ),
          );
        }
        return;
      }
    }
    if (
      key.name === "?" &&
      canHandlePrintableShortcut({ composerText, visiblePanel, keyName: key.name })
    ) {
      setVisiblePanel(visiblePanel === "help" ? null : "help");
      return;
    }
    if (key.ctrl && key.name === "p") {
      setVisiblePanel(visiblePanel === "palette" ? null : "palette");
      setPaletteQuery("");
      return;
    }
    if (key.ctrl && key.name === "d") {
      setVisiblePanel(visiblePanel === "debug" ? null : "debug");
      return;
    }
    if (
      key.name === "," &&
      canHandlePrintableShortcut({ composerText, visiblePanel, keyName: key.name })
    ) {
      setVisiblePanel(visiblePanel === "settings" ? null : "settings");
      return;
    }
    if (
      key.name === "d" &&
      canHandlePrintableShortcut({ composerText, visiblePanel, keyName: key.name })
    ) {
      setVisiblePanel(visiblePanel === "diff" ? null : "diff");
      return;
    }
    if (
      canHandlePrintableShortcut({ composerText, visiblePanel, keyName: key.name }) &&
      (key.name === "t" || key.name === "f")
    ) {
      void loadDiff(key.name === "t" ? "turn" : "full");
      return;
    }
    if (composerText.length === 0 && key.name === "R") {
      void performAction("connection.reconnect");
      return;
    }
    if (composerText.length === 0 && key.name === "p") {
      void performAction("providers.refresh");
      return;
    }
    if (composerText.length === 0 && key.name === "g") {
      void performAction("git.refresh");
      return;
    }
    if (composerText.length === 0 && key.name === "m") {
      void performAction("model.next");
      return;
    }
    if (composerText.length === 0 && key.name === "r") {
      void performAction("runtime.next");
      return;
    }
    if (composerText.length === 0 && key.name === "i") {
      void performAction("interaction.next");
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
    if (key.name === "q" && composerText.length === 0) {
      void performAction("turn.interrupt-or-exit");
      return;
    }
    if (composerText.length === 0 && key.name === "up") {
      void performAction("thread.previous");
      return;
    }
    if (composerText.length === 0 && key.name === "down") {
      void performAction("thread.next");
      return;
    }
    if (key.ctrl && key.name === "n") {
      void performAction("thread.new");
      return;
    }
    if (composerText.length === 0 && key.name === "s" && canStopThreadSession(activeThreadHeader)) {
      void performAction("thread.stop");
      return;
    }
    if (composerText.length === 0 && key.name === "a" && activeThreadHeader?.id) {
      void performAction("thread.archive-toggle");
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
    if (isPlainTextSequence(key)) {
      const image = parseComposerAttachmentInput(key.sequence, draftProjectId);
      if (image && draftProjectId) {
        if (!canAppendComposerAttachment(draftAttachments)) {
          setSubmitError(composerAttachmentLimitMessage());
          return;
        }
        setDraftAttachments([...draftAttachments, image.attachment]);
        setSubmitError(`Attached ${displayText(image.sourceLabel)}`);
        return;
      }
      updateDraft(composerText + key.sequence);
    }
  });

  function updateDraft(next: string) {
    setSubmitError(null);
    if (draftProjectId) props.onDraftChange?.(draftProjectId, next);
    else setLocalDraft(next);
  }

  function setProjectDraftContext(context: DraftControlContext) {
    if (draftProjectId) props.onDraftContextChange?.(draftProjectId, context);
  }

  function setThreadControlContext(threadId: ThreadId, context: DraftControlContext) {
    setThreadControlContextById((existing) => ({ ...existing, [threadId]: context }));
  }

  function setDraftAttachments(attachments: readonly UploadChatAttachment[]) {
    if (draftProjectId) props.onDraftAttachmentsChange?.(draftProjectId, attachments);
  }

  async function submit() {
    const text = composerText.trim();
    if (!text || !props.onSubmitCommand) return;
    try {
      if (activeThreadShell) {
        const commandInput = {
          thread: activeThreadShell,
          text,
          attachments: draftAttachments,
          runtimeMode: selectedRuntimeMode,
          interactionMode: selectedInteractionMode,
          ...(selectedModelSelection ? { modelSelection: selectedModelSelection } : {}),
        };
        await props.onSubmitCommand(buildExistingThreadTurnStart(commandInput));
      } else if (activeProject) {
        const command = buildNewThreadTurnStart({
          project: activeProject,
          text,
          attachments: draftAttachments,
          runtimeMode: selectedRuntimeMode,
          interactionMode: selectedInteractionMode,
          ...(selectedModelSelection ? { modelSelection: selectedModelSelection } : {}),
        });
        await props.onSubmitCommand(command);
        props.onPromoteProjectDraft?.(activeProject.id, command.threadId);
      } else {
        return;
      }
      if (draftProjectId) props.onDraftChange?.(draftProjectId, "");
      if (draftProjectId) setDraftAttachments([]);
      else setLocalDraft("");
    } catch (error) {
      setSubmitError(displayText(String(error)));
    }
  }

  async function performAction(actionId: TuiActionId) {
    switch (actionId) {
      case "palette.open":
        setVisiblePanel("palette");
        setPaletteQuery("");
        return;
      case "help.toggle":
        setVisiblePanel(visiblePanel === "help" ? null : "help");
        return;
      case "thread.new":
        props.onNewThread?.();
        return;
      case "message.send":
        await submit();
        return;
      case "turn.interrupt-or-exit":
        if (activeThreadHeader?.session?.status === "running" && activeThreadHeader.id) {
          await props.onSubmitCommand?.(
            buildThreadTurnInterrupt({
              threadId: activeThreadHeader.id,
              turnId: activeThreadHeader.session.activeTurnId,
            }),
          );
        } else {
          props.onRequestExit();
        }
        return;
      case "thread.next":
        props.onSelectNextThread?.(1);
        return;
      case "thread.previous":
        props.onSelectNextThread?.(-1);
        return;
      case "thread.archive-toggle":
        if (!activeThreadHeader?.id) return;
        if (activeThreadHeader.archivedAt) {
          await props.onSubmitCommand?.(buildThreadUnarchive({ threadId: activeThreadHeader.id }));
        } else if (canArchiveThread(activeThreadHeader)) {
          await props.onSubmitCommand?.(buildThreadArchive({ threadId: activeThreadHeader.id }));
        }
        return;
      case "thread.stop":
        if (activeThreadHeader?.id && canStopThreadSession(activeThreadHeader)) {
          await props.onSubmitCommand?.(
            buildThreadSessionStop({ threadId: activeThreadHeader.id }),
          );
        }
        return;
      case "diff.toggle":
        setVisiblePanel(visiblePanel === "diff" ? null : "diff");
        return;
      case "diff.turn":
        await loadDiff("turn");
        return;
      case "diff.full":
        await loadDiff("full");
        return;
      case "debug.toggle":
        setVisiblePanel(visiblePanel === "debug" ? null : "debug");
        return;
      case "settings.toggle":
        setVisiblePanel(visiblePanel === "settings" ? null : "settings");
        return;
      case "model.next":
        cycleModel();
        return;
      case "runtime.next":
        await setRuntimeMode(nextRuntimeMode(selectedRuntimeMode));
        return;
      case "interaction.next":
        await setInteractionMode(selectedInteractionMode === "default" ? "plan" : "default");
        return;
      case "connection.reconnect":
        await props.onReconnect?.();
        return;
      case "providers.refresh":
        await props.onRefreshProviders?.();
        return;
      case "git.refresh":
        await refreshGit();
        return;
    }
  }

  async function loadDiff(mode: TuiDiffMode) {
    if (!activeDetail) return;
    const turnInput = mode === "turn" ? buildTurnDiffInput(activeDetail) : null;
    const fullInput = mode === "full" ? buildFullThreadDiffInput(activeDetail) : null;
    const input = turnInput ?? fullInput;
    if (!input) {
      setDiffState({
        loading: false,
        title: "Diff",
        text: "",
        error: "No checkpoint diff is available yet.",
      });
      return;
    }
    const key = diffCacheKey(
      turnInput
        ? {
            threadId: activeDetail.id,
            mode,
            fromTurnCount: turnInput.fromTurnCount,
            toTurnCount: turnInput.toTurnCount,
          }
        : { threadId: activeDetail.id, mode, toTurnCount: fullInput!.toTurnCount },
    );
    const cached = diffCache[key];
    if (cached) {
      setDiffState({ loading: false, title: `${mode} diff`, text: cached, error: null });
      setVisiblePanel("diff");
      return;
    }
    setVisiblePanel("diff");
    setDiffState({ loading: true, title: `${mode} diff`, text: "", error: null });
    const requestId = (diffRequestRef.current += 1);
    const requestThreadId = activeDetail.id;
    try {
      const result = turnInput
        ? await props.onGetTurnDiff?.(turnInput)
        : await props.onGetFullThreadDiff?.(fullInput!);
      if (
        requestId !== diffRequestRef.current ||
        activeDiffThreadIdRef.current !== requestThreadId
      ) {
        return;
      }
      const text = sanitizeDiffText(result?.diff ?? "");
      setDiffCache((existing) => withBoundedDiffCache(existing, key, text));
      setDiffState({ loading: false, title: `${mode} diff`, text, error: null });
    } catch (error) {
      if (
        requestId !== diffRequestRef.current ||
        activeDiffThreadIdRef.current !== requestThreadId
      ) {
        return;
      }
      setDiffState({
        loading: false,
        title: `${mode} diff`,
        text: "",
        error: displayText(String(error)),
      });
    }
  }

  async function refreshGit() {
    const cwd =
      activeThreadHeader?.worktreePath ?? activeProject?.workspaceRoot ?? status.config?.cwd;
    if (!cwd) return;
    try {
      const next = await props.onRefreshGitStatus?.(cwd);
      if (next) setGitStatus(next);
    } catch (error) {
      setSubmitError(displayText(String(error)));
    }
  }

  function cycleModel() {
    if (!draftProjectId || !status.config?.providers.length) return;
    const models = deriveProviderInstanceEntries(status.config.providers).flatMap((entry) =>
      providerSelectable(entry.provider)
        ? entry.models.map((model) => ({
            instanceId: entry.instanceId,
            model: model.slug,
          }))
        : [],
    );
    if (models.length === 0) return;
    const index = models.findIndex(
      (entry) =>
        entry.instanceId === selectedModelSelection?.instanceId &&
        entry.model === selectedModelSelection?.model,
    );
    const next = models[(index + 1 + models.length) % models.length]!;
    if (activeThreadHeader?.id) {
      setThreadControlContext(activeThreadHeader.id, {
        ...threadControlContext,
        modelSelection: next as ModelSelection,
      });
      void props.onSubmitCommand?.(
        buildThreadMetaUpdate({
          threadId: activeThreadHeader.id,
          modelSelection: next as ModelSelection,
        }),
      );
    } else {
      setProjectDraftContext({ ...projectDraftContext, modelSelection: next as ModelSelection });
    }
  }

  async function setRuntimeMode(runtimeMode: RuntimeMode) {
    if (!draftProjectId) return;
    if (activeThreadHeader?.id) {
      setThreadControlContext(activeThreadHeader.id, { ...threadControlContext, runtimeMode });
      await props.onSubmitCommand?.(
        buildThreadRuntimeModeSet({ threadId: activeThreadHeader.id, runtimeMode }),
      );
    } else {
      setProjectDraftContext({ ...projectDraftContext, runtimeMode });
    }
  }

  async function setInteractionMode(interactionMode: ProviderInteractionMode) {
    if (!draftProjectId) return;
    if (activeThreadHeader?.id) {
      setThreadControlContext(activeThreadHeader.id, {
        ...threadControlContext,
        interactionMode,
      });
      await props.onSubmitCommand?.(
        buildThreadInteractionModeSet({ threadId: activeThreadHeader.id, interactionMode }),
      );
    } else {
      setProjectDraftContext({ ...projectDraftContext, interactionMode });
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
      <ErrorBanners banners={banners} theme={props.theme} />

      <box flexGrow={1} flexDirection={compact ? "column" : "row"}>
        <Sidebar shell={shell} compact={compact} theme={props.theme} />
        <box flexGrow={1} paddingLeft={2} paddingTop={1} paddingRight={2}>
          <ThreadHeader thread={activeThreadHeader} theme={props.theme} />
          <ControlsPanel
            provider={selectedProvider}
            modelSelection={selectedModelSelection}
            runtimeMode={selectedRuntimeMode}
            interactionMode={selectedInteractionMode}
            attachmentCount={draftAttachments.length}
            theme={props.theme}
          />
          {gitStatus ? (
            <text fg={props.theme.palette.muted}>
              {`git ${displayText(gitStatus.branch ?? "detached")} files ${gitStatus.workingTree.files.length} +${gitStatus.workingTree.insertions} -${gitStatus.workingTree.deletions}`}
            </text>
          ) : null}
          {visiblePanel === "palette" ? (
            <CommandPalette
              actions={paletteActions}
              query={paletteQuery}
              selectedIndex={paletteSelectedIndex}
              theme={props.theme}
            />
          ) : visiblePanel === "help" ? (
            <KeyboardHelp theme={props.theme} />
          ) : visiblePanel === "diff" ? (
            <DiffPanel
              title={diffState.title}
              text={diffState.text}
              loading={diffState.loading}
              error={diffState.error}
              theme={props.theme}
            />
          ) : visiblePanel === "debug" ? (
            <DebugPanel entries={props.debugEntries ?? []} theme={props.theme} />
          ) : visiblePanel === "settings" ? (
            <SettingsPanel config={status.config} theme={props.theme} />
          ) : null}
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
            questionIndex={activeQuestionIndex}
            customAnswers={customInputAnswers}
            selectedOptions={selectedInputOptions}
            theme={props.theme}
          />
        ) : null}
        <text
          fg={props.theme.palette.muted}
        >{`?/^p help/palette | ↑/↓ select | ^n new | d diff | ^d debug | m/r/i controls | a archive | s stop | enter send`}</text>
        <text fg={props.theme.palette.muted}>
          {compactConfigPath(displayText(props.paths.configDir))}
        </text>
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
  questionIndex: number;
  selectedOptions: Readonly<Record<string, readonly number[]>>;
  customAnswers: Readonly<Record<string, string>>;
  theme: TuiTheme;
}) {
  const questionIndex = Math.min(
    props.questionIndex,
    Math.max(props.pending.questions.length - 1, 0),
  );
  const question = props.pending.questions[questionIndex];
  if (!question) return null;
  const selected = props.selectedOptions[question.id] ?? [];
  const customAnswer = props.customAnswers[question.id] ?? "";
  return (
    <box flexDirection="column">
      <text fg={props.theme.palette.accent}>
        {`Question ${questionIndex + 1}/${props.pending.questions.length}: ${displayText(question.header)}`}
      </text>
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
      <text fg={props.theme.palette.muted}>{`custom: ${displayText(customAnswer)}`}</text>
      <text fg={props.theme.palette.muted}>
        left/right question | enter submits answered questions
      </text>
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

function findProvider(
  providers: readonly ServerProvider[],
  modelSelection: ModelSelection | null,
): ServerProvider | null {
  return findProviderInstance(providers, modelSelection?.instanceId);
}

function nextRuntimeMode(runtimeMode: RuntimeMode): RuntimeMode {
  const modes: readonly RuntimeMode[] = ["approval-required", "auto-accept-edits", "full-access"];
  const index = modes.indexOf(runtimeMode);
  return modes[(index + 1 + modes.length) % modes.length]!;
}

function filterPaletteActions(query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return TUI_ACTIONS;
  return TUI_ACTIONS.filter((action) =>
    `${action.label} ${action.description} ${action.group} ${action.id}`
      .toLowerCase()
      .includes(normalized),
  );
}

function compactConfigPath(path: string): string {
  const marker = "X1SHELL_TOKEN=[REDACTED]";
  const index = path.indexOf(marker);
  if (index < 0) return path;
  return `${marker}${path.slice(index + marker.length)}`;
}

function withBoundedDiffCache(
  existing: Readonly<Record<string, string>>,
  key: string,
  text: string,
): Readonly<Record<string, string>> {
  const next: Record<string, string> = { ...existing };
  delete next[key];
  next[key] = text;
  const overflow = Object.keys(next).length - MAX_DIFF_CACHE_ENTRIES;
  if (overflow <= 0) return next;
  for (const oldKey of Object.keys(next).slice(0, overflow)) {
    delete next[oldKey];
  }
  return next;
}

function setCustomInputAnswer(
  existing: Readonly<Record<string, string>>,
  questionId: string,
  answer: string,
): Readonly<Record<string, string>> {
  if (answer.length === 0) {
    const next: Record<string, string> = { ...existing };
    delete next[questionId];
    return next;
  }
  return { ...existing, [questionId]: answer };
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
  draftContextByProjectId: {},
  draftAttachmentsByProjectId: {},
  pendingDraftThreadIdByProjectId: {},
};
