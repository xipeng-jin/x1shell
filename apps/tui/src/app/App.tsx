import path from "node:path";
import { useKeyboard, usePaste, useTerminalDimensions } from "@opentui/solid";
import { batch, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js";
import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type ClientOrchestrationCommand,
  type FilesystemBrowseInput,
  type FilesystemBrowseResult,
  type ModelSelection,
  type OrchestrationGetFullThreadDiffInput,
  type OrchestrationGetFullThreadDiffResult,
  type OrchestrationGetTurnDiffInput,
  type OrchestrationGetTurnDiffResult,
  type OrchestrationProjectShell,
  type OrchestrationThread,
  type OrchestrationThreadShell,
  type ProviderInteractionMode,
  type ProjectId,
  type RuntimeMode,
  type ServerProvider,
  type ThreadId,
  type UploadChatAttachment,
  type VcsStatusResult,
} from "@t3tools/contracts";
import type { TextareaRenderable } from "@opentui/core";
import { inferProjectTitleFromPath } from "@t3tools/shared/projectPaths";
import type { TuiPaths } from "../cli/config.js";
import {
  buildExistingThreadTurnStart,
  buildProjectCreate,
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
  newProjectId,
} from "../domain/commands.js";
import type { TuiDebugEntry } from "../domain/debug.js";
import {
  buildFullThreadDiffInput,
  buildTurnDiffInput,
  diffCacheKey,
  sanitizeDiffText,
  type TuiDiffMode,
} from "../domain/diff.js";
import { deriveErrorBanners, type TuiErrorBanner } from "../domain/errors.js";
import { TUI_ACTIONS, type TuiActionId } from "../domain/keybindings.js";
import {
  CONVERSATION_TIMELINE_WINDOW,
  createConversationDisplayCache,
  displayProject,
  displayText,
  displayThread,
} from "../domain/display.js";
import {
  createDefaultTuiModelSelection,
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
  applyAddProjectBrowseBackspace,
  appendComposerText,
  appendAddProjectBrowseQuery,
  appendPaletteQuery,
  canAppendComposerAttachment,
  canHandlePrintableShortcut,
  composerAttachmentLimitMessage,
  isPlainTextSequence,
  parseComposerAttachmentInput,
} from "./input.js";
import { nextAddProjectPaletteIntent, type PaletteIntent } from "./paletteIntent.js";
import {
  buildActionPaletteView,
  buildAddProjectBrowsePaletteView,
  buildAddProjectSourcesPaletteView,
  buildThemePaletteView,
  initialAddProjectBrowseQuery,
  type TuiPaletteItem,
  type TuiPaletteMode,
} from "./paletteViewModel.js";
import {
  browseItemsForQuery,
  browseFilterQueryFromPath,
  browseItemValue,
  browseWindowStartForHighlight,
  browsePlatformFromEnvironmentOs,
  buildTuiFilesystemBrowseRequest,
  executeBrowseItem,
  filterBrowseEntries,
  filesystemBrowseRequestsEqual,
  filesystemBrowseResultForRequest,
  isPrimaryEnterModifier,
  moveBrowseHighlight,
  resolveBrowseSubmitPath,
  type TuiFilesystemBrowseSnapshot,
  type TuiBrowsePaletteItem,
} from "./filesystemBrowse.js";
import type { TuiServerStatusSnapshot } from "../state/serverConfigStore.js";
import type { TuiShellState } from "../state/orchestrationStore.js";
import type { ThreadDetailState } from "../state/threadDetailStore.js";
import { SafeMarkdown } from "../terminal/safeMarkdown.js";
import { resolveThemeId, TUI_THEME_OPTIONS, type TuiTheme } from "../terminal/theme.js";
import { CommandPalette } from "../ui/CommandPalette.js";
import { DebugPanel } from "../ui/DebugPanel.js";
import { DiffPanel } from "../ui/DiffPanel.js";
import { KeyboardHelp } from "../ui/KeyboardHelp.js";
import { SettingsPanel } from "../ui/SettingsPanel.js";
import { X1ShellLogo } from "../ui/landing/X1ShellLogo.js";
import { resolveX1ShellLandingLayout } from "../ui/landing/responsiveLayout.js";
import {
  findTuiProjectByPath,
  getLatestVisibleThreadForProject,
  resolveAddProjectSubmitPath,
} from "./addProjectSubmit.js";
import { resolveCommandPaletteFrame } from "./commandPaletteFrame.js";

const MAX_DIFF_CACHE_ENTRIES = 12;
const BROWSE_PALETTE_STATIC_ROW_COUNT = 7;
const THEME_PALETTE_STATIC_ROW_COUNT = 6;
const HEADER_THREAD_TITLE_MAX_LENGTH = 44;
const SIDEBAR_THREAD_TIMESTAMP_WIDTH = 4;
const SIDEBAR_TREE_INDENT_WIDTH = 1;
const SIDEBAR_ROW_HORIZONTAL_PADDING = 2;
const SIDEBAR_THREAD_STATUS_WIDTH = 2;
const SIDEBAR_THREAD_TIMESTAMP_GAP = 1;
const SIDEBAR_THREAD_LAYOUT_BUFFER = 1;
const SIDEBAR_THREAD_TITLE_WIDTH =
  34 -
  SIDEBAR_TREE_INDENT_WIDTH -
  SIDEBAR_ROW_HORIZONTAL_PADDING -
  SIDEBAR_THREAD_STATUS_WIDTH -
  SIDEBAR_THREAD_TIMESTAMP_GAP -
  SIDEBAR_THREAD_TIMESTAMP_WIDTH -
  SIDEBAR_THREAD_LAYOUT_BUFFER;
const COMPOSER_TEXTAREA_MIN_HEIGHT = 3;
const COMPOSER_TEXTAREA_MAX_HEIGHT = 8;
const COMPOSER_PENDING_TEXTAREA_MIN_HEIGHT = 2;
const EMPTY_BROWSE_ENTRIES: FilesystemBrowseResult["entries"] = [];
const PASTE_DECODER = new TextDecoder();

type LandingFocusArea = "projects" | "threads" | "timeline" | "composer" | "controls";
type DraftControlContext = {
  readonly modelSelection?: ModelSelection;
  readonly runtimeMode?: RuntimeMode;
  readonly interactionMode?: ProviderInteractionMode;
};

