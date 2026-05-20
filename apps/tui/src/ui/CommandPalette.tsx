import { createMemo, type JSX } from "solid-js";
import { formatActionKeys } from "../domain/keybindings.js";
import { browseItemValue } from "../app/filesystemBrowse.js";
import type { TuiPaletteItem, TuiPaletteViewModel } from "../app/paletteViewModel.js";
import { selectedListItemForeground, type TuiTheme } from "../terminal/theme.js";
import { displayText } from "../domain/display.js";

export function CommandPalette(props: {
  readonly view: TuiPaletteViewModel;
  readonly onSelectItem?: (item: TuiPaletteItem) => void;
  readonly onHighlightItem?: (item: TuiPaletteItem) => void;
  readonly selectedIndex: number;
  readonly highlightedItemValue?: string | null;
  readonly theme: TuiTheme;
}): JSX.Element {
  const colors = createMemo(() => resolvePaletteColors(props.theme));
  const query = () => (props.view.query.length > 0 ? `${displayText(props.view.query)}█` : "");

  return (
    <box
      width="100%"
      flexDirection="column"
      border={["left"]}
      borderColor={props.theme.palette.accent}
      backgroundColor={colors().surface}
    >
      <box height={1} backgroundColor={colors().surface} />
      <box
        height={1}
        paddingLeft={2}
        paddingRight={2}
        flexDirection="row"
        gap={1}
        backgroundColor={colors().surface}
      >
        <text fg={colors().text} attributes={1}>
          {props.view.title}
        </text>
        <box flexGrow={1} />
        <text fg={colors().muted}>esc</text>
      </box>
      <box height={1} backgroundColor={colors().surface} />
      <box height={1} paddingLeft={2} paddingRight={2} backgroundColor={colors().surface}>
        <text fg={colors().muted}>{query()}</text>
      </box>
      <box height={1} backgroundColor={colors().surface} />
      <box flexGrow={1} flexDirection="column" backgroundColor={colors().surface}>
        {props.view.mode === "add-project-sources" ? (
          <>
            {props.view.groupLabel ? (
              <box height={1} paddingLeft={2} paddingRight={2} backgroundColor={colors().surface}>
                <text fg={colors().group} attributes={1}>
                  {props.view.groupLabel}
                </text>
              </box>
            ) : null}
            {props.view.items.map((item, index) =>
              item.kind === "add-project-source"
                ? paletteRow({
                    active: index === props.selectedIndex,
                    title: item.title,
                    description: item.description,
                    colors: colors(),
                    onMouseDown: () => props.onSelectItem?.(item),
                  })
                : null,
            )}
          </>
        ) : props.view.mode === "add-project-browse" ? (
          <>
            {props.view.error ? (
              <box height={1} paddingLeft={2} paddingRight={2} backgroundColor={colors().surface}>
                <text fg={props.theme.palette.danger}>{displayText(props.view.error)}</text>
              </box>
            ) : null}
            {props.view.loading ? (
              <box height={1} paddingLeft={2} paddingRight={2} backgroundColor={colors().surface}>
                <text fg={colors().muted}>Browsing filesystem...</text>
              </box>
            ) : null}
            {props.view.items.map((item) => {
              if (!isBrowseItem(item)) return null;
              const value = browseItemValue(item);
              return paletteRow({
                active: value === (props.highlightedItemValue ?? null),
                title: displayText(item.kind === "browse-up" ? ".." : item.name),
                colors: colors(),
                onMouseOver: () => props.onHighlightItem?.(item),
                onMouseDown: () => props.onSelectItem?.(item),
              });
            })}
            {props.view.items.length === 0 && !props.view.loading && !props.view.error ? (
              <box height={1} paddingLeft={2} paddingRight={2} backgroundColor={colors().surface}>
                <text fg={colors().muted}>No directories found.</text>
              </box>
            ) : null}
          </>
        ) : props.view.mode === "themes" ? (
          <>
            {props.view.items.map((item, index) =>
              item.kind === "theme"
                ? paletteRow({
                    active: index === props.selectedIndex,
                    current: item.selected,
                    title: item.title,
                    colors: colors(),
                    onMouseOver: () => props.onHighlightItem?.(item),
                    onMouseDown: () => props.onSelectItem?.(item),
                  })
                : null,
            )}
            {props.view.items.length === 0 ? (
              <box height={1} paddingLeft={2} paddingRight={2} backgroundColor={colors().surface}>
                <text fg={colors().muted}>No matching themes.</text>
              </box>
            ) : null}
          </>
        ) : (
          <>
            {props.view.items.slice(0, 10).map((item, index) =>
              item.kind === "action"
                ? paletteRow({
                    active: index === props.selectedIndex,
                    title: item.title,
                    footer: formatActionKeys(item.action),
                    colors: colors(),
                  })
                : null,
            )}
            {props.view.items.length === 0 ? (
              <box height={1} paddingLeft={2} paddingRight={2} backgroundColor={colors().surface}>
                <text fg={colors().muted}>No matching actions.</text>
              </box>
            ) : null}
          </>
        )}
      </box>
      <box height={1} backgroundColor={colors().surface} />
    </box>
  );
}

