import type {
  ModelSelection,
  OrchestrationProjectShell,
  OrchestrationShellSnapshot,
  OrchestrationShellStreamItem,
  OrchestrationThreadShell,
  ProviderInteractionMode,
  ProjectId,
  RuntimeMode,
  ThreadId,
  UploadChatAttachment,
} from "@t3tools/contracts";

export interface TuiDraftContext {
  readonly modelSelection?: ModelSelection;
  readonly runtimeMode?: RuntimeMode;
  readonly interactionMode?: ProviderInteractionMode;
}

export interface TuiShellState {
  readonly projects: ReadonlyArray<OrchestrationProjectShell>;
  readonly threads: ReadonlyArray<OrchestrationThreadShell>;
  readonly updatedAt: string | null;
  readonly lastAppliedSequence: number;
  readonly selectedProjectId: ProjectId | null;
  readonly selectedThreadId: ThreadId | null;
  readonly draftByProjectId: Readonly<Record<string, string>>;
  readonly draftContextByProjectId: Readonly<Record<string, TuiDraftContext>>;
  readonly draftAttachmentsByProjectId: Readonly<Record<string, readonly UploadChatAttachment[]>>;
  readonly pendingDraftThreadIdByProjectId: Readonly<Record<string, ThreadId>>;
}

export type TuiShellListener = (state: TuiShellState) => void;

