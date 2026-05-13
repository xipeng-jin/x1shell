# X1Shell TUI Add Project Command Palette Parity Plan

## Summary

The X1Shell TUI sidebar `PROJECTS` `+` button currently starts new-thread/draft behavior. That is not aligned with current web/desktop behavior. The `+` button must open the command palette with an Add Project intent, then run the Add Project flow inside the palette:

1. Show a `Sources` view.
2. Let the user choose `Local folder`.
3. Browse/select a workspace path using server-backed filesystem browsing.
4. Reuse an existing project or create a new project, then open a new draft thread according to web parity.

This plan is intentionally TUI-local except for extracting pure project-path helpers into `packages/shared`. Do not copy legacy `t1code` backend/native flow, do not add multi-environment support, and do not add native folder picker or remote clone sources in this phase.

## Ground Truth References

- Web sidebar Add button calls `openAddProject`: `apps/web/src/components/Sidebar.tsx:2694`.
- Command palette open intent shape: `apps/web/src/commandPaletteStore.ts:23`.
- Web opens Add Project flow from `openIntent`: `apps/web/src/components/CommandPalette.tsx:974`.
- Web source selection view includes `Local folder`: `apps/web/src/components/CommandPalette.tsx:785`.
- Web remote clone sources are part of the flow but out of TUI scope: `apps/web/src/components/CommandPalette.tsx:805`.
- Web local browse starts with `startAddProjectBrowse`: `apps/web/src/components/CommandPalette.tsx:760`.
- Web browse item click calls `browseTo(entry.name)`: `apps/web/src/components/CommandPalette.logic.ts:308`.
- Web `browseTo` appends the path segment and trailing separator: `apps/web/src/components/CommandPalette.tsx:1306`.
- Web browse mode disables automatic highlighting: `apps/web/src/components/CommandPalette.tsx:1540`.
- Web Enter behavior for highlighted vs unhighlighted browse items: `apps/web/src/components/CommandPalette.tsx:1449`.
- Web browse filtering is prefix-based and hides dot dirs unless the filter starts with `.`: `apps/web/src/components/CommandPalette.logic.ts:64`.
- Web existing/new project behavior: `apps/web/src/components/CommandPalette.tsx:1106` and `apps/web/src/components/CommandPalette.tsx:1133`.
- Browser tests covering Add Project routes/drafts: `apps/web/src/components/ChatView.browser.tsx:4727`, `5101`, `5276`.

## Current TUI Root Cause

- `apps/tui/src/app/App.tsx` wires the sidebar project `+` action to `onCreateFirstProjectDraft`.
- `apps/tui/src/index.tsx` maps `onNewThread` to `orchestrationStore.createProjectDraft()`.
- The TUI already has a simple command palette, but it only handles global command actions. It has no open intent, view stack, Add Project source view, filesystem browse mode, or project creation path.
- The current TUI connection controller exposes orchestration dispatch and VCS/status methods, but not `filesystem.browse`.
- The current TUI command palette render path hard-limits displayed action rows with `slice(0, 10)`. Add Project browse must not inherit that fixed cap.
- The current TUI orchestration store is `apps/tui/src/state/orchestrationStore.ts`. Its `normalizeSelection` drops unknown `selectedProjectId` values, so a newly-created project draft cannot be represented until the store is adjusted for a pending project selection.

## Scope

### In Scope

- TUI sidebar `+` opens the TUI command palette in Add Project mode.
- TUI Add Project mode supports the single current server/environment only.
- TUI Add Project mode shows a `Sources` view first.
- The only enabled source in this phase is `Local folder`.
- TUI local folder browsing uses the current `filesystem.browse` WebSocket RPC through the active server connection.
- Existing project handling mirrors web behavior.
- New project handling mirrors web behavior, including opening a new draft thread after project creation.
- Focused tests and validation for TUI behavior and any shared helper extraction.

### Out of Scope