export function App(props: {
  interruptRequestToken: number;
  paths: TuiPaths;
  launchCwd: string;
  theme: TuiTheme;
  serverStatus?: TuiServerStatusSnapshot;
  shellState?: TuiShellState;
  threadDetailState?: ThreadDetailState;
  onSelectProject?: (projectId: ProjectId) => void;
  onSelectThread?: (threadId: ThreadId) => void;
  onSelectNextThread?: (direction: 1 | -1) => void;
  onCreateProjectDraft?: (projectId: ProjectId) => void;
  onCreatePendingProjectDraft?: (input: {
    readonly projectId: ProjectId;
    readonly workspaceRoot: string;
    readonly title: string;
  }) => void;
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
  onRefreshVcsStatus?: (cwd: string) => Promise<VcsStatusResult>;
  onBrowseFilesystem?: (input: FilesystemBrowseInput) => Promise<FilesystemBrowseResult>;
  debugEntries?: readonly TuiDebugEntry[];
  onPreviewTheme?: (themeId: string) => void;
  onCommitTheme?: (themeId: string) => Promise<unknown> | unknown;
  onCancelThemePreview?: () => void;
  onRequestExit: () => void;
}): JSX.Element {
  const dimensions = useTerminalDimensions();
  const [sidebarCollapsedPreference, setSidebarCollapsedPreference] = createSignal(false);
  const [sidebarOverlayOpen, setSidebarOverlayOpen] = createSignal(false);
  const [focusArea, setFocusArea] = createSignal<LandingFocusArea>("composer");
  const layout = createMemo(() =>
    resolveX1ShellLandingLayout({
      viewportColumns: dimensions().width,
      sidebarCollapsedPreference: sidebarCollapsedPreference(),
    }),
  );
  const status = createMemo(() => props.serverStatus ?? DEFAULT_STATUS);
  const shell = createMemo(() => props.shellState ?? DEFAULT_SHELL);
  const activeThreadShell = createMemo(() => {
    const snapshot = shell();
    return snapshot.selectedThreadId
      ? (snapshot.threads.find((thread) => thread.id === snapshot.selectedThreadId) ?? null)
      : null;
  });
  const activeProject = createMemo(() => {
    const snapshot = shell();
    return snapshot.selectedProjectId
      ? snapshot.projects.find((project) => project.id === snapshot.selectedProjectId)
      : snapshot.projects[0];
  });
  const pendingProjectDraft = createMemo(() => {
    const snapshot = shell();
    return snapshot.selectedProjectId && !activeProject()
      ? (snapshot.pendingProjectDraftByProjectId[snapshot.selectedProjectId] ?? null)
      : null;
  });
  const activeDetail = createMemo(() => {
    const snapshot = shell();
    return snapshot.selectedThreadId
      ? (props.threadDetailState?.entries[snapshot.selectedThreadId]?.thread ?? null)
      : null;
  });
  const activeThreadHeader = createMemo(() => activeThreadShell() ?? activeDetail());
  const draftProjectId = createMemo(
    () =>
      activeProject()?.id ?? activeThreadShell()?.projectId ?? shell().selectedProjectId ?? null,
  );
  const draftProjectTitle = createMemo(() => {
    const pending = pendingProjectDraft();
    const project = activeProject();
    if (pending) return displayText(pending.title);
    return project ? workspaceBasename(project.workspaceRoot) : workspaceBasename(props.launchCwd);
  });
  const draft = createMemo(() => {
    const projectId = draftProjectId();
    return projectId ? (shell().draftByProjectId[projectId] ?? "") : "";
  });
  const projectDraftContext = createMemo(() => {
    const projectId = draftProjectId();
    return projectId ? (shell().draftContextByProjectId[projectId] ?? {}) : {};
  });
  const draftAttachments = createMemo(() => {
    const projectId = draftProjectId();
    return projectId ? (shell().draftAttachmentsByProjectId[projectId] ?? []) : [];
  });
  const [localDraft, setLocalDraft] = createSignal("");
  const [submitError, setSubmitError] = createSignal<string | null>(null);
  const [visiblePanel, setVisiblePanel] = createSignal<
    null | "palette" | "help" | "diff" | "debug" | "settings"
  >(null);
  const [paletteMode, setPaletteMode] = createSignal<TuiPaletteMode>("actions");
  const [paletteIntent, setPaletteIntent] = createSignal<PaletteIntent | null>(null);
  const [paletteQuery, setPaletteQuery] = createSignal("");
  const [addProjectBrowseQuery, setAddProjectBrowseQuery] = createSignal("");
  const [addProjectBrowseSnapshot, setAddProjectBrowseSnapshot] =
    createSignal<TuiFilesystemBrowseSnapshot | null>(null);
  const [addProjectBrowseLoading, setAddProjectBrowseLoading] = createSignal(false);
  const [addProjectBrowseError, setAddProjectBrowseError] = createSignal<string | null>(null);
  const [addProjectBrowseHighlightedItemValue, setAddProjectBrowseHighlightedItemValue] =
    createSignal<string | null>(null);
  const [addProjectBrowseWindowStart, setAddProjectBrowseWindowStart] = createSignal(0);
  const [themePaletteWindowStart, setThemePaletteWindowStart] = createSignal(0);
  const [themeInitialId, setThemeInitialId] = createSignal<string | null>(null);
  const [themeConfirmed, setThemeConfirmed] = createSignal(false);
  const [themeCommitPending, setThemeCommitPending] = createSignal(false);
  const [themeCommitToken, setThemeCommitToken] = createSignal(0);
  const [paletteSelectedIndex, setPaletteSelectedIndex] = createSignal(0);
  const [diffState, setDiffState] = createSignal<{
    readonly loading: boolean;
    readonly title: string;
    readonly text: string;
    readonly error: string | null;
  }>({ loading: false, title: "Diff", text: "", error: null });
  const [diffCache, setDiffCache] = createSignal<Readonly<Record<string, string>>>({});
  const diffRequestRef = { current: 0 };
  const browseRequestRef = { current: 0 };
  const activeDiffThreadIdRef = { current: null as ThreadId | null };
  const [gitStatus, setGitStatus] = createSignal<VcsStatusResult | null>(null);
  const [activeQuestionIndex, setActiveQuestionIndex] = createSignal(0);
  const [customInputAnswers, setCustomInputAnswers] = createSignal<
    Readonly<Record<string, string>>
  >({});
  const [threadControlContextById, setThreadControlContextById] = createSignal<
    Readonly<Record<string, DraftControlContext>>
  >({});
  const [selectedInputOptions, setSelectedInputOptions] = createSignal<
    Record<string, readonly number[]>
  >({});
  const [expandedProjectIds, setExpandedProjectIds] = createSignal<ReadonlySet<string>>(
    new Set<string>(shell().selectedProjectId ? [String(shell().selectedProjectId)] : []),
  );
  const composerText = createMemo(() => (draftProjectId() ? draft() : localDraft()));
  const displayCache = createConversationDisplayCache({
    windowSize: CONVERSATION_TIMELINE_WINDOW,
  });
  const timeline = createMemo(() => displayCache.buildTimeline(activeDetail()));
  const pendingApprovals = createMemo(() =>
    derivePendingApprovals(activeDetail()?.activities ?? []),
  );
  const pendingUserInputs = createMemo(() =>
    derivePendingUserInputs(activeDetail()?.activities ?? []),
  );
  const activePendingApproval = createMemo(() =>
    (activeThreadShell()?.hasPendingApprovals ?? true) ? (pendingApprovals()[0] ?? null) : null,
  );
  const activePendingUserInput = createMemo(() =>
    (activeThreadShell()?.hasPendingUserInput ?? true) ? (pendingUserInputs()[0] ?? null) : null,
  );
  const threadControlContext = createMemo(() => {
    const thread = activeThreadHeader();
    return thread?.id ? (threadControlContextById()[thread.id] ?? {}) : {};
  });
  const selectedControlContext = createMemo(() =>
    activeThreadHeader() ? threadControlContext() : projectDraftContext(),
  );
  const defaultModelSelection: ModelSelection = createDefaultTuiModelSelection();
  const selectedModelSelection = createMemo(
    () =>
      selectedControlContext().modelSelection ??
      activeThreadHeader()?.modelSelection ??
      activeProject()?.defaultModelSelection ??
      defaultModelSelection,
  );
  const selectedRuntimeMode = createMemo(
    () =>
      selectedControlContext().runtimeMode ??
      activeThreadHeader()?.runtimeMode ??
      DEFAULT_RUNTIME_MODE,
  );
  const selectedInteractionMode = createMemo(
    () =>
      selectedControlContext().interactionMode ??
      activeThreadHeader()?.interactionMode ??
      DEFAULT_PROVIDER_INTERACTION_MODE,
  );
  const onBrowseFilesystem = props.onBrowseFilesystem;
  const currentAddProjectBrowsePlan = createMemo(() =>
    buildTuiFilesystemBrowseRequest({
      query: addProjectBrowseQuery(),
      platform: browsePlatformFromEnvironmentOs(status().config?.environment.platform.os ?? null),
      activeProjectWorkspaceRoot: activeProject()?.workspaceRoot ?? null,
    }),
  );
  const addProjectBrowseResult = createMemo(() =>
    filesystemBrowseResultForRequest({
      browsePlan: currentAddProjectBrowsePlan(),
      snapshot: addProjectBrowseSnapshot(),
    }),
  );
  const addProjectBrowseEntries = createMemo(
    () => addProjectBrowseResult()?.entries ?? EMPTY_BROWSE_ENTRIES,
  );
  const selectedProvider = createMemo(() =>
    findProvider(status().config?.providers ?? [], selectedModelSelection()),
  );
  const banners = createMemo(() =>
    deriveErrorBanners({ status: status(), provider: selectedProvider() }),
  );
  const paletteActions = createMemo(() => filterPaletteActions(paletteQuery()));
  const themePaletteOptions = createMemo(() => {
    const normalizedQuery = paletteQuery().trim().toLowerCase();
    if (!normalizedQuery) return TUI_THEME_OPTIONS;
    return TUI_THEME_OPTIONS.filter((theme) => theme.name.toLowerCase().includes(normalizedQuery));
  });
  const browseFilterQuery = createMemo(() => browseFilterQueryFromPath(addProjectBrowseQuery()));
  const browseFilteredEntries = createMemo(
    () =>
      filterBrowseEntries({
        browseEntries: addProjectBrowseEntries(),
        browseFilterQuery: browseFilterQuery(),
      }).filteredEntries,
  );
  const paletteFrame = createMemo(() =>
    resolveCommandPaletteFrame({
      viewportColumns: dimensions().width,
      viewportRows: dimensions().height,
    }),
  );
  const browsePaletteItems = createMemo(() =>
    browseItemsForQuery({ query: addProjectBrowseQuery(), entries: browseFilteredEntries() }),
  );
  const browseWindowSize = createMemo(() =>
    Math.max(
      1,
      Math.min(
        10,
        paletteFrame().height - BROWSE_PALETTE_STATIC_ROW_COUNT - (addProjectBrowseError() ? 1 : 0),
      ),
    ),
  );
  const visibleBrowseWindowStart = createMemo(() =>
    browseWindowStartForHighlight({
      items: browsePaletteItems(),
      highlightedItemValue: addProjectBrowseHighlightedItemValue(),
      currentStart: addProjectBrowseWindowStart(),
      windowSize: browseWindowSize(),
    }),
  );
  const visibleBrowsePaletteItems = createMemo(() =>
    browsePaletteItems().slice(
      visibleBrowseWindowStart(),
      visibleBrowseWindowStart() + browseWindowSize(),
    ),
  );
  const themePaletteWindowSize = createMemo(() =>
    Math.max(1, Math.min(12, paletteFrame().height - THEME_PALETTE_STATIC_ROW_COUNT)),
  );
  const visibleThemePaletteOptions = createMemo(() =>
    themePaletteOptions().slice(
      themePaletteWindowStart(),
      themePaletteWindowStart() + themePaletteWindowSize(),
    ),
  );
  const paletteView = createMemo(() => {
    if (paletteMode() === "add-project-sources") return buildAddProjectSourcesPaletteView();
    if (paletteMode() === "add-project-browse") {
      return buildAddProjectBrowsePaletteView({
        query: addProjectBrowseQuery(),
        items: visibleBrowsePaletteItems(),
        loading: addProjectBrowseLoading(),
        error: addProjectBrowseError(),
      });
    }
    if (paletteMode() === "themes") {
      return buildThemePaletteView({
        themes: visibleThemePaletteOptions(),
        selectedThemeId: themeInitialId() ?? props.theme.id,
        query: paletteQuery(),
      });
    }
    return buildActionPaletteView({ actions: paletteActions(), query: paletteQuery() });
  });

  createEffect(() => {
    const selectedProjectId = shell().selectedProjectId ?? activeProject()?.id;
    if (!selectedProjectId) return;
    setExpandedProjectIds((existing) => {
      if (existing.has(selectedProjectId)) return existing;
      return new Set([...existing, selectedProjectId]);
    });
  });

  createEffect((previousThreadId: ThreadId | null | undefined) => {
    const threadId = activeDetail()?.id ?? null;
    activeDiffThreadIdRef.current = threadId;
    if (previousThreadId === undefined || previousThreadId === threadId) return threadId;
    diffRequestRef.current += 1;
    setDiffState({ loading: false, title: "Diff", text: "", error: null });
    return threadId;
  });

  createEffect((previousKey: string | undefined) => {
    const key = `${activePendingUserInput()?.requestId ?? ""}:${activeThreadHeader()?.id ?? ""}`;
    if (previousKey === undefined || previousKey === key) return key;
    setActiveQuestionIndex(0);
    setCustomInputAnswers({});
    setSelectedInputOptions({});
    return key;
  });

  createEffect((previousQuery: string | undefined) => {
    const query = paletteQuery();
    if (previousQuery === undefined || previousQuery === query) return query;
    if (paletteMode() === "themes") {
      const first = themePaletteOptions()[0];
      if (query.length === 0) {
        const restoredId = resolveThemeId(themeInitialId() ?? props.theme.id);
        const restoredIndex = Math.max(
          0,
          themePaletteOptions().findIndex((theme) => theme.id === restoredId),
        );
        moveThemeHighlightTo(restoredIndex);
        props.onPreviewTheme?.(restoredId);
      } else if (first) {
        setThemePaletteWindowStart(0);
        setPaletteSelectedIndex(0);
        props.onPreviewTheme?.(first.id);
      }
      return query;
    }
    setPaletteSelectedIndex(0);
    return query;
  });

  createEffect((previousQuery: string | undefined) => {
    const query = addProjectBrowseQuery();
    if (previousQuery === undefined || previousQuery === query) return query;
    setAddProjectBrowseHighlightedItemValue(null);
    setAddProjectBrowseWindowStart(0);
    return query;
  });

  createEffect(() => {
    if (paletteIntent()?.kind !== "add-project") return;
    setPaletteIntent(null);
    setPaletteMode("add-project-sources");
    setPaletteQuery("");
    setAddProjectBrowseQuery("");
    setAddProjectBrowseSnapshot(null);
    setAddProjectBrowseLoading(false);
    setAddProjectBrowseError(null);
    setAddProjectBrowseHighlightedItemValue(null);
    setAddProjectBrowseWindowStart(0);
    setPaletteSelectedIndex(0);
  });

  createEffect(() => {
    browseRequestRef.current += 1;
    const requestId = browseRequestRef.current;

    if (visiblePanel() !== "palette" || paletteMode() !== "add-project-browse") {
      setAddProjectBrowseSnapshot(null);
      setAddProjectBrowseLoading(false);
      setAddProjectBrowseError(null);
      return;
    }

    const browsePlan = currentAddProjectBrowsePlan();

    if (browsePlan.kind === "skip") {
      setAddProjectBrowseSnapshot(null);
      setAddProjectBrowseLoading(false);
      setAddProjectBrowseError(null);
      return;
    }

    if (browsePlan.kind === "error") {
      setAddProjectBrowseSnapshot(null);
      setAddProjectBrowseLoading(false);
      setAddProjectBrowseError(displayText(browsePlan.message));
      return;
    }

    if (!onBrowseFilesystem) {
      setAddProjectBrowseSnapshot(null);
      setAddProjectBrowseLoading(false);
      setAddProjectBrowseError(displayText("Not connected."));
      return;
    }

    setAddProjectBrowseSnapshot((snapshot) =>
      snapshot && filesystemBrowseRequestsEqual(snapshot.request, browsePlan.request)
        ? snapshot
        : null,
    );
    setAddProjectBrowseLoading(true);
    setAddProjectBrowseError(null);
    const timer = setTimeout(() => {
      void onBrowseFilesystem(browsePlan.request).then(
        (result) => {
          if (browseRequestRef.current !== requestId) return;
          setAddProjectBrowseSnapshot({ request: browsePlan.request, result });
          setAddProjectBrowseLoading(false);
          setAddProjectBrowseError(null);
        },
        (error) => {
          if (browseRequestRef.current !== requestId) return;
          setAddProjectBrowseSnapshot(null);
          setAddProjectBrowseLoading(false);
          setAddProjectBrowseError(displayText(String(error)));
        },
      );
    }, 80);

    onCleanup(() => clearTimeout(timer));
  });

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      const activeThread = activeThreadHeader();
      if (activeThread?.session?.status === "running" && activeThread.id) {
        const turnId = activeThread.session.activeTurnId;
        runAsyncAction(() =>
          props.onSubmitCommand?.(
            buildThreadTurnInterrupt({
              threadId: activeThread.id,
              turnId,
            }),
          ),
        );
      } else {
        props.onRequestExit();
      }
      return;
    }
    if (visiblePanel() === "palette") {
      if (isThemeCommitBlocking()) return;
      if (key.name === "escape") {
        closePalette();
        return;
      }
      if (paletteMode() === "add-project-sources") {
        if (key.name === "up" || key.name === "down") {
          setPaletteSelectedIndex(0);
          return;
        }
        if (key.name === "return" || key.name === "enter") {
          handlePaletteItem(paletteView().items[paletteSelectedIndex()]);
          return;
        }
        if (key.ctrl && key.name === "p") {
          openCommandPaletteActions();
          return;
        }
        if (key.name === "tab" || key.name === "backspace") {
          return;
        }
        return;
      }
      if (paletteMode() === "add-project-browse") {
        if (key.ctrl && key.name === "p") {
          openCommandPaletteActions();
          return;
        }
        if (key.name === "tab") {
          return;
        }
        if (key.name === "up" || key.name === "down") {
          const direction = key.name === "down" ? 1 : -1;
          const nextValue = moveBrowseHighlight({
            items: browsePaletteItems(),
            highlightedItemValue: addProjectBrowseHighlightedItemValue(),
            direction,
          });
          setAddProjectBrowseHighlightedItemValue(nextValue);
          setAddProjectBrowseWindowStart((currentStart) =>
            browseWindowStartForHighlight({
              items: browsePaletteItems(),
              highlightedItemValue: nextValue,
              currentStart,
              windowSize: browseWindowSize(),
            }),
          );
          return;
        }
        if (key.name === "backspace") {
          const nextBackspaceState = applyAddProjectBrowseBackspace(addProjectBrowseQuery());
          if (nextBackspaceState.kind === "sources") {
            setPaletteMode("add-project-sources");
            setPaletteSelectedIndex(0);
            setAddProjectBrowseQuery("");
            setAddProjectBrowseHighlightedItemValue(null);
            setAddProjectBrowseWindowStart(0);
          } else {
            setAddProjectBrowseHighlightedItemValue(null);
            setAddProjectBrowseWindowStart(0);
            setAddProjectBrowseQuery(nextBackspaceState.query);
          }
          return;
        }
        if (key.name === "return" || key.name === "enter") {
          const highlightedItem = findBrowsePaletteItem(
            browsePaletteItems(),
            addProjectBrowseHighlightedItemValue(),
          );
          if (highlightedItem && !isPrimaryEnterModifier({ key })) {
            handleBrowseItem(highlightedItem);
            return;
          }
          runAsyncAction(() => submitAddProjectBrowsePath(), setAddProjectBrowseError);
          return;
        }
        if (isPlainTextSequence(key)) {
          setAddProjectBrowseHighlightedItemValue(null);
          setAddProjectBrowseWindowStart(0);
          setAddProjectBrowseQuery((query) => appendAddProjectBrowseQuery(query, key.sequence));
          return;
        }
        return;
      }
      if (paletteMode() === "themes") {
        if (key.ctrl && key.name === "p") {
          cancelThemePalette();
          openCommandPaletteActions();
          return;
        }
        if (key.name === "up" || key.name === "down") {
          moveThemeHighlight(key.name === "down" ? 1 : -1);
          return;
        }
        if (key.name === "pageup") {
          moveThemeHighlight(-10);
          return;
        }
        if (key.name === "pagedown") {
          moveThemeHighlight(10);
          return;
        }
        if (key.name === "home") {
          moveThemeHighlightTo(0);
          return;
        }
        if (key.name === "end") {
          moveThemeHighlightTo(themePaletteOptions().length - 1);
          return;
        }
        if (key.name === "backspace") {
          setPaletteQuery((query) => query.slice(0, -1));
          return;
        }
        if (key.name === "return" || key.name === "enter") {
          const item = paletteView().items[paletteSelectedIndex()];
          if (item?.kind === "theme" && !themeCommitPending()) {
            runAsyncAction(() => confirmThemeSelection(item.id));
          }
          return;
        }
        if (isPlainTextSequence(key)) {
          setPaletteQuery((query) => appendPaletteQuery(query, key.sequence));
          return;
        }
        return;
      }
      if (key.name === "up") {
        setPaletteSelectedIndex((index) =>
          Math.max(0, Math.min(index - 1, paletteActions().length - 1)),
        );
        return;
      }
      if (key.name === "down") {
        setPaletteSelectedIndex((index) =>
          Math.max(0, Math.min(index + 1, paletteActions().length - 1)),
        );
        return;
      }
      if (key.name === "backspace") {
        setPaletteQuery((query) => query.slice(0, -1));
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        const action = paletteActions()[paletteSelectedIndex()];
        if (action) {
          setVisiblePanel(null);
          setPaletteQuery("");
          runAsyncAction(() => performAction(action.id));
        }
        return;
      }
      if (isPlainTextSequence(key)) {
        setPaletteQuery((query) => appendPaletteQuery(query, key.sequence));
        return;
      }
    }
    const pendingInput = activePendingUserInput();
    const inputThread = activeThreadHeader();
    if (pendingInput && inputThread?.id) {
      const boundedQuestionIndex = Math.min(
        activeQuestionIndex(),
        Math.max(pendingInput.questions.length - 1, 0),
      );
      const activeQuestion = pendingInput.questions[boundedQuestionIndex];
      const activeQuestionId = activeQuestion?.id;
      const activeCustomInputAnswer = activeQuestionId
        ? (customInputAnswers()[activeQuestionId] ?? "")
        : "";
      if (key.name === "left") {
        setActiveQuestionIndex(Math.max(0, boundedQuestionIndex - 1));
        return;
      }
      if (key.name === "right") {
        setActiveQuestionIndex(
          Math.min(pendingInput.questions.length - 1, boundedQuestionIndex + 1),
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
          pending: pendingInput,
          selectedOptions: selectedInputOptions(),
          customAnswers: customInputAnswers(),
        });
        runAsyncAction(() =>
          props.onSubmitCommand?.(
            buildThreadUserInputResponse({
              threadId: inputThread.id,
              requestId: pendingInput.requestId,
              answers,
            }),
          ),
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
      canHandlePrintableShortcut({
        composerText: composerText(),
        visiblePanel: visiblePanel(),
        keyName: key.name,
      })
    ) {
      setVisiblePanel(visiblePanel() === "help" ? null : "help");
      return;
    }
    if (key.ctrl && key.name === "p") {
      openCommandPaletteActions();
      return;
    }
    if (key.ctrl && key.name === "b") {
      if (layout().sidebarForcedCollapsed) {
        setSidebarOverlayOpen((current) => !current);
      } else {
        setSidebarCollapsedPreference((current) => !current);
      }
      return;
    }
    if (key.ctrl && key.name === "d") {
      setVisiblePanel(visiblePanel() === "debug" ? null : "debug");
      setFocusArea("timeline");
      return;
    }
    if (key.name === "tab") {
      setFocusArea((current) =>
        nextFocusArea(current, layout().showSidebar || sidebarOverlayOpen()),
      );
      return;
    }
    if (composerText().length === 0 && focusArea() === "projects" && key.name === "up") {
      selectAdjacentProject(-1);
      return;
    }
    if (composerText().length === 0 && focusArea() === "projects" && key.name === "down") {
      selectAdjacentProject(1);
      return;
    }
    if (composerText().length === 0 && focusArea() === "threads" && key.name === "up") {
      selectAdjacentVisibleThread(-1);
      return;
    }
    if (composerText().length === 0 && focusArea() === "threads" && key.name === "down") {
      selectAdjacentVisibleThread(1);
      return;
    }
    if (
      key.name === "," &&
      canHandlePrintableShortcut({
        composerText: composerText(),
        visiblePanel: visiblePanel(),
        keyName: key.name,
      })
    ) {
      setVisiblePanel(visiblePanel() === "settings" ? null : "settings");
      setFocusArea("timeline");
      return;
    }
    if (
      key.name === "d" &&
      canHandlePrintableShortcut({
        composerText: composerText(),
        visiblePanel: visiblePanel(),
        keyName: key.name,
      })
    ) {
      setVisiblePanel(visiblePanel() === "diff" ? null : "diff");
      setFocusArea("timeline");
      return;
    }
    if (
      canHandlePrintableShortcut({
        composerText: composerText(),
        visiblePanel: visiblePanel(),
        keyName: key.name,
      }) &&
      (key.name === "t" || key.name === "f")
    ) {
      void loadDiff(key.name === "t" ? "turn" : "full");
      return;
    }
    if (composerText().length === 0 && key.name === "R") {
      runAsyncAction(() => performAction("connection.reconnect"));
      return;
    }
    if (composerText().length === 0 && key.name === "p") {
      runAsyncAction(() => performAction("providers.refresh"));
      return;
    }
    if (composerText().length === 0 && key.name === "g") {
      runAsyncAction(() => performAction("vcs.refresh"));
      return;
    }
    if (composerText().length === 0 && key.name === "m") {
      runAsyncAction(() => performAction("model.next"));
      return;
    }
    if (composerText().length === 0 && key.name === "r") {
      runAsyncAction(() => performAction("runtime.next"));
      return;
    }
    if (composerText().length === 0 && key.name === "i") {
      runAsyncAction(() => performAction("interaction.next"));
      return;
    }
    if (activePendingApproval() && activeThreadHeader()?.id && composerText().length === 0) {
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
        const thread = activeThreadHeader();
        if (!thread?.id) return;
        runAsyncAction(() =>
          props.onSubmitCommand?.(
            buildThreadApprovalResponse({
              threadId: thread.id,
              requestId: activePendingApproval()!.requestId,
              decision,
            }),
          ),
        );
        return;
      }
    }
    if (key.name === "q" && composerText().length === 0) {
      runAsyncAction(() => performAction("turn.interrupt-or-exit"));
      return;
    }
    if (composerText().length === 0 && key.name === "up") {
      runAsyncAction(() => performAction("thread.previous"));
      return;
    }
    if (composerText().length === 0 && key.name === "down") {
      runAsyncAction(() => performAction("thread.next"));
      return;
    }
    if (key.ctrl && key.name === "n") {
      runAsyncAction(() => performAction("thread.new"));
      return;
    }
    if (
      composerText().length === 0 &&
      key.name === "s" &&
      canStopThreadSession(activeThreadHeader())
    ) {
      runAsyncAction(() => performAction("thread.stop"));
      return;
    }
    if (composerText().length === 0 && key.name === "a" && activeThreadHeader()?.id) {
      runAsyncAction(() => performAction("thread.archive-toggle"));
      return;
    }
    if (key.name === "backspace") {
      updateDraft(composerText().slice(0, -1));
      return;
    }
    if (key.name === "return" || key.name === "enter") {
      runAsyncAction(() => submit());
      return;
    }
    if (isPlainTextSequence(key)) {
      const image = parseComposerAttachmentInput(key.sequence, draftProjectId());
      if (image && draftProjectId()) {
        if (!canAppendComposerAttachment(draftAttachments())) {
          setSubmitError(composerAttachmentLimitMessage());
          return;
        }
        setDraftAttachments([...draftAttachments(), image.attachment]);
        setSubmitError(`Attached ${displayText(image.sourceLabel)}`);
        return;
      }
      updateDraft(composerText() + key.sequence);
    }
  });

  usePaste((event) => {
    event.preventDefault();
    handlePastedText(PASTE_DECODER.decode(event.bytes));
  });

  function handlePastedText(text: string): void {
    if (text.length === 0) return;
    if (visiblePanel() === "palette") {
      if (paletteMode() === "add-project-browse") {
        setAddProjectBrowseHighlightedItemValue(null);
        setAddProjectBrowseWindowStart(0);
        setAddProjectBrowseQuery((query) => appendAddProjectBrowseQuery(query, text));
      } else if (paletteMode() === "themes") {
        if (themeCommitPending()) return;
        setPaletteQuery((query) => appendPaletteQuery(query, text));
      } else if (paletteMode() === "actions") {
        setPaletteQuery((query) => appendPaletteQuery(query, text));
      }
      return;
    }

    const pendingInput = activePendingUserInput();
    const inputThread = activeThreadHeader();
    if (pendingInput && inputThread?.id) {
      const boundedQuestionIndex = Math.min(
        activeQuestionIndex(),
        Math.max(pendingInput.questions.length - 1, 0),
      );
      const activeQuestionId = pendingInput.questions[boundedQuestionIndex]?.id;
      if (activeQuestionId) {
        setCustomInputAnswers((existing) =>
          setCustomInputAnswer(
            existing,
            activeQuestionId,
            appendComposerText(existing[activeQuestionId] ?? "", text),
          ),
        );
      }
      return;
    }

    const image = parseComposerAttachmentInput(text, draftProjectId());
    if (image && draftProjectId()) {
      if (!canAppendComposerAttachment(draftAttachments())) {
        setSubmitError(composerAttachmentLimitMessage());
        return;
      }
      setDraftAttachments([...draftAttachments(), image.attachment]);
      setSubmitError(`Attached ${displayText(image.sourceLabel)}`);
      return;
    }

    updateDraft(appendComposerText(composerText(), text));
  }

  function updateDraft(next: string) {
    setSubmitError(null);
    const projectId = draftProjectId();
    if (projectId) props.onDraftChange?.(projectId, next);
    else setLocalDraft(next);
  }

  function setProjectDraftContext(context: DraftControlContext) {
    const projectId = draftProjectId();
    if (projectId) props.onDraftContextChange?.(projectId, context);
  }

  function setThreadControlContext(threadId: ThreadId, context: DraftControlContext) {
    setThreadControlContextById((existing) => ({ ...existing, [threadId]: context }));
  }

  function setDraftAttachments(attachments: readonly UploadChatAttachment[]) {
    const projectId = draftProjectId();
    if (projectId) props.onDraftAttachmentsChange?.(projectId, attachments);
  }

  function runAsyncAction(
    action: () => Promise<unknown> | unknown,
    onError: (message: string) => void = setSubmitError,
  ): void {
    try {
      const result = action();
      if (result && typeof (result as Promise<unknown>).then === "function") {
        void (result as Promise<unknown>).catch((error: unknown) => {
          onError(displayText(String(error)));
        });
      }
    } catch (error) {
      onError(displayText(String(error)));
    }
  }

  function closePalette(): void {
    if (isThemeCommitBlocking()) return;
    if (paletteMode() === "themes") cancelThemePalette();
    setVisiblePanel(null);
    setPaletteIntent(null);
    setPaletteMode("actions");
    setPaletteQuery("");
    setAddProjectBrowseQuery("");
    setAddProjectBrowseSnapshot(null);
    setAddProjectBrowseLoading(false);
    setAddProjectBrowseError(null);
    setAddProjectBrowseHighlightedItemValue(null);
    setAddProjectBrowseWindowStart(0);
    setThemePaletteWindowStart(0);
    setThemeInitialId(null);
    setThemeConfirmed(false);
    setPaletteSelectedIndex(0);
  }

  function openCommandPaletteActions(): void {
    if (isThemeCommitBlocking()) return;
    setSidebarOverlayOpen(false);
    setPaletteIntent(null);
    setPaletteMode("actions");
    setPaletteQuery("");
    setAddProjectBrowseQuery("");
    setAddProjectBrowseSnapshot(null);
    setAddProjectBrowseLoading(false);
    setAddProjectBrowseError(null);
    setAddProjectBrowseHighlightedItemValue(null);
    setAddProjectBrowseWindowStart(0);
    setThemePaletteWindowStart(0);
    setThemeInitialId(null);
    setThemeConfirmed(false);
    setPaletteSelectedIndex(0);
    setVisiblePanel("palette");
  }

  function openThemePalette(): void {
    if (isThemeCommitBlocking()) return;
    setSidebarOverlayOpen(false);
    const currentId = resolveThemeId(props.theme.id);
    const selectedAbsoluteIndex = Math.max(
      0,
      TUI_THEME_OPTIONS.findIndex((theme) => theme.id === currentId),
    );
    const nextWindowStart = Math.min(
      selectedAbsoluteIndex,
      Math.max(0, TUI_THEME_OPTIONS.length - themePaletteWindowSize()),
    );
    batch(() => {
      setPaletteIntent(null);
      setPaletteMode("themes");
      setPaletteQuery("");
      setAddProjectBrowseQuery("");
      setAddProjectBrowseSnapshot(null);
      setAddProjectBrowseLoading(false);
      setAddProjectBrowseError(null);
      setAddProjectBrowseHighlightedItemValue(null);
      setAddProjectBrowseWindowStart(0);
      setThemePaletteWindowStart(nextWindowStart);
      setThemeInitialId(currentId);
      setThemeConfirmed(false);
      setPaletteSelectedIndex(selectedAbsoluteIndex - nextWindowStart);
      setVisiblePanel("palette");
    });
  }

  function openAddProjectPalette(): void {
    if (isThemeCommitBlocking()) return;
    setFocusArea("timeline");
    setSidebarOverlayOpen(false);
    setVisiblePanel("palette");
    setPaletteIntent((intent) => nextAddProjectPaletteIntent(intent));
  }

  function handlePaletteItem(item: TuiPaletteItem | undefined): void {
    if (isThemeCommitBlocking()) return;
    if (!item) return;
    if (item.kind === "add-project-source" && item.source === "local") {
      setPaletteMode("add-project-browse");
      setAddProjectBrowseQuery(
        initialAddProjectBrowseQuery({
          addProjectBaseDirectory: status().config?.settings.addProjectBaseDirectory ?? null,
        }),
      );
      setAddProjectBrowseSnapshot(null);
      setAddProjectBrowseLoading(false);
      setAddProjectBrowseError(null);
      setAddProjectBrowseHighlightedItemValue(null);
      setAddProjectBrowseWindowStart(0);
      setPaletteSelectedIndex(0);
      return;
    }
    if (item.kind === "action") {
      if (item.id === "theme.switch") {
        openThemePalette();
        return;
      }
      setVisiblePanel(null);
      setPaletteQuery("");
      runAsyncAction(() => performAction(item.id));
    }
    if (item.kind === "browse-directory" || item.kind === "browse-up") {
      handleBrowseItem(item);
    }
    if (item.kind === "theme") {
      if (themeCommitPending()) return;
      runAsyncAction(() => confirmThemeSelection(item.id));
    }
  }

  function handlePaletteHighlight(item: TuiPaletteItem | undefined): void {
    if (isThemeCommitBlocking()) return;
    if (!item) return;
    if (item.kind === "browse-directory" || item.kind === "browse-up") {
      setAddProjectBrowseHighlightedItemValue(browseItemValue(item));
      return;
    }
    if (item.kind === "theme") {
      const index = themePaletteOptions().findIndex((theme) => theme.id === item.id);
      if (index >= 0) {
        setPaletteSelectedIndex(index - themePaletteWindowStart());
      }
      props.onPreviewTheme?.(item.id);
      return;
    }
    if (item.kind === "action") {
      const index = paletteView().items.findIndex(
        (candidate) => candidate.kind === "action" && candidate.id === item.id,
      );
      if (index >= 0) setPaletteSelectedIndex(index);
    }
  }

  function moveThemeHighlight(direction: number): void {
    if (themePaletteOptions().length === 0) return;
    moveThemeHighlightTo(themePaletteWindowStart() + paletteSelectedIndex() + direction);
  }

  function moveThemeHighlightTo(index: number): void {
    const options = themePaletteOptions();
    if (options.length === 0) return;
    const nextIndex = Math.max(0, Math.min(index, options.length - 1));
    const minVisibleIndex = themePaletteWindowStart();
    const maxVisibleIndex = themePaletteWindowStart() + themePaletteWindowSize() - 1;
    const nextWindowStart =
      nextIndex < minVisibleIndex
        ? nextIndex
        : nextIndex > maxVisibleIndex
          ? nextIndex - themePaletteWindowSize() + 1
          : themePaletteWindowStart();
    setThemePaletteWindowStart(nextWindowStart);
    setPaletteSelectedIndex(nextIndex - nextWindowStart);
    const item = options[nextIndex];
    if (item) props.onPreviewTheme?.(item.id);
  }

  function cancelThemePalette(): void {
    if (!themeConfirmed()) props.onCancelThemePreview?.();
    setThemeInitialId(null);
    setThemeConfirmed(false);
  }

  async function confirmThemeSelection(themeId: string): Promise<void> {
    if (themeCommitPending()) return;
    setThemeCommitPending(true);
    const token = themeCommitToken() + 1;
    setThemeCommitToken(token);
    props.onPreviewTheme?.(themeId);
    try {
      await props.onCommitTheme?.(themeId);
      if (themeCommitToken() !== token) return;
      setThemeConfirmed(true);
      setVisiblePanel(null);
      setPaletteMode("actions");
      setPaletteQuery("");
      setThemePaletteWindowStart(0);
      setThemeInitialId(null);
    } catch (error) {
      if (themeCommitToken() === token) {
        props.onCancelThemePreview?.();
        setThemeConfirmed(false);
        setSubmitError(displayText(String(error)));
      }
      throw error;
    } finally {
      if (themeCommitToken() === token) setThemeCommitPending(false);
    }
  }

  function isThemeCommitBlocking(): boolean {
    return visiblePanel() === "palette" && paletteMode() === "themes" && themeCommitPending();
  }

  function handleBrowseItem(item: TuiBrowsePaletteItem): void {
    const nextQuery = executeBrowseItem({ query: addProjectBrowseQuery(), item });
    if (nextQuery === null) return;
    setAddProjectBrowseQuery(nextQuery);
    setAddProjectBrowseSnapshot(null);
    setAddProjectBrowseLoading(false);
    setAddProjectBrowseError(null);
    setAddProjectBrowseHighlightedItemValue(null);
    setAddProjectBrowseWindowStart(0);
  }

  async function submitAddProjectBrowsePath(): Promise<void> {
    const browsePlan = currentAddProjectBrowsePlan();
    if (browsePlan.kind === "skip") return;
    if (browsePlan.kind === "error") {
      setAddProjectBrowseError(displayText(browsePlan.message));
      return;
    }

    const resolvedPath = resolveBrowseSubmitPath({
      query: addProjectBrowseQuery(),
      browseResult: addProjectBrowseResult(),
      filteredEntries: browseFilteredEntries(),
      currentProjectWorkspaceRoot: activeProject()?.workspaceRoot ?? null,
    });
    const submitPath = resolveAddProjectSubmitPath({
      rawPath: resolvedPath,
      platform: browsePlatformFromEnvironmentOs(status().config?.environment.platform.os ?? null),
      currentProjectWorkspaceRoot: activeProject()?.workspaceRoot ?? null,
    });
    if (submitPath.kind === "empty") return;
    if (submitPath.kind === "error") {
      setAddProjectBrowseError(displayText(submitPath.message));
      return;
    }

    const cwd = submitPath.cwd;
    const existingProject = findTuiProjectByPath(shell().projects, cwd);
    if (existingProject) {
      const latestThread = getLatestVisibleThreadForProject(shell().threads, existingProject.id);
      if (latestThread) {
        props.onSelectThread?.(latestThread.id);
      } else {
        props.onCreateProjectDraft?.(existingProject.id);
      }
      closePalette();
      return;
    }

    if (!props.onSubmitCommand) {
      setAddProjectBrowseError(displayText("Add Project submit is not available."));
      return;
    }
    if (!props.onCreatePendingProjectDraft) {
      setAddProjectBrowseError(displayText("Add Project draft creation is not available."));
      return;
    }

    const projectId = newProjectId();
    const title = inferProjectTitleFromPath(cwd);
    await props.onSubmitCommand(buildProjectCreate({ projectId, cwd }));
    props.onCreatePendingProjectDraft({ projectId, workspaceRoot: cwd, title });
    closePalette();
  }

  function selectAdjacentProject(direction: 1 | -1) {
    const projects = sortedProjects(shell().projects);
    if (projects.length === 0) return;
    const currentIndex = shell().selectedProjectId
      ? projects.findIndex((project) => project.id === shell().selectedProjectId)
      : -1;
    const nextIndex =
      currentIndex < 0 ? 0 : (currentIndex + direction + projects.length) % projects.length;
    const project = projects[nextIndex];
    if (!project) return;
    props.onSelectProject?.(project.id);
  }

  function selectAdjacentVisibleThread(direction: 1 | -1) {
    const threads = sortedVisibleThreads(shell());
    if (threads.length === 0) return;
    const currentIndex = shell().selectedThreadId
      ? threads.findIndex((thread) => thread.id === shell().selectedThreadId)
      : -1;
    const nextIndex =
      currentIndex < 0 ? 0 : (currentIndex + direction + threads.length) % threads.length;
    const thread = threads[nextIndex];
    if (!thread) return;
    props.onSelectThread?.(thread.id);
  }

  async function submit() {
    const text = composerText().trim();
    if (!text || !props.onSubmitCommand) return;
    try {
      const thread = activeThreadShell();
      const project = activeProject();
      if (thread) {
        const commandInput = {
          thread,
          text,
          attachments: draftAttachments(),
          runtimeMode: selectedRuntimeMode(),
          interactionMode: selectedInteractionMode(),
          ...(selectedModelSelection() ? { modelSelection: selectedModelSelection() } : {}),
        };
        await props.onSubmitCommand(buildExistingThreadTurnStart(commandInput));
      } else if (project) {
        const command = buildNewThreadTurnStart({
          project,
          text,
          attachments: draftAttachments(),
          runtimeMode: selectedRuntimeMode(),
          interactionMode: selectedInteractionMode(),
          ...(selectedModelSelection() ? { modelSelection: selectedModelSelection() } : {}),
        });
        await props.onSubmitCommand(command);
        props.onPromoteProjectDraft?.(project.id, command.threadId);
      } else if (pendingProjectDraft()) {
        setSubmitError(displayText("Project is still loading."));
        return;
      } else {
        return;
      }
      const projectId = draftProjectId();
      if (projectId) props.onDraftChange?.(projectId, "");
      if (projectId) setDraftAttachments([]);
      else setLocalDraft("");
    } catch (error) {
      setSubmitError(displayText(String(error)));
    }
  }

  async function performAction(actionId: TuiActionId) {
    if (isThemeCommitBlocking()) return;
    switch (actionId) {
      case "palette.open":
        openCommandPaletteActions();
        return;
      case "help.toggle":
        setVisiblePanel(visiblePanel() === "help" ? null : "help");
        return;
      case "thread.new":
        props.onNewThread?.();
        return;
      case "message.send":
        await submit();
        return;
      case "turn.interrupt-or-exit": {
        const thread = activeThreadHeader();
        if (thread?.session?.status !== "running" || !thread.id) {
          props.onRequestExit();
          return;
        }
        await props.onSubmitCommand?.(
          buildThreadTurnInterrupt({
            threadId: thread.id,
            turnId: thread.session.activeTurnId,
          }),
        );
        return;
      }
      case "thread.next":
        props.onSelectNextThread?.(1);
        return;
      case "thread.previous":
        props.onSelectNextThread?.(-1);
        return;
      case "thread.archive-toggle": {
        const thread = activeThreadHeader();
        if (!thread?.id) return;
        if (thread.archivedAt) {
          await props.onSubmitCommand?.(buildThreadUnarchive({ threadId: thread.id }));
        } else if (canArchiveThread(thread)) {
          await props.onSubmitCommand?.(buildThreadArchive({ threadId: thread.id }));
        }
        return;
      }
      case "thread.stop": {
        const thread = activeThreadHeader();
        if (thread?.id && canStopThreadSession(thread)) {
          await props.onSubmitCommand?.(buildThreadSessionStop({ threadId: thread.id }));
        }
        return;
      }
      case "diff.toggle":
        setVisiblePanel(visiblePanel() === "diff" ? null : "diff");
        return;
      case "diff.turn":
        await loadDiff("turn");
        return;
      case "diff.full":
        await loadDiff("full");
        return;
      case "debug.toggle":
        setVisiblePanel(visiblePanel() === "debug" ? null : "debug");
        return;
      case "settings.toggle":
        setVisiblePanel(visiblePanel() === "settings" ? null : "settings");
        return;
      case "theme.switch":
        openThemePalette();
        return;
      case "model.next":
        await cycleModel();
        return;
      case "runtime.next":
        await setRuntimeMode(nextRuntimeMode(selectedRuntimeMode()));
        return;
      case "interaction.next":
        await setInteractionMode(selectedInteractionMode() === "default" ? "plan" : "default");
        return;
      case "connection.reconnect":
        await props.onReconnect?.();
        return;
      case "providers.refresh":
        await props.onRefreshProviders?.();
        return;
      case "vcs.refresh":
        await refreshVcs();
        return;
    }
  }

  async function loadDiff(mode: TuiDiffMode) {
    const detail = activeDetail();
    if (!detail) return;
    const turnInput = mode === "turn" ? buildTurnDiffInput(detail) : null;
    const fullInput = mode === "full" ? buildFullThreadDiffInput(detail) : null;
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
            threadId: detail.id,
            mode,
            fromTurnCount: turnInput.fromTurnCount,
            toTurnCount: turnInput.toTurnCount,
          }
        : { threadId: detail.id, mode, toTurnCount: fullInput!.toTurnCount },
    );
    const cached = diffCache()[key];
    if (cached) {
      setDiffState({ loading: false, title: `${mode} diff`, text: cached, error: null });
      setVisiblePanel("diff");
      return;
    }
    setVisiblePanel("diff");
    setDiffState({ loading: true, title: `${mode} diff`, text: "", error: null });
    const requestId = (diffRequestRef.current += 1);
    const requestThreadId = detail.id;
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

  async function refreshVcs() {
    const cwd =
      activeThreadHeader()?.worktreePath ?? activeProject()?.workspaceRoot ?? status().config?.cwd;
    if (!cwd) return;
    try {
      const next = await props.onRefreshVcsStatus?.(cwd);
      if (next) setGitStatus(next);
    } catch (error) {
      setSubmitError(displayText(String(error)));
    }
  }

  async function cycleModel() {
    if (!draftProjectId() || !status().config?.providers.length) return;
    const providers = status().config?.providers ?? [];
    const models = deriveProviderInstanceEntries(providers).flatMap((entry) =>
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
        entry.instanceId === selectedModelSelection()?.instanceId &&
        entry.model === selectedModelSelection()?.model,
    );
    const next = models[(index + 1 + models.length) % models.length]!;
    const thread = activeThreadHeader();
    if (thread?.id) {
      setThreadControlContext(thread.id, {
        ...threadControlContext(),
        modelSelection: next as ModelSelection,
      });
      await props.onSubmitCommand?.(
        buildThreadMetaUpdate({
          threadId: thread.id,
          modelSelection: next as ModelSelection,
        }),
      );
    } else {
      setProjectDraftContext({ ...projectDraftContext(), modelSelection: next as ModelSelection });
    }
  }

  async function setRuntimeMode(runtimeMode: RuntimeMode) {
    if (!draftProjectId()) return;
    const thread = activeThreadHeader();
    if (thread?.id) {
      setThreadControlContext(thread.id, { ...threadControlContext(), runtimeMode });
      await props.onSubmitCommand?.(
        buildThreadRuntimeModeSet({ threadId: thread.id, runtimeMode }),
      );
    } else {
      setProjectDraftContext({ ...projectDraftContext(), runtimeMode });
    }
  }

  async function setInteractionMode(interactionMode: ProviderInteractionMode) {
    if (!draftProjectId()) return;
    const thread = activeThreadHeader();
    if (thread?.id) {
      setThreadControlContext(thread.id, {
        ...threadControlContext(),
        interactionMode,
      });
      await props.onSubmitCommand?.(
        buildThreadInteractionModeSet({ threadId: thread.id, interactionMode }),
      );
    } else {
      setProjectDraftContext({ ...projectDraftContext(), interactionMode });
    }
  }

  function toggleUserInputOption(index: number, questionId: string | undefined) {
    const pending = activePendingUserInput();
    if (!questionId || !pending) return;
    const question = pending.questions.find((entry) => entry.id === questionId);
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
      flexDirection="row"
      backgroundColor={props.theme.palette.canvas}
      position="relative"
    >
      {sidebarOverlayOpen() ? (
        <box
          position="absolute"
          left={0}
          top={0}
          bottom={0}
          right={0}
          zIndex={40}
          backgroundColor={props.theme.palette.scrim}
          onMouseDown={() => setSidebarOverlayOpen(false)}
        />
      ) : null}
      {layout().showSidebar || sidebarOverlayOpen() ? (
        <Sidebar
          shell={shell()}
          connection={status().connection}
          layout={sidebarOverlayOpen() ? overlaySidebarLayout(layout()) : layout()}
          overlay={sidebarOverlayOpen()}
          focusArea={focusArea()}
          expandedProjectIds={expandedProjectIds()}
          onToggleProject={(projectId) => {
            setFocusArea("projects");
            setExpandedProjectIds((existing) => {
              const next = new Set(existing);
              if (next.has(projectId)) next.delete(projectId);
              else next.add(projectId);
              return next;
            });
            props.onSelectProject?.(projectId);
            if (sidebarOverlayOpen()) setSidebarOverlayOpen(false);
          }}
          onCreateProjectDraft={(projectId) => {
            setFocusArea("composer");
            props.onCreateProjectDraft?.(projectId);
            setSidebarOverlayOpen(false);
          }}
          onOpenAddProject={openAddProjectPalette}
          onSelectThread={(threadId) => {
            setFocusArea("threads");
            props.onSelectThread?.(threadId);
            setSidebarOverlayOpen(false);
          }}
          onOpenSettings={() => {
            if (isThemeCommitBlocking()) return;
            setVisiblePanel("settings");
            setFocusArea("timeline");
            setSidebarOverlayOpen(false);
          }}
          onOpenKeybindings={() => {
            if (isThemeCommitBlocking()) return;
            setVisiblePanel("help");
            setFocusArea("timeline");
            setSidebarOverlayOpen(false);
          }}
          theme={props.theme}
        />
      ) : null}
      <box flexGrow={1} flexDirection="column" backgroundColor={props.theme.palette.main}>
        <MainHeader
          thread={activeThreadHeader()}
          projectTitle={draftProjectTitle()}
          showProjectBadge={layout().showHeaderProjectBadge}
          showSidebarToggle={layout().showSidebarToggle}
          showSidebar={layout().showSidebar || sidebarOverlayOpen()}
          onToggleSidebar={() => {
            setFocusArea("projects");
            if (layout().sidebarForcedCollapsed) {
              setSidebarOverlayOpen((current) => !current);
            } else {
              setSidebarCollapsedPreference((current) => !current);
            }
          }}
          onToggleDiff={() => runAsyncAction(() => performAction("diff.toggle"))}
          onRefreshVcs={() => runAsyncAction(() => performAction("vcs.refresh"))}
          viewportColumns={dimensions().width}
          gitStatus={gitStatus()}
          diffActive={visiblePanel() === "diff"}
          focusArea={focusArea()}
          onFocusControls={() => setFocusArea("controls")}
          theme={props.theme}
        />
        <box
          flexGrow={1}
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          flexDirection="column"
          onMouseDown={() => setFocusArea("timeline")}
        >
          {visiblePanel() === "palette" ? null : visiblePanel() === "help" ? (
            <KeyboardHelp theme={props.theme} />
          ) : visiblePanel() === "diff" ? (
            <DiffPanel
              title={diffState().title}
              text={diffState().text}
              loading={diffState().loading}
              error={diffState().error}
              theme={props.theme}
            />
          ) : visiblePanel() === "debug" ? (
            <DebugPanel entries={props.debugEntries ?? []} theme={props.theme} />
          ) : visiblePanel() === "settings" ? (
            <SettingsPanel config={status().config} theme={props.theme} />
          ) : (
            <ConversationArea
              timeline={timeline()}
              viewportColumns={
                dimensions().width - (layout().showSidebar ? layout().sidebarWidth + 1 : 0) - 4
              }
              connection={status().connection}
              banners={banners()}
              showLandingLogo={Boolean(!activeThreadHeader() && timeline().length === 0)}
              focused={focusArea() === "timeline"}
              theme={props.theme}
            />
          )}
        </box>
        <ComposerPanel
          composerText={composerText()}
          submitError={submitError()}
          provider={selectedProvider()}
          modelSelection={selectedModelSelection()}
          runtimeMode={selectedRuntimeMode()}
          interactionMode={selectedInteractionMode()}
          attachmentCount={draftAttachments().length}
          branch={activeThreadHeader()?.branch ?? gitStatus()?.refName ?? null}
          showWorkspaceFooter={Boolean(
            draftProjectId() && (gitStatus() || activeThreadHeader()?.branch),
          )}
          hasActiveThread={Boolean(activeThreadHeader())}
          hasDraftThread={Boolean(draftProjectId() && !activeThreadHeader())}
          activePendingApproval={activePendingApproval()}
          activePendingUserInput={activePendingUserInput()}
          activeQuestionIndex={activeQuestionIndex()}
          customInputAnswers={customInputAnswers()}
          selectedInputOptions={selectedInputOptions()}
          isRunning={activeThreadHeader()?.session?.status === "running"}
          layout={layout()}
          viewportColumns={dimensions().width}
          onCycleModel={() => runAsyncAction(() => performAction("model.next"))}
          onCycleRuntime={() => runAsyncAction(() => performAction("runtime.next"))}
          onCycleInteraction={() => runAsyncAction(() => performAction("interaction.next"))}
          onPrimaryAction={() => runAsyncAction(() => performAction("message.send"))}
          onStop={() => runAsyncAction(() => performAction("thread.stop"))}
          focused={focusArea() === "composer"}
          controlsFocused={focusArea() === "controls"}
          onFocusComposer={() => setFocusArea("composer")}
          onFocusControls={() => setFocusArea("controls")}
          theme={props.theme}
        />
      </box>
      {visiblePanel() === "palette" && paletteMode() === "themes" ? (
        <box
          position="absolute"
          left={0}
          top={0}
          bottom={0}
          right={0}
          zIndex={34}
          backgroundColor="transparent"
          onMouseDown={closePalette}
        />
      ) : null}
      {visiblePanel() === "palette" ? (
        <box
          position="absolute"
          left={paletteFrame().left}
          top={paletteFrame().top}
          width={paletteFrame().width}
          height={paletteFrame().height}
          zIndex={35}
          backgroundColor="transparent"
        >
          <CommandPalette
            view={paletteView()}
            onSelectItem={handlePaletteItem}
            onHighlightItem={handlePaletteHighlight}
            selectedIndex={paletteSelectedIndex()}
            highlightedItemValue={addProjectBrowseHighlightedItemValue()}
            theme={props.theme}
          />
        </box>
      ) : null}
    </box>
  );
}

