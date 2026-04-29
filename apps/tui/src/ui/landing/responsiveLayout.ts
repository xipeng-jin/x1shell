export const X1SHELL_SIDEBAR_WIDTH = 34;

const SIDEBAR_TOGGLE_MAX_MAIN_COLUMNS = 56;
const SIDEBAR_FORCE_COLLAPSE_MAX_MAIN_COLUMNS = 44;
const COMPOSER_MODE_LABEL_MIN_MAIN_COLUMNS = 44;
const COMPOSER_MODEL_LABEL_MIN_MAIN_COLUMNS = 62;
const COMPOSER_RUNTIME_LABEL_MIN_MAIN_COLUMNS = 72;

export type X1ShellLandingLayout = Readonly<{
  showSidebarToggle: boolean;
  sidebarForcedCollapsed: boolean;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  showSidebar: boolean;
  showWindowDots: boolean;
  showSidebarAlphaBadge: boolean;
  sidebarTitle: string;
  showHeaderProjectBadge: boolean;
  showComposerModeLabels: boolean;
  showComposerModelLabel: boolean;
  showComposerRuntimeLabel: boolean;
  showComposerDividers: boolean;
}>;

export function resolveX1ShellLandingLayout(input: {
  readonly viewportColumns: number;
  readonly sidebarCollapsedPreference: boolean;
}): X1ShellLandingLayout {
  const openSidebarMainPanelColumns = input.viewportColumns - X1SHELL_SIDEBAR_WIDTH - 1;
  const showSidebarToggle =
    openSidebarMainPanelColumns <= SIDEBAR_TOGGLE_MAX_MAIN_COLUMNS ||
    input.sidebarCollapsedPreference;
  const sidebarForcedCollapsed =
    openSidebarMainPanelColumns <= SIDEBAR_FORCE_COLLAPSE_MAX_MAIN_COLUMNS;
  const sidebarCollapsed =
    sidebarForcedCollapsed || (showSidebarToggle && input.sidebarCollapsedPreference);
  const mainPanelColumns =
    input.viewportColumns -
    (sidebarCollapsed ? 0 : X1SHELL_SIDEBAR_WIDTH) -
    (sidebarCollapsed ? 0 : 1);
  const showComposerModeLabels = mainPanelColumns >= COMPOSER_MODE_LABEL_MIN_MAIN_COLUMNS;
  const showComposerModelLabel = mainPanelColumns >= COMPOSER_MODEL_LABEL_MIN_MAIN_COLUMNS;
  const showComposerRuntimeLabel = mainPanelColumns >= COMPOSER_RUNTIME_LABEL_MIN_MAIN_COLUMNS;

  return {
    showSidebarToggle,
    sidebarForcedCollapsed,
    sidebarCollapsed,
    sidebarWidth: sidebarCollapsed ? 0 : X1SHELL_SIDEBAR_WIDTH,
    showSidebar: !sidebarCollapsed,
    showWindowDots: !sidebarCollapsed,
    showSidebarAlphaBadge: !sidebarCollapsed,
    sidebarTitle: sidebarCollapsed ? "X1" : "X1Shell",
    showHeaderProjectBadge: input.viewportColumns >= 144,
    showComposerModeLabels,
    showComposerModelLabel,
    showComposerRuntimeLabel,
    showComposerDividers:
      showComposerModeLabels || showComposerModelLabel || showComposerRuntimeLabel,
  };
}