- Multi-environment selection before the source view.
- Git URL clone.
- GitHub/GitLab/Bitbucket/Azure DevOps source selection behavior.
- Desktop native folder picker affordance.
- Backend redesign, contract schema changes, auth changes, transport changes, or legacy `t1code` native/backend flow.
- Implementing Tab autocomplete. This is explicitly not part of the current scope.

## Implementation Plan

### 1. Add TUI Command Palette Open Intent

Introduce an App-local command palette intent equivalent to web's `openIntent: { kind: "add-project", requestId }`.

Implementation details:

- Keep this TUI-local in `App.tsx`; do not introduce Zustand or web store dependencies.
- Add these App state fields:
  - `visiblePanel: null | "palette" | ...`
  - `paletteIntent: null | { kind: "add-project"; requestId: number }`
  - Add Project palette state described below.
- Change `Sidebar` props:
  - Replace `onCreateFirstProjectDraft` for the project section `+` with `onOpenAddProject`.
  - Leave per-project new-thread action behavior unchanged if present elsewhere.
- Sidebar `+` handler:
  - set `focusArea` to `"timeline"` so the composer does not receive subsequent palette keystrokes,
  - close the sidebar overlay if open,
  - open command palette,
  - set Add Project intent.
- Add a `useEffect` that consumes `paletteIntent.kind === "add-project"`, clears the intent, resets Add Project palette state, and initializes the `Sources` view. This mirrors the web `openIntent` consumption pattern.

Acceptance criteria:

- Clicking sidebar `+` never calls `props.onNewThread`.
- Clicking sidebar `+` opens command palette content for Add Project.
- Existing normal command palette open behavior remains intact.

### 2. Add Palette View Model for Add Project

Extend the TUI command palette from a flat action list into a minimal view model that can represent root actions, Add Project source selection, and Add Project browse mode.

Use this view model shape, adjusted only for local naming/style:

```ts
type TuiPaletteMode = "actions" | "add-project-sources" | "add-project-browse";

type TuiPaletteItem =
  | {
      readonly kind: "action";
      readonly id: TuiActionId;
      readonly title: string;
      readonly description?: string;
      readonly disabled?: boolean;
    }
  | {
      readonly kind: "add-project-source";
      readonly source: "local";
      readonly title: "Local folder";
      readonly description: "Browse a folder on disk";
    }
  | {
      readonly kind: "browse-directory";
      readonly name: string;
      readonly fullPath: string;
    }
  | {
      readonly kind: "browse-up";
    };
```

Implementation details:

- The TUI palette should render these title/header strings:
  - `Command Palette` for normal actions,
  - `Add project` for source selection,
  - `Add project / Local folder` for browse mode.
- Source selection mode:
  - Group label: `Sources`.
  - Enabled item: `Local folder`, description `Browse a folder on disk`.
  - Do not render Git URL, GitHub, GitLab, Bitbucket, or Azure DevOps items in this phase. Do not render disabled placeholders for them.
- Pressing/clicking `Local folder` starts browse mode with the default initial query.
- Default initial query:
  - read `serverStatus.config?.settings.addProjectBaseDirectory?.trim()`;
  - if non-empty, use `ensureBrowseDirectoryPath(baseDirectory)`;
  - if empty or config is unavailable, use `~/`.
- Do not call `server.discoverSourceControl` or any source-control provider readiness flow in TUI Add Project. Remote sources are out of scope, so the TUI `Sources` view is static for this phase.
- Browse mode:
  - Render the path query as the input line.
  - Render directory items below.
  - Render browse-up item only when the helper says navigating up is valid.
  - No automatic highlighted item when browse mode starts or query changes.
- Represent browse highlighting as nullable state, for example `highlightedItemValue: string | null`, not as a numeric index that defaults to `0`. This avoids accidentally reintroducing auto-highlight.
- Keep normal command-palette action selection separate from Add Project browse highlighting:
  - normal action mode may continue to use the existing selected-index behavior;
  - Add Project source mode may highlight `Local folder`;
  - Add Project browse mode starts with `highlightedItemValue: null`.