function PendingApprovalPanel(props: {
  approval: ReturnType<typeof derivePendingApprovals>[number];
  theme: TuiTheme;
}) {
  return (
    <box
      backgroundColor={props.theme.palette.surfaceWarn}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
      marginBottom={1}
      flexDirection="column"
    >
      <text fg={props.theme.palette.warning}>
        {`approval required · ${displayText(props.approval.requestKind)}`}
      </text>
      {props.approval.detail ? (
        <text fg={props.theme.palette.muted}>{displayText(props.approval.detail)}</text>
      ) : null}
      <box marginTop={1} flexDirection="row">
        <ActionPill label="Cancel" shortcut="c" theme={props.theme} />
        <ActionPill label="Decline" shortcut="n" theme={props.theme} />
        <ActionPill label="Always allow" shortcut="s" theme={props.theme} />
        <ActionPill active label="Approve once" shortcut="y" theme={props.theme} />
      </box>
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
  const questionIndex = createMemo(() =>
    Math.min(props.questionIndex, Math.max(props.pending.questions.length - 1, 0)),
  );
  const question = createMemo(() => props.pending.questions[questionIndex()] ?? null);
  const selected = createMemo(() => {
    const activeQuestion = question();
    return activeQuestion ? (props.selectedOptions[activeQuestion.id] ?? []) : [];
  });
  const customAnswer = createMemo(() => {
    const activeQuestion = question();
    return activeQuestion ? (props.customAnswers[activeQuestion.id] ?? "") : "";
  });
  return (
    <box
      backgroundColor={props.theme.palette.surfaceInfo}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
      marginBottom={1}
      flexDirection="column"
    >
      {question() ? (
        <text fg={props.theme.palette.accent}>
          {`input requested · ${questionIndex() + 1}/${props.pending.questions.length} · ${displayText(question()!.header)}`}
        </text>
      ) : null}
      {question() ? (
        <text fg={props.theme.palette.text}>{displayText(question()!.question)}</text>
      ) : null}
      {question() && question()!.options.length > 0 ? (
        <box marginTop={1} flexDirection="row" overflow="hidden">
          {question()!
            .options.slice(0, 4)
            .map((option, index) => (
              <ActionPill
                active={selected().includes(index)}
                label={displayText(option.label)}
                shortcut={`${index + 1}`}
                theme={props.theme}
              />
            ))}
        </box>
      ) : null}
      {customAnswer() ? (
        <text fg={props.theme.palette.muted}>{`custom: ${displayText(customAnswer())}`}</text>
      ) : null}
      <text fg={props.theme.palette.subtle}>left/right question · enter submit</text>
    </box>
  );
}

function Sidebar(props: {
  shell: TuiShellState;
  connection: TuiServerStatusSnapshot["connection"];
  layout: ReturnType<typeof resolveX1ShellLandingLayout>;
  overlay?: boolean;
  focusArea: LandingFocusArea;
  expandedProjectIds: ReadonlySet<string>;
  onToggleProject: (projectId: ProjectId) => void;
  onCreateProjectDraft: (projectId: ProjectId) => void;
  onOpenAddProject: () => void;
  onSelectThread: (threadId: ThreadId) => void;
  onOpenSettings: () => void;
  onOpenKeybindings: () => void;
  theme: TuiTheme;
}) {
  const projects = createMemo(() => sortedProjects(props.shell.projects));
  const focused = createMemo(() => props.focusArea === "projects" || props.focusArea === "threads");
  const hasProjects = createMemo(() => props.shell.projects.length > 0);
  return (
    <box
      width={props.layout.sidebarWidth}
      height="100%"
      {...(props.overlay ? { position: "absolute" as const, left: 0, top: 0, zIndex: 50 } : {})}
      border={["right"]}
      borderColor={props.theme.palette.divider}
      backgroundColor={props.theme.palette.sidebar}
      flexDirection="column"
    >
      <box height={3} paddingLeft={2} paddingRight={2} alignItems="center" flexDirection="row">
        {props.layout.showWindowDots ? <WindowDots theme={props.theme} /> : null}
        <text fg={props.theme.palette.text}>{props.layout.sidebarTitle}</text>
        {props.layout.showSidebarAlphaBadge ? <Badge label="ALPHA" theme={props.theme} /> : null}
      </box>
      <scrollbox flexGrow={1} paddingLeft={1} paddingRight={1} focused={focused()}>
        <SectionLabel
          label="PROJECTS"
          actions={[
            { icon: "⇅", active: false, disabled: true },
            { icon: "+", active: false, onPress: props.onOpenAddProject },
          ]}
          theme={props.theme}
        />
        {!hasProjects() ? (
          <box
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            paddingBottom={1}
            flexDirection="column"
          >
            {props.connection === "connected" ? (
              <text fg={props.theme.palette.muted}>
                Add a workspace path to start. The current folder is prefilled.
              </text>
            ) : (
              <>
                <text fg={props.theme.palette.muted}>Connecting workspace</text>
                <text fg={props.theme.palette.subtle}>
                  Opening the RPC session and waiting for shell state.
                </text>
              </>
            )}
          </box>
        ) : null}
        {projects().map((project) => {
          const display = displayProject(project);
          const isActive = project.id === props.shell.selectedProjectId;
          const projectThreads = props.shell.threads
            .filter((thread) => !thread.archivedAt && thread.projectId === project.id)
            .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
          const isExpanded = props.expandedProjectIds.has(project.id);
          const projectStatus = resolveProjectStatus(projectThreads);
          return (
            <box flexDirection="column">
              <SidebarRow
                active={isActive || (props.focusArea === "projects" && isActive)}
                activeBackgroundColor={props.theme.palette.controlActive}
                onPress={() => props.onToggleProject(project.id)}
                theme={props.theme}
              >
                <text
                  fg={
                    projectStatus && !isExpanded ? projectStatus.color : props.theme.palette.subtle
                  }
                >
                  {!isExpanded && projectStatus ? "●" : isExpanded ? "▾" : "▸"}
                </text>
                <text fg={props.theme.palette.muted}> 󰉋 </text>
                <box width={22} overflow="hidden" height={1}>
                  <text fg={isActive ? props.theme.palette.text : props.theme.palette.muted}>
                    {truncateTitleForDisplay(display.title, 22)}
                  </text>
                </box>
                <box flexGrow={1} />
                <IconButton
                  icon="+"
                  active={false}
                  onPress={() => props.onCreateProjectDraft(project.id)}
                  theme={props.theme}
                />
              </SidebarRow>
              {isExpanded ? (
                <box marginLeft={1} flexDirection="column">
                  {projectThreads.length > 0 ? (
                    projectThreads.map((thread) => {
                      const threadDisplay = displayThread(thread);
                      const isThreadActive = thread.id === props.shell.selectedThreadId;
                      const status = resolveThreadStatus(thread);
                      return (
                        <SidebarRow
                          active={
                            isThreadActive || (props.focusArea === "threads" && isThreadActive)
                          }
                          activeBackgroundColor={props.theme.palette.controlActiveStrong}
                          onPress={() => props.onSelectThread(thread.id)}
                          theme={props.theme}
                        >
                          <box width={1} marginRight={1} alignItems="center">
                            {status ? <text fg={status.color}>●</text> : null}
                          </box>
                          <box width={SIDEBAR_THREAD_TITLE_WIDTH} overflow="hidden" height={1}>
                            <text
                              fg={
                                isThreadActive
                                  ? props.theme.palette.text
                                  : props.theme.palette.muted
                              }
                            >
                              {truncateTitleForDisplay(
                                threadDisplay.title,
                                SIDEBAR_THREAD_TITLE_WIDTH,
                              )}
                            </text>
                          </box>
                          <box
                            width={SIDEBAR_THREAD_TIMESTAMP_WIDTH}
                            marginLeft={SIDEBAR_THREAD_TIMESTAMP_GAP}
                          >
                            <text
                              fg={
                                isThreadActive
                                  ? props.theme.palette.muted
                                  : props.theme.palette.subtle
                              }
                            >
                              {relativeTime(thread.updatedAt)}
                            </text>
                          </box>
                        </SidebarRow>
                      );
                    })
                  ) : (
                    <box paddingLeft={2} paddingRight={1}>
                      <text fg={props.theme.palette.subtle}>No threads yet</text>
                    </box>
                  )}
                </box>
              ) : null}
            </box>
          );
        })}
      </scrollbox>
      <box paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1} flexDirection="column">
        <SidebarRow suppressHighlight onPress={props.onOpenSettings} theme={props.theme}>
          <text fg={props.theme.palette.muted}>󰒓 </text>
          <text fg={props.theme.palette.muted}>Settings</text>
        </SidebarRow>
        <SidebarRow suppressHighlight onPress={props.onOpenKeybindings} theme={props.theme}>
          <text fg={props.theme.palette.muted}>󰌌 </text>
          <text fg={props.theme.palette.muted}>Keybindings</text>
        </SidebarRow>
      </box>
    </box>
  );
}

