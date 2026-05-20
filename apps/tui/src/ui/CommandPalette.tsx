import type { JSX } from "solid-js";
import { formatActionKeys } from "../domain/keybindings.js";
import { browseItemValue } from "../app/filesystemBrowse.js";
import type { TuiPaletteItem, TuiPaletteViewModel } from "../app/paletteViewModel.js";
import type { TuiTheme } from "../terminal/theme.js";
import { displayText } from "../domain/display.js";

export function CommandPalette(props: {
  readonly view: TuiPaletteViewModel;
  readonly onSelectItem?: (item: TuiPaletteItem) => void;
  readonly onHighlightItem?: (item: TuiPaletteItem) => void;
  readonly selectedIndex: number;
  readonly highlightedItemValue?: string | null;
  readonly theme: TuiTheme;
}): JSX.Element {
  const surface = props.theme.id === "light" ? props.theme.palette.surface : "#4a4a4a";
  const selected = props.theme.id === "light" ? props.theme.palette.selectionActive : "#8db7df";
  const selectedText = props.theme.id === "light" ? props.theme.palette.text : "#202020";
  const rowText = props.theme.id === "light" ? props.theme.palette.text : "#f0f0f0";
  const muted = props.theme.id === "light" ? props.theme.palette.muted : "#c4c4c4";
  const highlight = props.theme.id === "light" ? props.theme.palette.accent : "#9cc9f2";
  const query = () => (props.view.query.length > 0 ? `${displayText(props.view.query)}█` : "");

  return (
    <box
      width="100%"
      flexDirection="column"
      border={["left"]}
      borderColor={props.theme.palette.accent}
      backgroundColor={surface}
    >
      <box height={1} backgroundColor={surface} />
      <box
        height={1}
        paddingLeft={2}
        paddingRight={2}
        flexDirection="row"
        gap={1}
        backgroundColor={surface}
      >
        <text fg={props.theme.palette.text} attributes={1}>
          {props.view.title}
        </text>
        <box flexGrow={1} />
        <text fg={muted}>esc</text>
      </box>
      <box height={1} backgroundColor={surface} />
      <box height={1} paddingLeft={2} paddingRight={2} backgroundColor={surface}>
        <text fg={muted}>{query()}</text>
      </box>
      <box height={1} backgroundColor={surface} />
      <box flexGrow={1} flexDirection="column" backgroundColor={surface}>
        {props.view.mode === "add-project-sources" ? (
          <>
            {props.view.groupLabel ? (
              <box height={1} paddingLeft={2} paddingRight={2} backgroundColor={surface}>
                <text fg={highlight} attributes={1}>
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
                    surface,
                    selected,
                    text: rowText,
                    selectedText,
                    muted,
                    onMouseDown: () => props.onSelectItem?.(item),
                  })
                : null,
            )}
          </>
        ) : props.view.mode === "add-project-browse" ? (
          <>
            {props.view.error ? (
              <box height={1} paddingLeft={2} paddingRight={2} backgroundColor={surface}>
                <text fg={props.theme.palette.danger}>{displayText(props.view.error)}</text>
              </box>
            ) : null}
            {props.view.loading ? (
              <box height={1} paddingLeft={2} paddingRight={2} backgroundColor={surface}>
                <text fg={muted}>Browsing filesystem...</text>
              </box>
            ) : null}
            {props.view.items.map((item) => {
              if (!isBrowseItem(item)) return null;
              const value = browseItemValue(item);
              return paletteRow({
                active: value === (props.highlightedItemValue ?? null),
                title: displayText(item.kind === "browse-up" ? ".." : item.name),
                surface,
                selected,
                text: rowText,
                selectedText,
                muted,
                onMouseOver: () => props.onHighlightItem?.(item),
                onMouseDown: () => props.onSelectItem?.(item),
              });
            })}
            {props.view.items.length === 0 && !props.view.loading && !props.view.error ? (
              <box height={1} paddingLeft={2} paddingRight={2} backgroundColor={surface}>
                <text fg={muted}>No directories found.</text>
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
                    surface,
                    selected,
                    text: rowText,
                    selectedText,
                    muted,
                  })
                : null,
            )}
            {props.view.items.length === 0 ? (
              <box height={1} paddingLeft={2} paddingRight={2} backgroundColor={surface}>
                <text fg={muted}>No matching actions.</text>
              </box>
            ) : null}
          </>
        )}
      </box>
      <box height={1} backgroundColor={surface} />
    </box>
  );
}

function PaletteRow(props: {
  readonly active: boolean;
  readonly title: string;
  readonly description?: string;
  readonly footer?: string;
  readonly surface: string;
  readonly selected: string;
  readonly text: string;
  readonly selectedText: string;
  readonly muted: string;
  readonly onMouseDown?: () => void;
  readonly onMouseOver?: () => void;
}): JSX.Element {
  const rowBackground = props.active ? props.selected : props.surface;
  const rowText = props.active ? props.selectedText : props.text;
  const secondaryText = props.active ? props.selectedText : props.muted;
  return (
    <box
      height={1}
      paddingLeft={props.active ? 1 : 2}
      paddingRight={props.active ? 1 : 2}
      backgroundColor={props.surface}
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