- Treat the local-folder view as browse-capable only while `isFilesystemBrowseQuery(query, browsePlatform)` is true. If the user deletes the query to empty, return to `Sources` like web. If the user enters a bare non-browse value such as `repo`, do not submit it from the browse view; web only submits while `canSubmitBrowsePath` is true.

Acceptance criteria:

- Add Project source selection appears before filesystem browsing.
- The only source shown is `Local folder`.
- Normal palette actions still work.

### 3. Extract Pure Project Path Helpers

The TUI should use the same path semantics as web. Extract the pure helpers from `apps/web/src/lib/projectPaths.ts` into `packages/shared/src/projectPaths.ts` with an explicit subpath export, then update web and TUI imports.

Helpers needed:

- `appendBrowsePathSegment`
- `canNavigateUp`
- `ensureBrowseDirectoryPath`
- `findProjectByPath`
- `getBrowseDirectoryPath`
- `getBrowseLeafPathSegment`
- `getBrowseParentPath`
- `hasTrailingPathSeparator`
- `inferProjectTitleFromPath`
- `isExplicitRelativeProjectPath`
- `isFilesystemBrowseQuery`
- `isUnsupportedWindowsProjectPath`
- `normalizeProjectPathForComparison`
- `normalizeProjectPathForDispatch`
- `resolveProjectPathForDispatch`

Implementation constraints:

- Preserve current web behavior and tests exactly.
- Remove the web-only dependency on `apps/web/src/lib/utils.isWindowsPlatform` during extraction by implementing the same small platform predicate inside the shared helper module.
- Internal imports in `packages/shared/src/projectPaths.ts` should import sibling helpers directly, for example from `./path`, not through a package subpath.
- Keep the package role rule: `packages/contracts` remains schema-only; runtime helpers belong in `packages/shared`.
- Preserve explicit subpath exports. Do not add a barrel index.
- Do not create a TUI-local fork of these helpers. The goal is to prevent web/TUI drift for path browsing and project matching.
- `findProjectByPath` currently expects objects with `cwd`. Preserve that API for web. In TUI, either map shell projects to `{ cwd: project.workspaceRoot, project }` before calling it or add a backwards-compatible overload/path-selector with tests. Do not call it directly on `OrchestrationProjectShell[]` unless the helper signature is updated to support `workspaceRoot`.

Acceptance criteria:

- Existing web `projectPaths` tests still pass.
- TUI path helper tests cover the same browse semantics used by the Add Project flow.

### 4. Expose Filesystem Browse Through TUI Runtime

Extend the TUI connection controller and App props with server-backed filesystem browsing.

Implementation details:

- In `apps/tui/src/runtime/connection.ts`, add:
  - `browseFilesystem: WsRpcClient["filesystem"]["browse"]`
  - implementation calls `current.client.filesystem.browse(input)`.
  - if not connected, reject with `new Error("Not connected.")`, matching other controller methods.
- In `apps/tui/src/index.tsx`, pass:
  - `onBrowseFilesystem={(input) => controller?.browseFilesystem(input) ?? Promise.reject(...)}`
- In `App.tsx`, call `props.onBrowseFilesystem` only from browse mode.

Browse request behavior:

- Determine `isBrowsing` with `isFilesystemBrowseQuery(query, platform)`.
- Platform source:
  - use `serverStatus.config?.environment.platform.os`,
  - match web's platform strings for helper checks: `darwin` -> `MacIntel`, `linux` -> `Linux`,
  - the current `ExecutionEnvironmentPlatformOs` contract only exposes `darwin` and `linux`; if a future Windows value is added, map it to `Win32`. Until then, Windows absolute paths remain unsupported in TUI against the current contracts.