function MainHeader(props: {
  thread: OrchestrationThreadShell | OrchestrationThread | null | undefined;
  projectTitle: string | null;
  showProjectBadge: boolean;
  showSidebarToggle: boolean;
  showSidebar: boolean;
  onToggleSidebar: () => void;
  onToggleDiff: () => void;
  onRefreshVcs: () => void;
  viewportColumns: number;
  gitStatus: VcsStatusResult | null;
  diffActive: boolean;
  focusArea: LandingFocusArea;
  onFocusControls: () => void;
  theme: TuiTheme;
}) {
  const title = createMemo(() => {
    const fallbackTitle = props.projectTitle ? `New thread [${props.projectTitle}]` : "New thread";
    return truncateTitleForDisplay(
      props.thread ? displayThread(props.thread).title : fallbackTitle,
      headerTitleMaxLength({
        viewportColumns: props.viewportColumns,
        showSidebarToggle: props.showSidebarToggle,
        showHeaderProjectBadge: props.showProjectBadge,
      }),
    );
  });
  const gitIconColor = createMemo(() =>
    props.gitStatus && props.gitStatus.workingTree.files.length > 0
      ? props.theme.palette.success
      : props.theme.palette.muted,
  );
  return (
    <box
      width="100%"
      height={3}
      paddingLeft={props.showSidebarToggle ? 1 : 2}
      paddingRight={0}
      paddingTop={1}
      paddingBottom={1}
      border={["bottom"]}
      borderColor={props.theme.palette.divider}
      backgroundColor={props.theme.palette.main}
      flexDirection="row"
      alignItems="center"
      position="relative"
    >
      <box
        flexDirection="row"
        alignItems="center"
        flexShrink={1}
        minWidth={0}
        overflow="hidden"
        height={1}
      >
        {props.showSidebarToggle ? (
          <ToolbarButton
            icon={props.showSidebar ? "✕" : "☰"}
            compact
            marginRight={1}
            onPress={props.onToggleSidebar}
            theme={props.theme}
          />
        ) : null}
        <box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden" height={1}>
          <text fg={props.theme.palette.text}>{title()}</text>
        </box>
        {props.showProjectBadge && props.projectTitle ? (
          <Badge label={props.projectTitle} theme={props.theme} />
        ) : null}
      </box>
      <box position="absolute" right={1} flexDirection="row" alignItems="center" flexShrink={0}>
        <ToolbarButton
          icon="󰊢"
          compact
          chrome="bare"
          width={4}
          justifyContent="flex-end"
          iconColor={gitIconColor()}
          disabled={!props.gitStatus}
          active={props.focusArea === "controls"}
          onPress={() => {
            props.onFocusControls();
            props.onRefreshVcs();
          }}
          theme={props.theme}
        />
        <ToolbarButton
          icon=""
          compact
          chrome="bare"
          width={4}
          justifyContent="flex-start"
          active={props.diffActive || props.focusArea === "controls"}
          iconColor={
            props.diffActive || props.focusArea === "controls"
              ? props.theme.palette.text
              : props.theme.palette.muted
          }
          disabled={!props.gitStatus}
          onPress={() => {
            props.onFocusControls();
            props.onToggleDiff();
          }}
          theme={props.theme}
        />
      </box>
    </box>
  );
}