export function resolvePaletteColors(theme: TuiTheme): {
  readonly surface: string;
  readonly selected: string;
  readonly selectedText: string;
  readonly text: string;
  readonly currentText: string;
  readonly muted: string;
  readonly group: string;
} {
  return {
    surface: theme.palette.surface,
    selected: theme.palette.selectionActive,
    selectedText: selectedListItemForeground(theme),
    text: theme.palette.text,
    currentText: theme.palette.selectionActive,
    muted: theme.palette.muted,
    group: theme.palette.accent,
  };
}

function PaletteRow(props: {
  readonly active: boolean;
  readonly current?: boolean;
  readonly title: string;
  readonly description?: string;
  readonly footer?: string;
  readonly colors: ReturnType<typeof resolvePaletteColors>;
  readonly onMouseDown?: () => void;
  readonly onMouseOver?: () => void;
}): JSX.Element {
  const rowBackground = props.active ? props.colors.selected : props.colors.surface;
  const rowText = props.active
    ? props.colors.selectedText
    : props.current
      ? props.colors.currentText
      : props.colors.text;
  const secondaryText = props.active ? props.colors.selectedText : props.colors.muted;
  return (
    <box
      height={1}
      paddingLeft={props.current ? 1 : props.active ? 1 : 2}
      paddingRight={props.active ? 1 : 2}
      backgroundColor={props.colors.surface}
      {...(props.onMouseDown ? { onMouseDown: props.onMouseDown } : {})}
      {...(props.onMouseOver ? { onMouseOver: props.onMouseOver } : {})}
    >
      <box
        height={1}
        width="100%"
        flexDirection="row"
        justifyContent="space-between"
        gap={1}
        backgroundColor={rowBackground}
        paddingLeft={props.active ? 1 : 0}
        paddingRight={props.active ? 1 : 0}
      >
        {props.current ? (
          <text fg={props.active ? props.colors.selectedText : props.colors.currentText}>●</text>
        ) : null}
        <text fg={rowText}>
          {props.title}
          {props.description ? (
            <span style={{ fg: secondaryText }}>{`  ${props.description}`}</span>
          ) : null}
        </text>
        {props.footer ? <text fg={secondaryText}>{props.footer}</text> : null}
      </box>
    </box>
  );
}

function paletteRow(props: Parameters<typeof PaletteRow>[0]): JSX.Element {
  return PaletteRow(props);
}

function isBrowseItem(
  item: TuiPaletteItem,
): item is Extract<TuiPaletteItem, { readonly kind: "browse-directory" | "browse-up" }> {
  return item.kind === "browse-directory" || item.kind === "browse-up";
}