- Determine `browseDirectoryPath` using `getBrowseDirectoryPath(query)`.
- Determine `browseFilterQuery` using `getBrowseLeafPathSegment(query)` when query has no trailing separator.
- Call `filesystem.browse({ partialPath: browseDirectoryPath, cwd })`.
- Match web request shape: include `cwd` whenever there is an active project workspace root for the current server/environment, not only for explicit relative inputs. If there is no active project and the query is an explicit relative path, show a sanitized error equivalent to web's relative-path requirement and do not browse.
- Do not call `filesystem.browse` when `isFilesystemBrowseQuery` is false, when `browseDirectoryPath` is empty, or when the explicit-relative-path rule fails.
- Debounce browse calls by 80 ms to avoid request storms while typing.
- Guard stale async responses with a request generation id so slow browse results do not overwrite newer query results.

Acceptance criteria:

- Browse suggestions come from the active server, not from local Node filesystem reads in the renderer.
- Browse failures are shown as sanitized palette errors and do not close the palette.
- Stale browse responses are ignored.

### 5. Implement Exact Browse Filtering and Highlighting Semantics

Filter browse entries exactly like web:

```ts
const lowerFilter = browseFilterQuery.toLowerCase();
const showHidden = browseFilterQuery.startsWith(".");

const filteredEntries = browseEntries.filter(
  (entry) =>
    entry.name.toLowerCase().startsWith(lowerFilter) &&
    (showHidden || !entry.name.startsWith(".")),
);
```

Highlight behavior:

- Browse mode must not auto-highlight the first directory item.
- Store highlight by item value/path, not by array index, so filtering or fresh browse results cannot accidentally move highlight to a different directory.
- Query changes must clear highlighted item.
- `browseTo` and `browseUp` must clear highlighted item.
- Arrow up/down should move highlight manually through rendered browse items.
- Mouse hover should set highlight to the hovered row for visual feedback, but it must not submit automatically.

No result limit:

- Do not add an artificial fixed result limit in filtering.
- Do not reuse the current `slice(0, 10)` action rendering cap for browse results.
- Render browse results with a viewport/window derived from the available palette height, and keep enough scroll state to make manually highlighted rows visible as the user moves with arrow keys. The full filtered result set remains navigable even though only the terminal-visible window is rendered.

Acceptance criteria:

- Typing `src` shows entries whose names start with `src`, not arbitrary substring matches.
- Dot directories are hidden unless the filter starts with `.`.
- No item is selected automatically when browse results appear.

### 6. Implement Exact Browse Item Click and Keyboard Semantics

Directory item click:

- Must call `browseTo(entry.name)`.
- Must not merely autocomplete/fill the input.
- `browseTo` must use `appendBrowsePathSegment(query, entry.name)`, which appends the directory name plus a trailing path separator and triggers a new browse generation.

Browse-up item click:

- Must call `browseUp()`.
- `browseUp` uses `getBrowseParentPath(query)`.
- Show the browse-up item using the web condition: `canNavigateUp(browseDirectoryPath)`, where `browseDirectoryPath = getBrowseDirectoryPath(query)`. The action itself still calls `getBrowseParentPath(query)`.

Enter behavior:

- Enter submit/navigation behavior only applies when `isFilesystemBrowseQuery(query, browsePlatform)` is true and the relative-path rule has passed.
- If browse mode has no highlighted browse item:
  - `Enter` submits/adds the current resolved Add Project path.
- If a directory item is highlighted:
  - `Enter` executes that item, which navigates into the directory.
- If a directory item is highlighted:
  - `Ctrl+Enter` on Linux/Windows or `Meta+Enter` on macOS submits the current resolved path instead.
- If browse-up is highlighted:
  - `Enter` navigates up.
  - modified Enter submits the current resolved path.

Tab behavior:

- Do not implement Tab autocomplete in this phase.
- Inside Add Project source or browse mode, handle Tab as a no-op and return from the keyboard handler so it cannot mutate the query or leak into composer/global shortcuts.
- Outside the command palette, preserve existing Tab behavior.

Primary modifier:

- Choose the primary modified-Enter key from the TUI host platform (`process.platform`), not from the server filesystem platform. Use `Meta+Enter` on `darwin`; use `Ctrl+Enter` everywhere else.

Other keys:

- `Esc` closes the palette from any Add Project view.
- `Backspace` edits query in browse mode.
- In Add Project browse mode, `Backspace` with an empty query returns to the Add Project `Sources` view.
- In Add Project source mode, `Backspace` is a no-op. Use `Esc` to close the palette.
- Do not let Backspace trigger new-thread behavior.
- If the user reaches a non-empty query that is not a filesystem browse query, keep the Add Project local-folder view open but show no directory results and do not submit on Enter. This matches the web distinction between `submenu` and `submenu-browse`.

Acceptance criteria:

- Clicking a directory drills into it.
- `Enter` with manual highlight drills into the highlighted directory.
- `Enter` with no highlight submits the current path only when the query is in filesystem-browse mode.
- `Ctrl+Enter`/`Meta+Enter` submits the current path even with a highlighted directory.
- Tab does not autocomplete.

Resolved Add Project path:

- Use the same resolution rule as web before submit:
  - if the query has a trailing path separator, use `browseResult.parentPath` when available, otherwise `query.trim()`;
  - otherwise, use the exact filtered browse entry's `fullPath` when the leaf exactly matches an entry name, otherwise `query.trim()`.
- Then pass that value through `resolveProjectPathForDispatch(rawCwd, currentProjectCwdForBrowse)` during submit validation.

### 7. Implement Add Project Submit Behavior

Create focused command helpers in `apps/tui/src/domain/commands.ts`:

- `newProjectId(): ProjectId`
- `buildProjectCreate(input): Extract<ClientOrchestrationCommand, { type: "project.create" }>`
- Implement `newProjectId` with `ProjectId.make(randomUUID())`, matching the web helper branding behavior.

Project create command fields must match web defaults:

```ts
{
  type: "project.create",
  commandId: newCommandId(),
  projectId,
  title: inferProjectTitleFromPath(cwd),
  workspaceRoot: cwd,
  createWorkspaceRootIfMissing: true,
  defaultModelSelection: {
    instanceId: ProviderInstanceId.make("codex"),
    model: DEFAULT_MODEL,
  },
  createdAt: new Date().toISOString(),
}
```

Important:

- Do not use current composer model selection as the project default model selection.
- Use `DEFAULT_MODEL` and `ProviderInstanceId.make("codex")` exactly as web does.

Submit resolution:

- Resolve the current input path with `resolveProjectPathForDispatch(rawCwd, currentProjectCwdForBrowse)`.
- Reject unsupported Windows paths when the current server platform is not Windows, matching web semantics.
- Reject explicit relative paths when there is no active project workspace root.
- If the resolved path is empty, do nothing.

Existing project behavior:

- Find existing project by normalized workspace root among current TUI shell projects.
- Because TUI project shells use `workspaceRoot` while the web helper uses `cwd`, use the shared helper through an adapter or tested overload as described in Section 3.
- If existing project has a latest thread:
  - select that latest thread via `props.onSelectThread`.
  - close the palette.
- If existing project has no thread:
  - create/open a draft thread for that project via `props.onCreateProjectDraft`.
  - close the palette.

Latest thread selection:

- Use the same ordering the current TUI sidebar uses for visible threads, so the selected thread is the latest thread as the TUI presents it today.
- Do not introduce web client settings plumbing solely to access `sidebarThreadSortOrder` in this phase. Current `ServerConfig.settings` is server settings and does not expose the web client's sidebar sort preference.

New project behavior:

- Generate `projectId`.
- Dispatch `project.create`.
- After dispatch resolves, open a new draft thread for the generated project id. If the shell stream has already hydrated the project, the existing known-project draft path may be used. Otherwise, use the pending-project draft path below. Do not mark the project as pending before `project.create` succeeds.
- Store change:
  - in `apps/tui/src/state/orchestrationStore.ts`, add a dedicated `createPendingProjectDraft({ projectId, workspaceRoot, title })` action;
  - add pending draft metadata such as `pendingProjectDraftByProjectId: Readonly<Record<string, { readonly workspaceRoot: string; readonly title: string }>>`;
  - set `selectedProjectId` to the generated id and `selectedThreadId` to `null` without requiring the project shell to already exist;
  - update `normalizeSelection` so a `selectedProjectId` present in `pendingProjectDraftByProjectId` is treated as a valid draft selection while `selectedThreadId` is `null`;
  - remove the pending metadata when a `project-upserted` event or a fresh snapshot contains the real project id, and also remove it if that project is removed;
  - keep the existing guarded `createProjectDraft(projectId)` behavior for known project-only callers.