function ConversationArea(props: {
  timeline: ReturnType<ReturnType<typeof createConversationDisplayCache>["buildTimeline"]>;
  viewportColumns: number;
  connection: TuiServerStatusSnapshot["connection"];
  banners: readonly TuiErrorBanner[];
  showLandingLogo: boolean;
  focused: boolean;
  theme: TuiTheme;
}) {
  const statusCards = createMemo(() =>
    landingStatusCards({
      connection: props.connection,
      banners: props.banners,
    }),
  );
  return (
    <scrollbox
      flexGrow={1}
      flexShrink={1}
      minHeight={0}
      paddingRight={1}
      focused={props.focused}
      stickyScroll={true}
      stickyStart="bottom"
      verticalScrollbarOptions={{ visible: false }}
    >
      {props.showLandingLogo && statusCards().length === 0 ? (
        <box height="100%" minHeight={8} flexDirection="column">
          <X1ShellLogo viewportColumns={props.viewportColumns} theme={props.theme} />
        </box>
      ) : null}
      {props.timeline.length === 0
        ? statusCards().map((card) => (
            <box
              backgroundColor={props.theme.palette.surface}
              paddingLeft={2}
              paddingRight={2}
              paddingTop={2}
              paddingBottom={2}
              marginBottom={1}
              flexDirection="column"
              maxWidth="88%"
            >
              <text
                fg={card.kind === "danger" ? props.theme.palette.danger : props.theme.palette.muted}
              >
                {card.title}
              </text>
              {card.detail ? <text fg={props.theme.palette.subtle}>{card.detail}</text> : null}
            </box>
          ))
        : null}
      {props.timeline.length > 0
        ? props.timeline.map((entry) =>
            entry.kind === "message" ? (
              entry.role === "user" ? (
                <box width="100%" marginBottom={1} flexDirection="column" alignItems="flex-end">
                  <box width="70%" flexDirection="column" alignItems="flex-end">
                    <SafeMarkdown fg={props.theme.palette.text} content={entry.markdown} />
                  </box>
                  <text fg={props.theme.palette.subtle}>
                    {formatMessageTimestamp(entry.createdAt)}
                  </text>
                </box>
              ) : entry.role === "plan" ? (
                <box
                  backgroundColor={props.theme.palette.surfacePlan}
                  marginBottom={1}
                  paddingLeft={1}
                  paddingRight={1}
                  paddingTop={1}
                  paddingBottom={1}
                  flexDirection="column"
                >
                  <text
                    fg={props.theme.palette.success}
                  >{`plan · ${relativeTime(entry.createdAt)}`}</text>
                  <SafeMarkdown fg={props.theme.palette.text} content={entry.markdown} />
                </box>
              ) : (
                <box width="100%" marginBottom={1} flexDirection="column">
                  <SafeMarkdown fg={props.theme.palette.text} content={entry.markdown} />
                  <text fg={props.theme.palette.subtle}>
                    {formatMessageTimestamp(entry.createdAt)}
                  </text>
                </box>
              )
            ) : (
              <ActivityRow entry={entry} theme={props.theme} />
            ),
          )
        : null}
    </scrollbox>
  );
}