export function createOrchestrationStore(initial?: Partial<TuiShellState>) {
  let state: TuiShellState = {
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
    ...initial,
  };
  const listeners = new Set<TuiShellListener>();

  const emit = () => {
    for (const listener of listeners) listener(state);
  };

  const setState = (next: TuiShellState) => {
    const normalized = normalizeSelection(next);
    if (normalized === state) return;
    state = normalized;
    emit();
  };

  return {
    getSnapshot: () => state,
    subscribe: (listener: TuiShellListener) => {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    applyShellItem: (item: OrchestrationShellStreamItem) => {
      const next = applyShellItem(state, item);
      if (next !== state) setState(next);
    },
    applyShellItems: (items: readonly OrchestrationShellStreamItem[]) => {
      let next = state;
      for (const item of items) {
        next = applyShellItem(next, item);
      }
      if (next !== state) setState(next);
    },
    selectThread: (threadId: ThreadId) => {
      const thread = state.threads.find((entry) => entry.id === threadId);
      if (!thread) return;
      setState({ ...state, selectedProjectId: thread.projectId, selectedThreadId: thread.id });
    },
    selectProject: (projectId: ProjectId) => {
      const project = state.projects.find((entry) => entry.id === projectId);
      if (!project) return;
      setState({ ...state, selectedProjectId: project.id, selectedThreadId: null });
    },
    selectNextThread: (direction: 1 | -1) => {
      const visible = visibleThreads(state);
      if (visible.length === 0) return;
      const currentIndex = state.selectedThreadId
        ? visible.findIndex((thread) => thread.id === state.selectedThreadId)
        : -1;
      const nextIndex =
        currentIndex < 0 ? 0 : (currentIndex + direction + visible.length) % visible.length;
      const thread = visible[nextIndex]!;
      setState({ ...state, selectedProjectId: thread.projectId, selectedThreadId: thread.id });
    },
    createProjectDraft: (projectId?: ProjectId | null) => {
      const selectedProjectId =
        projectId ?? state.selectedProjectId ?? state.projects[0]?.id ?? null;
      if (!selectedProjectId) return;
      setState({ ...state, selectedProjectId, selectedThreadId: null });
    },
    promoteProjectDraft: (projectId: ProjectId, threadId: ThreadId) => {
      const threadExists = state.threads.some((thread) => thread.id === threadId);
      const pendingDraftThreadIdByProjectId = threadExists
        ? omitRecordKey(state.pendingDraftThreadIdByProjectId, projectId)
        : { ...state.pendingDraftThreadIdByProjectId, [projectId]: threadId };
      setState({
        ...state,
        selectedProjectId: projectId,
        selectedThreadId: threadId,
        pendingDraftThreadIdByProjectId,
      });
    },
    setDraft: (projectId: ProjectId, draft: string) => {
      setState({
        ...state,
        draftByProjectId: { ...state.draftByProjectId, [projectId]: draft },
      });
    },
    clearDraft: (projectId: ProjectId) => {
      const { [projectId]: _removed, ...rest } = state.draftByProjectId;
      setState({ ...state, draftByProjectId: rest });
    },
    setDraftContext: (projectId: ProjectId, context: TuiDraftContext) => {
      setState({
        ...state,
        draftContextByProjectId: { ...state.draftContextByProjectId, [projectId]: context },
      });
    },
    setDraftAttachments: (projectId: ProjectId, attachments: readonly UploadChatAttachment[]) => {
      setState({
        ...state,
        draftAttachmentsByProjectId: {
          ...state.draftAttachmentsByProjectId,
          [projectId]: attachments,
        },
      });
    },
    clearDraftAttachments: (projectId: ProjectId) => {
      setState({
        ...state,
        draftAttachmentsByProjectId: omitRecordKey(state.draftAttachmentsByProjectId, projectId),
      });
    },
  };
}

export function applyShellItem(
  state: TuiShellState,
  item: OrchestrationShellStreamItem,
): TuiShellState {
  if (item.kind === "snapshot") {
    if (item.snapshot.snapshotSequence < state.lastAppliedSequence) {
      return state;
    }
    return fromShellSnapshot(item.snapshot, state);
  }
  if (item.sequence <= state.lastAppliedSequence) {
    return state;
  }
  if (item.kind === "project-upserted") {
    return {
      ...state,
      lastAppliedSequence: item.sequence,
      projects: upsertById(state.projects, item.project),
      updatedAt: item.project.updatedAt,
    };
  }
  if (item.kind === "project-removed") {
    const { [item.projectId]: _removedDraft, ...draftByProjectId } = state.draftByProjectId;
    return {
      ...state,
      lastAppliedSequence: item.sequence,
      projects: state.projects.filter((project) => project.id !== item.projectId),
      threads: state.threads.filter((thread) => thread.projectId !== item.projectId),
      draftByProjectId,
      draftContextByProjectId: omitRecordKey(state.draftContextByProjectId, item.projectId),
      draftAttachmentsByProjectId: omitRecordKey(state.draftAttachmentsByProjectId, item.projectId),
      pendingDraftThreadIdByProjectId: omitRecordKey(
        state.pendingDraftThreadIdByProjectId,
        item.projectId,
      ),
    };
  }
  if (item.kind === "thread-upserted") {
    const selectedProjectId = state.selectedProjectId ?? item.thread.projectId;
    const pendingThreadId = state.pendingDraftThreadIdByProjectId[item.thread.projectId] ?? null;
    const resolvesPendingThread = pendingThreadId === item.thread.id;
    return {
      ...state,
      lastAppliedSequence: item.sequence,
      threads: upsertById(state.threads, item.thread),
      selectedProjectId,
      selectedThreadId:
        pendingThreadId === item.thread.id
          ? item.thread.id
          : state.selectedThreadId === item.thread.id
            ? item.thread.id
            : state.pendingDraftThreadIdByProjectId[selectedProjectId] === state.selectedThreadId
              ? state.selectedThreadId
              : state.selectedProjectId && state.selectedThreadId === null
                ? null
                : (state.selectedThreadId ?? item.thread.id),
      pendingDraftThreadIdByProjectId: resolvesPendingThread
        ? omitRecordKey(state.pendingDraftThreadIdByProjectId, item.thread.projectId)
        : state.pendingDraftThreadIdByProjectId,
      updatedAt: item.thread.updatedAt,
    };
  }
  const removedThread = state.threads.find((thread) => thread.id === item.threadId);
  return {
    ...state,
    lastAppliedSequence: item.sequence,
    threads: state.threads.filter((thread) => thread.id !== item.threadId),
    pendingDraftThreadIdByProjectId: removedThread
      ? omitRecordKey(state.pendingDraftThreadIdByProjectId, removedThread.projectId)
      : state.pendingDraftThreadIdByProjectId,
  };
}

export function fromShellSnapshot(
  snapshot: OrchestrationShellSnapshot,
  previous?: Pick<
    TuiShellState,
    | "draftByProjectId"
    | "draftContextByProjectId"
    | "draftAttachmentsByProjectId"
    | "pendingDraftThreadIdByProjectId"
    | "selectedProjectId"
    | "selectedThreadId"
  >,
): TuiShellState {
  return normalizeSelection({
    projects: snapshot.projects,
    threads: snapshot.threads,
    updatedAt: snapshot.updatedAt,
    lastAppliedSequence: snapshot.snapshotSequence,
    selectedProjectId: previous?.selectedProjectId ?? snapshot.projects[0]?.id ?? null,
    selectedThreadId: previous?.selectedThreadId ?? snapshot.threads[0]?.id ?? null,
    draftByProjectId: previous?.draftByProjectId ?? {},
    draftContextByProjectId: previous?.draftContextByProjectId ?? {},
    draftAttachmentsByProjectId: previous?.draftAttachmentsByProjectId ?? {},
    pendingDraftThreadIdByProjectId: previous?.pendingDraftThreadIdByProjectId ?? {},
  });
}

function normalizeSelection(state: TuiShellState): TuiShellState {
  const selectedThread = state.selectedThreadId
    ? state.threads.find((thread) => thread.id === state.selectedThreadId)
    : null;
  if (selectedThread) {
    return { ...state, selectedProjectId: selectedThread.projectId };
  }
  const selectedProject = state.selectedProjectId
    ? state.projects.find((project) => project.id === state.selectedProjectId)
    : null;
  const pendingSelectedThread =
    selectedProject && state.selectedThreadId
      ? state.pendingDraftThreadIdByProjectId[selectedProject.id] === state.selectedThreadId
      : false;
  if (pendingSelectedThread) {
    return state;
  }
  if (selectedProject && state.selectedThreadId === null) {
    return state;
  }
  const projectId = selectedProject?.id ?? state.projects[0]?.id ?? null;
  const fallbackThread = projectId
    ? visibleThreads({ ...state, selectedProjectId: projectId }).find(
        (thread) => thread.projectId === projectId,
      )
    : state.threads.find((thread) => !thread.archivedAt);
  return {
    ...state,
    selectedProjectId: projectId,
    selectedThreadId: fallbackThread?.id ?? null,
  };
}

function visibleThreads(state: TuiShellState): ReadonlyArray<OrchestrationThreadShell> {
  const projectId = state.selectedProjectId;
  return state.threads.filter(
    (thread) => !thread.archivedAt && (!projectId || thread.projectId === projectId),
  );
}

function upsertById<T extends { readonly id: string; readonly updatedAt: string }>(
  values: readonly T[],
  value: T,
): T[] {
  const existing = values.find((entry) => entry.id === value.id);
  if (existing && structuralEqual(existing, value)) return values as T[];
  const next = values.filter((entry) => entry.id !== value.id);
  next.push(value);
  return next.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function structuralEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  return JSON.stringify(left) === JSON.stringify(right);
}

function omitRecordKey<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}