- Close the palette.
- The shell stream will later hydrate the project row. Do not forge a fake `OrchestrationProjectShell`; the pending state is UI/draft metadata only.
- App behavior while pending:
  - use pending metadata only to keep the draft open and show a sensible draft title/path;
  - do not build or dispatch `thread.turn.start` until the real `OrchestrationProjectShell` exists, because `buildNewThreadTurnStart` needs canonical project fields from the server-backed shell.
- Wire this through `apps/tui/src/index.tsx` with an explicit callback such as `onCreatePendingProjectDraft`, and set the active thread to `null` just like existing draft creation.

Error behavior:

- Show sanitized error text in the palette.
- Keep the palette open after submit errors.
- Do not leak raw control sequences, tokens, server URLs, or unsafe path text.

Acceptance criteria:

- Existing project with latest thread navigates to that thread.
- Existing project with no threads opens a new draft thread for that project.
- New project dispatches `project.create` with web-equivalent default model selection, then opens a draft thread for the generated project id.
- Pending project selection is not normalized back to the first existing project, pending metadata is cleared when the real project shell arrives, and message submit waits for a real `OrchestrationProjectShell`.

### 8. Preserve Terminal Safety and Canonical State Correctness

- Keep raw contract values in orchestration reducers and command builders.
- Sanitize only render-facing strings through existing adapters such as `displayText`.
- Do not sanitize `workspaceRoot` before command dispatch except for intended path normalization/resolution.
- Do not use `appendPaletteQuery` for Add Project path input. It calls `displayText`, which redacts and can mutate valid path text before dispatch.
- Keep a raw Add Project path query state for command input and RPC calls. On key input, strip terminal control sequences with a non-redacting control sanitizer such as `sanitizeText`, drop line breaks so the path input remains single-line, cap the raw query at the filesystem contract limit of 512 characters, and render it through `displayText` only at the final UI boundary.
- Do not put raw browse errors, paths containing control sequences, or tokens directly into `<text>`.
- Keep async action failures contained through the existing `runAsyncAction` pattern for submit actions. For browse failures, catch the rejection in the browse effect, ignore stale failures by generation id, and store only `displayText(errorMessage)` in palette-local error state.

## Testing Plan

### Unit Tests

Add or update focused tests for:

- Shared/project path helper extraction:
  - preserve current `apps/web/src/lib/projectPaths.test.ts` behavior,
  - add TUI-facing tests for the shared helper entrypoint used by the TUI.
- Browse filtering:
  - prefix matching,
  - hide dot directories unless query starts with `.`,
  - no fixed result limit.
- Browse behavior helpers:
  - `browseTo` appends segment plus trailing separator,
  - `browseUp` uses parent path,
  - query changes clear highlighted item,
  - no auto-highlight in browse mode.
- Add Project path query input:
  - strips terminal control sequences,
  - does not redact or otherwise mutate canonical path text before browse/submit,
  - caps the raw query at 512 characters.
- Command builders:
  - `buildProjectCreate` uses `ProviderInstanceId.make("codex")`,
  - `buildProjectCreate` uses `DEFAULT_MODEL`,
  - `createWorkspaceRootIfMissing: true`,
  - title comes from `inferProjectTitleFromPath`.

### App/Interaction Tests

Add tests around TUI App-level handlers where practical:

- Sidebar `+` opens Add Project command palette and does not call `onNewThread`.
- Add Project first view is `Sources`, with `Local folder` and no remote clone source items.
- Choosing `Local folder` opens browse mode with:
  - settings `addProjectBaseDirectory` plus trailing separator when configured,
  - fallback `~/` otherwise.