function ActivityRow(props: {
  entry: Extract<
    ReturnType<ReturnType<typeof createConversationDisplayCache>["buildTimeline"]>[number],
    { kind: "activity" }
  >;
  theme: TuiTheme;
}) {
  const display = activityDisplay(props.entry, props.theme);
  return (
    <box
      backgroundColor={display.backgroundColor}
      marginBottom={1}
      paddingLeft={1}
      paddingRight={1}
      height={1}
      flexDirection="row"
      alignItems="center"
      maxWidth="88%"
    >
      <text fg={display.color}>{`${display.icon} `}</text>
      <box flexGrow={1} overflow="hidden" height={1}>
        <text fg={props.theme.palette.muted}>{display.text}</text>
      </box>
    </box>
  );
}

function ComposerPanel(props: {
  composerText: string;
  submitError: string | null;
  provider: ServerProvider | null;
  modelSelection: ModelSelection | null;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  attachmentCount: number;
  branch: string | null;
  showWorkspaceFooter: boolean;
  hasActiveThread: boolean;
  hasDraftThread: boolean;
  activePendingApproval: ReturnType<typeof derivePendingApprovals>[number] | null;
  activePendingUserInput: ReturnType<typeof derivePendingUserInputs>[number] | null;
  activeQuestionIndex: number;
  customInputAnswers: Readonly<Record<string, string>>;
  selectedInputOptions: Readonly<Record<string, readonly number[]>>;
  isRunning: boolean;
  layout: ReturnType<typeof resolveX1ShellLandingLayout>;
  viewportColumns: number;
  onCycleModel: () => void;
  onCycleRuntime: () => void;
  onCycleInteraction: () => void;
  onPrimaryAction: () => void;
  onStop: () => void;
  focused: boolean;
  controlsFocused: boolean;
  onFocusComposer: () => void;
  onFocusControls: () => void;
  theme: TuiTheme;
}) {
  let textareaRef: TextareaRenderable | undefined;
  let syncedTextareaText = props.composerText;
  const hasPending = createMemo(() =>
    Boolean(props.activePendingApproval || props.activePendingUserInput),
  );
  const placeholder = createMemo(() =>
    composerPlaceholder({
      hasActiveThread: props.hasActiveThread,
      hasDraftThread: props.hasDraftThread,
      composerText: props.composerText,
      activePendingApproval: props.activePendingApproval,
      activePendingUserInput: props.activePendingUserInput,
    }),
  );
  const textareaHeight = createMemo(() =>
    hasPending()
      ? COMPOSER_PENDING_TEXTAREA_MIN_HEIGHT
      : estimateComposerTextareaHeight({
          text: props.composerText,
          placeholder: placeholder(),
          totalColumns: props.viewportColumns,
          sidebarWidth: props.layout.sidebarWidth,
          showSidebar: props.layout.showSidebar,
        }),
  );
  const providerId = createMemo(
    () => props.provider?.driver ?? props.modelSelection?.instanceId ?? "codex",
  );
  const modelLabel = createMemo(() => modelControlLabel(props.modelSelection, props.provider));
  const traitsLabel = createMemo(() =>
    composerTraitsLabel(props.modelSelection, props.provider, props.runtimeMode),
  );
  createEffect(() => {
    const nextText = props.composerText;
    if (!textareaRef || syncedTextareaText === nextText) return;
    if (textareaRef.plainText !== nextText) textareaRef.setText(nextText);
    syncedTextareaText = nextText;
  });
  return (
    <box
      height={textareaHeight() + (hasPending() ? 7 : 6)}
      paddingLeft={2}
      paddingRight={2}
      paddingBottom={1}
    >
      <box
        position="relative"
        flexGrow={1}
        border
        borderStyle="rounded"
        borderColor={
          props.focused || props.controlsFocused
            ? props.theme.palette.composerBorder
            : props.theme.palette.composerBorderMuted
        }
        backgroundColor={props.theme.palette.composerPanel}
        paddingTop={hasPending() ? 0 : 1}
        paddingBottom={1}
        paddingLeft={1}
        paddingRight={1}
        flexDirection="column"
        onMouseDown={props.onFocusComposer}
      >
        {props.activePendingApproval ? (
          <PendingApprovalPanel approval={props.activePendingApproval} theme={props.theme} />
        ) : props.activePendingUserInput ? (
          <PendingUserInputPanel
            pending={props.activePendingUserInput}
            questionIndex={props.activeQuestionIndex}
            customAnswers={props.customInputAnswers}
            selectedOptions={props.selectedInputOptions}
            theme={props.theme}
          />
        ) : (
          <box
            marginBottom={1}
            height={textareaHeight()}
            minHeight={textareaHeight()}
            paddingLeft={1}
            paddingRight={1}
          >
            <textarea
              ref={(value: TextareaRenderable) => {
                textareaRef = value;
                syncedTextareaText = props.composerText;
              }}
              focused={props.focused}
              initialValue={props.composerText}
              placeholder={placeholder()}
              cursorColor={props.theme.palette.cursor}
              style={{
                backgroundColor: props.theme.palette.composerPanel,
                focusedBackgroundColor: props.theme.palette.composerPanel,
                textColor: props.theme.palette.text,
                focusedTextColor: props.theme.palette.text,
                placeholderColor: props.theme.palette.subtle,
                height: "100%",
                width: "100%",
              }}
            />
          </box>
        )}
        <box
          paddingLeft={1}
          paddingRight={1}
          flexDirection="row"
          alignItems="center"
          onMouseDown={props.onFocusControls}
        >
          <box flexDirection="row" alignItems="center" flexGrow={1} overflow="hidden" height={1}>
            <ToolbarButton
              icon={providerIcon(providerId())}
              iconColor={providerColor(providerId(), props.theme)}
              label={props.layout.showComposerModelLabel ? modelLabel() : undefined}
              compact={!props.layout.showComposerModelLabel}
              onPress={props.onCycleModel}
              active={props.controlsFocused}
              theme={props.theme}
            />
            {traitsLabel() ? (
              <>
                {props.layout.showComposerDividers ? <FooterDivider theme={props.theme} /> : null}
                <ToolbarButton
                  icon={composerTraitsIcon(props.modelSelection, props.provider)}
                  label={
                    props.layout.showComposerTraitsLabel
                      ? truncateTitleForDisplay(traitsLabel() ?? "", 14)
                      : undefined
                  }
                  compact={!props.layout.showComposerTraitsLabel}
                  onPress={props.onCycleRuntime}
                  active={props.controlsFocused}
                  theme={props.theme}
                />
              </>
            ) : null}
            {props.layout.showComposerDividers ? <FooterDivider theme={props.theme} /> : null}
            <ToolbarButton
              icon={interactionIcon(props.interactionMode)}
              label={
                props.layout.showComposerModeLabels
                  ? interactionLabel(props.interactionMode)
                  : undefined
              }
              compact={!props.layout.showComposerModeLabels}
              active={props.interactionMode === "plan"}
              onPress={props.onCycleInteraction}
              theme={props.theme}
            />
            {props.layout.showComposerDividers ? <FooterDivider theme={props.theme} /> : null}
            <ToolbarButton
              icon={runtimeFooterIcon(props.runtimeMode)}
              label={
                props.layout.showComposerModeLabels
                  ? runtimeFooterLabel(props.runtimeMode)
                  : undefined
              }
              compact={!props.layout.showComposerModeLabels}
              active={props.runtimeMode === "approval-required"}
              onPress={props.onCycleRuntime}
              theme={props.theme}
            />
            {props.attachmentCount > 0 ? (
              <>
                {props.layout.showComposerDividers ? <FooterDivider theme={props.theme} /> : null}
                <ToolbarButton
                  icon="󰋩"
                  label={`${props.attachmentCount}`}
                  compact
                  onPress={() => undefined}
                  theme={props.theme}
                />
              </>
            ) : null}
          </box>
          <ComposerSendButton
            icon={props.isRunning ? "■" : "↑"}
            variant={props.isRunning ? "stop" : "send"}
            disabled={!props.isRunning && props.composerText.trim().length === 0}
            onPress={props.isRunning ? props.onStop : props.onPrimaryAction}
            theme={props.theme}
          />
        </box>
        {props.submitError ? (
          <text fg={props.theme.palette.danger}>{props.submitError}</text>
        ) : null}
        {props.showWorkspaceFooter ? (
          <box
            position="absolute"
            left={1}
            right={1}
            bottom={-1}
            zIndex={30}
            flexDirection="row"
            alignItems="center"
            justifyContent="space-between"
            backgroundColor="transparent"
          >
            <box
              backgroundColor={props.theme.palette.composerPanel}
              paddingLeft={1}
              paddingRight={1}
            >
              <ToolbarButton
                icon="󰉋"
                label="Local"
                compact
                chrome="bare"
                onPress={() => undefined}
                theme={props.theme}
              />
            </box>
            <box
              backgroundColor={props.theme.palette.composerPanel}
              paddingLeft={1}
              paddingRight={1}
            >
              <ToolbarButton
                icon="󰘬"
                label={truncateTitleForDisplay(displayText(props.branch ?? "Select branch"), 20)}
                compact
                chrome="bare"
                onPress={() => undefined}
                theme={props.theme}
              />
            </box>
          </box>
        ) : null}
      </box>
    </box>
  );
}

function WindowDots(props: { theme: TuiTheme }) {
  return (
    <box flexDirection="row" alignItems="center" marginRight={2}>
      <text fg={props.theme.palette.macRed}>● </text>
      <text fg={props.theme.palette.macYellow}>● </text>
      <text fg={props.theme.palette.macGreen}>● </text>
    </box>
  );
}

function Badge(props: { label: string; theme: TuiTheme }) {
  return (
    <box
      marginLeft={1}
      paddingLeft={1}
      paddingRight={1}
      height={1}
      justifyContent="center"
      backgroundColor={props.theme.palette.controlHover}
    >
      <text fg={props.theme.palette.muted}>{props.label}</text>
    </box>
  );
}

function ActionPill(props: { label: string; shortcut: string; active?: boolean; theme: TuiTheme }) {
  return (
    <box
      marginRight={1}
      paddingLeft={1}
      paddingRight={1}
      height={1}
      backgroundColor={
        props.active ? props.theme.palette.controlActive : props.theme.palette.controlHover
      }
    >
      <text fg={props.active ? props.theme.palette.text : props.theme.palette.muted}>
        {`${props.label} ${props.shortcut}`}
      </text>
    </box>
  );
}

function SectionLabel(props: {
  label: string;
  actions?: ReadonlyArray<{
    icon: string;
    active?: boolean;
    disabled?: boolean;
    onPress?: () => void;
  }>;
  theme: TuiTheme;
}) {
  return (
    <box flexDirection="row" alignItems="center" paddingLeft={1} paddingRight={1} marginBottom={1}>
      <text fg={props.theme.palette.subtle}>{props.label}</text>
      <box flexGrow={1} />
      <box flexDirection="row">
        {(props.actions ?? []).map((action) => (
          <IconButton
            icon={action.icon}
            active={action.active ?? false}
            disabled={action.disabled ?? false}
            {...(action.onPress ? { onPress: action.onPress } : {})}
            theme={props.theme}
          />
        ))}
      </box>
    </box>
  );
}