- Browse mode:
  - no item is auto-highlighted,
  - browse rows are not capped by the current `slice(0, 10)` action-list limit,
  - arrow navigation can reach rows outside the initially visible terminal window,
  - clicking/Enter on a highlighted directory navigates into it,
  - Enter with no highlight submits only for filesystem-browse queries,
  - Ctrl/Meta+Enter submits with highlight,
  - Tab does not autocomplete.
- Existing project:
  - selects latest thread if one exists,
  - opens draft thread if no thread exists.
- New project:
  - dispatches `project.create`,
  - opens draft thread for generated project id after dispatch.
- Pending project draft state:
  - unknown pending project ids are not normalized away,
  - pending metadata is cleared on shell hydration,
  - message submit is not dispatched until a real project shell exists.
- Error text is sanitized.

Do not add new headless frame snapshots for this feature. Cover palette navigation with pure state-machine/App tests to avoid brittle terminal snapshots.

## Validation Commands

Run targeted validation first:

```sh
bun run --filter @x1shell/tui typecheck
(cd apps/tui && bun run test)
bun run --filter @x1shell/tui build
```

Because shared helpers and web imports will change, run broader validation before completion:

```sh
bun fmt
bun lint
bun typecheck
bun run test
```

Per repository instruction, do not run `bun test`.

## Implementation Order

Follow the same order as the numbered Implementation Plan sections above, with tests added alongside the behavior they cover:

1. **Section 1: Add TUI Command Palette Open Intent**
   - Rewire the sidebar `PROJECTS` `+` action from new-thread behavior to an Add Project command-palette intent.
   - Add the focused regression that proves the sidebar `+` does not call `onNewThread`.

2. **Section 2: Add Palette View Model for Add Project**
   - Extend the TUI command palette model/rendering to support normal actions, Add Project `Sources`, and Add Project local-browse views.
   - Add tests that the first Add Project view is `Sources`, contains `Local folder`, and omits remote clone sources.

3. **Section 3: Extract Pure Project Path Helpers**
   - Extract the web path helpers to `@t3tools/shared/projectPaths`.
   - Preserve web tests and add helper coverage for browse path construction, path resolution, and project-path matching.

4. **Section 4: Expose Filesystem Browse Through TUI Runtime**
   - Add `browseFilesystem` to the TUI connection controller and pass it into `App`.
   - Add runtime/controller tests for the connected and not-connected browse cases.

5. **Sections 5 and 6: Implement Browse Filtering, Highlighting, Click, and Keyboard Semantics**
   - Wire server browse results into the Add Project local-browse view.
   - Implement exact prefix filtering, hidden-directory filtering, no auto-highlight, `browseTo`, `browseUp`, Enter, modified Enter, and no Tab autocomplete.
   - Add focused tests for all browse semantics before moving to submit behavior.

6. **Section 7: Implement Add Project Submit Behavior**
   - Add `newProjectId` and `buildProjectCreate`.
   - Implement unsupported-path, relative-path, existing-project, and new-project submit branches.
   - Add pending project draft support in `apps/tui/src/state/orchestrationStore.ts` before wiring the new-project branch.
   - Add tests for web-equivalent default model selection, latest-thread navigation, draft creation for project-without-thread, pending draft creation after new project dispatch, and pending cleanup on shell hydration.

7. **Section 8: Preserve Terminal Safety and Canonical State Correctness**
   - Audit render paths and async error handling for display sanitization.
   - Add or update tests for sanitized browse/submit errors if existing coverage does not already exercise the new palette paths.

8. **Validation**
   - Run the targeted TUI validation commands.
   - Run broad repo validation because shared helpers and web imports will change.

## Non-Goals and Guardrails

- Do not implement Git URL or hosted source clone in TUI.
- Do not implement native folder picker.
- Do not implement Tab autocomplete.
- Do not support multiple environments in TUI Add Project yet.
- Do not change server-side project creation semantics.
- Do not change web/desktop behavior except for import paths if pure helper extraction is performed.
- Do not commit changes unless explicitly requested.