function IconButton(props: {
  icon: string;
  active?: boolean;
  disabled?: boolean;
  width?: number;
  onPress?: () => void;
  theme: TuiTheme;
}) {
  const [hovered, setHovered] = createSignal(false);
  const active = createMemo(() => !props.disabled && (props.active || hovered()));
  return (
    <box
      width={props.width ?? 3}
      minWidth={props.width ?? 3}
      maxWidth={props.width ?? 3}
      height={1}
      justifyContent="center"
      alignItems="center"
      backgroundColor={
        props.disabled
          ? "transparent"
          : active()
            ? props.theme.palette.controlActive
            : props.theme.palette.control
      }
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      {...(props.onPress && !props.disabled ? { onMouseDown: props.onPress } : {})}
    >
      <text
        fg={
          props.disabled
            ? props.theme.palette.subtle
            : active()
              ? props.theme.palette.text
              : props.theme.palette.muted
        }
      >
        {props.icon}
      </text>
    </box>
  );
}

function SidebarRow(props: {
  active?: boolean;
  suppressHighlight?: boolean;
  activeBackgroundColor?: string;
  onPress?: () => void;
  children: JSX.Element;
  theme: TuiTheme;
}) {
  const [hovered, setHovered] = createSignal(false);
  const active = createMemo(() => props.active || hovered());
  return (
    <box
      height={1}
      paddingLeft={1}
      paddingRight={1}
      flexDirection="row"
      alignItems="center"
      overflow="hidden"
      backgroundColor={
        props.suppressHighlight
          ? "transparent"
          : active()
            ? (props.activeBackgroundColor ?? props.theme.palette.controlActive)
            : "transparent"
      }
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      {...(props.onPress ? { onMouseDown: props.onPress } : {})}
    >
      {props.children}
    </box>
  );
}

function ToolbarButton(props: {
  icon?: string;
  label?: string | undefined;
  active?: boolean;
  disabled?: boolean;
  iconColor?: string;
  marginRight?: number;
  compact?: boolean;
  chrome?: "default" | "bare";
  width?: number;
  justifyContent?: "center" | "flex-start" | "flex-end";
  onPress: () => void;
  theme: TuiTheme;
}) {
  const [hovered, setHovered] = createSignal(false);
  const isBare = props.chrome === "bare";
  const active = createMemo(() => !props.disabled && (props.active || hovered()));
  const foreground = createMemo(() =>
    props.disabled
      ? props.theme.palette.subtle
      : active()
        ? props.theme.palette.text
        : props.theme.palette.muted,
  );
  return (
    <box
      backgroundColor={
        isBare
          ? "transparent"
          : active()
            ? props.theme.palette.controlActive
            : props.theme.palette.control
      }
      paddingLeft={isBare ? 1 : props.label ? 1 : 0}
      paddingRight={isBare ? 1 : props.label ? 1 : 0}
      marginRight={isBare ? 0 : (props.marginRight ?? 1)}
      height={1}
      width={props.label ? "auto" : (props.width ?? (props.compact ? 3 : 4))}
      flexDirection="row"
      alignItems="center"
      justifyContent={props.justifyContent ?? "center"}
      flexShrink={0}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseDown={() => {
        if (!props.disabled) props.onPress();
      }}
    >
      {props.icon ? (
        <text fg={props.iconColor ?? foreground()}>
          {props.label ? `${props.icon} ` : props.icon}
        </text>
      ) : null}
      {props.label ? <text fg={foreground()}>{props.label}</text> : null}
    </box>
  );
}

function FooterDivider(props: { theme: TuiTheme }) {
  return <text fg={props.theme.palette.border}>│ </text>;
}

function ComposerSendButton(props: {
  icon: string;
  variant: "send" | "stop";
  disabled?: boolean;
  onPress: () => void;
  theme: TuiTheme;
}) {
  const [hovered, setHovered] = createSignal(false);
  const isStop = createMemo(() => props.variant === "stop");
  return (
    <box
      width={3}
      height={1}
      backgroundColor={
        props.disabled
          ? props.theme.palette.controlActive
          : isStop()
            ? props.theme.palette.composerStop
            : hovered()
              ? props.theme.palette.composerSendHover
              : props.theme.palette.composerSend
      }
      justifyContent="center"
      alignItems="center"
      onMouseDown={() => {
        if (!props.disabled) props.onPress();
      }}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
    >
      <text fg={props.disabled ? props.theme.palette.subtle : props.theme.palette.text}>
        {props.icon}
      </text>
    </box>
  );
}

function relativeTime(value: string | null | undefined): string {
  if (!value) return "";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function formatMessageTimestamp(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

function truncateTitleForDisplay(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  if (maxLength <= 1) return value.slice(0, maxLength);
  return `${value.slice(0, maxLength - 1)}…`;
}

function workspaceBasename(workspaceRoot: string): string {
  try {
    return displayText(path.basename(path.resolve(workspaceRoot)) || "workspace");
  } catch {
    return "workspace";
  }
}

function findBrowsePaletteItem(
  items: readonly TuiBrowsePaletteItem[],
  value: string | null,
): TuiBrowsePaletteItem | null {
  if (value === null) return null;
  return items.find((item) => browseItemValue(item) === value) ?? null;
}

function headerTitleMaxLength(input: {
  viewportColumns: number;
  showSidebarToggle: boolean;
  showHeaderProjectBadge: boolean;
}): number {
  return Math.max(
    12,
    Math.min(
      HEADER_THREAD_TITLE_MAX_LENGTH,
      input.viewportColumns -
        (input.showSidebarToggle ? 6 : 0) -
        (input.showHeaderProjectBadge ? 20 : 4),
    ),
  );
}

function landingStatusCards(input: {
  connection: TuiServerStatusSnapshot["connection"];
  banners: readonly TuiErrorBanner[];
}): readonly TuiErrorBanner[] {
  const cards = input.banners.filter((banner) => {
    if (banner.title === "Attach auth required") return false;
    if (banner.title === "Not connected") return false;
    if (banner.title === "Connecting") return false;
    if (banner.title === "Server starting") return false;
    if (banner.kind === "info") return false;
    if (input.connection !== "connected" && banner.title !== "Connection error") return false;
    return true;
  });
  return cards;
}

function nextFocusArea(current: LandingFocusArea, sidebarVisible: boolean): LandingFocusArea {
  const order: LandingFocusArea[] = sidebarVisible
    ? ["projects", "threads", "timeline", "composer", "controls"]
    : ["timeline", "composer", "controls"];
  const index = order.indexOf(current);
  return order[(index + 1 + order.length) % order.length] ?? "composer";
}

function sortedProjects(
  projects: readonly OrchestrationProjectShell[],
): readonly OrchestrationProjectShell[] {
  return projects.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function sortedVisibleThreads(shell: TuiShellState): readonly OrchestrationThreadShell[] {
  return shell.threads
    .filter((thread) => !thread.archivedAt)
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function overlaySidebarLayout(layout: ReturnType<typeof resolveX1ShellLandingLayout>) {
  return {
    ...layout,
    sidebarCollapsed: false,
    sidebarWidth: 34,
    showSidebar: true,
    showWindowDots: true,
    showSidebarAlphaBadge: true,
    sidebarTitle: "X1Shell",
  };
}

function activityDisplay(
  entry: Extract<
    ReturnType<ReturnType<typeof createConversationDisplayCache>["buildTimeline"]>[number],
    { kind: "activity" }
  >,
  theme: TuiTheme,
) {
  const text = entry.summary || entry.text;
  if (entry.tone === "error") {
    return {
      icon: "×",
      color: theme.palette.danger,
      backgroundColor: theme.palette.surfaceWarn,
      text,
    };
  }
  if (entry.tone === "approval") {
    return {
      icon: "?",
      color: theme.palette.warning,
      backgroundColor: theme.palette.surfaceWarn,
      text,
    };
  }
  if (entry.tone === "tool") {
    return { icon: "›", color: theme.palette.info, backgroundColor: theme.palette.surface, text };
  }
  if (/plan/i.test(entry.activityKind)) {
    return {
      icon: "◆",
      color: theme.palette.success,
      backgroundColor: theme.palette.surfacePlan,
      text,
    };
  }
  return { icon: "•", color: theme.palette.subtle, backgroundColor: theme.palette.surface, text };
}

function resolveProjectStatus(threads: readonly OrchestrationThreadShell[]) {
  for (const label of ["approval", "input", "working", "plan", "completed"] as const) {
    const status = threads.map(resolveThreadStatus).find((entry) => entry?.rank === label);
    if (status) return status;
  }
  return null;
}

function resolveThreadStatus(thread: OrchestrationThreadShell) {
  if (thread.hasPendingApprovals) {
    return { rank: "approval" as const, color: "#f59e0b" };
  }
  if (thread.hasPendingUserInput) {
    return { rank: "input" as const, color: "#818cf8" };
  }
  if (thread.session?.status === "running" || thread.session?.status === "starting") {
    return { rank: "working" as const, color: "#7dd3fc" };
  }
  if (thread.hasActionableProposedPlan) {
    return { rank: "plan" as const, color: "#a78bfa" };
  }
  if (thread.latestTurn?.state === "completed") {
    return { rank: "completed" as const, color: "#10b981" };
  }
  return null;
}

function estimateComposerTextareaHeight(input: {
  text: string;
  placeholder: string;
  totalColumns: number;
  sidebarWidth: number;
  showSidebar: boolean;
}): number {
  const mainColumns = input.totalColumns - input.sidebarWidth - (input.showSidebar ? 1 : 0);
  const composerInnerWidth = Math.max(24, mainColumns - 12);
  const content = input.text.length > 0 ? input.text : input.placeholder;
  const lines = content.split("\n").reduce((count, line) => {
    return count + Math.max(1, Math.ceil(Math.max(line.length, 1) / composerInnerWidth));
  }, 0);
  return Math.max(COMPOSER_TEXTAREA_MIN_HEIGHT, Math.min(COMPOSER_TEXTAREA_MAX_HEIGHT, lines));
}

function composerPlaceholder(input: {
  hasActiveThread: boolean;
  hasDraftThread: boolean;
  composerText: string;
  activePendingApproval: ReturnType<typeof derivePendingApprovals>[number] | null;
  activePendingUserInput: ReturnType<typeof derivePendingUserInputs>[number] | null;
}): string {
  if (input.activePendingApproval) {
    return input.activePendingApproval.detail
      ? "Resolve this approval request to continue"
      : "Resolve this approval request to continue";
  }
  if (input.activePendingUserInput) {
    return "Type your own answer, or leave this blank to use the selected option";
  }
  if (!input.hasActiveThread && input.composerText.length === 0) {
    return "Ask anything or @tag files/folders";
  }
  return "Ask anything or @tag files/folders";
}

function isClaudeSelection(
  modelSelection: ModelSelection | null,
  provider?: ServerProvider | null,
): boolean {
  return provider?.driver === "claudeAgent" || modelSelection?.instanceId === "claudeAgent";
}

function providerIcon(provider: string | null | undefined): string {
  return provider === "claudeAgent" ? "✱" : "󰚩";
}

function providerColor(provider: string | null | undefined, theme: TuiTheme): string {
  return provider === "claudeAgent" ? theme.palette.claude : theme.palette.muted;
}

function modelControlLabel(
  modelSelection: ModelSelection | null,
  provider?: ServerProvider | null,
): string {
  if (!modelSelection) return "No model";
  const model = displayText(modelSelection.model);
  if (!isClaudeSelection(modelSelection, provider)) {
    return model.replace(/^gpt-/i, "GPT-").replace(/-codex$/i, "");
  }
  return model
    .replace(/^claude-/i, "")
    .replace(/-/g, " ")
    .replace(/\b(\d)\s+(\d)\b/g, "$1.$2");
}

function composerTraitsLabel(
  modelSelection: ModelSelection | null,
  provider: ServerProvider | null,
  runtimeMode: RuntimeMode,
): string | null {
  if (isClaudeSelection(modelSelection, provider)) return "Thinking";
  if (runtimeMode === "full-access") return "High";
  if (runtimeMode === "auto-accept-edits") return "Medium";
  return "Low";
}

function composerTraitsIcon(
  modelSelection: ModelSelection | null,
  provider?: ServerProvider | null,
): string {
  return isClaudeSelection(modelSelection, provider) ? "󰚩" : "󰔟";
}

function interactionLabel(mode: ProviderInteractionMode): string {
  return mode === "plan" ? "Plan" : "Chat";
}

function interactionIcon(mode: ProviderInteractionMode): string {
  return mode === "plan" ? "󰨖" : "󰍩";
}

function runtimeFooterLabel(mode: RuntimeMode): string {
  switch (mode) {
    case "full-access":
      return "Full access";
    case "auto-accept-edits":
      return "Auto edits";
    case "approval-required":
      return "Approval";
  }
}

function runtimeFooterIcon(mode: RuntimeMode): string {
  switch (mode) {
    case "full-access":
      return "󰌾";
    case "auto-accept-edits":
      return "󰄬";
    case "approval-required":
      return "󰌍";
  }
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
  pendingProjectDraftByProjectId: {},
};
