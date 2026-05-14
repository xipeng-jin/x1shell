import type React from "react";
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
}): React.ReactNode {
  const surface = props.theme.id === "light" ? props.theme.palette.surface : "#4a4a4a";
  const selected = props.theme.id === "light" ? props.theme.palette.selectionActive : "#8db7df";
  const selectedText = props.theme.id === "light" ? props.theme.palette.text : "#202020";
  const rowText = props.theme.id === "light" ? props.theme.palette.text : "#f0f0f0";
  const muted = props.theme.id === "light" ? props.theme.palette.muted : "#c4c4c4";
  const highlight = props.theme.id === "light" ? props.theme.palette.accent : "#9cc9f2";

  if (props.view.mode === "add-project-sources") {
    return (
      <PaletteShell
        title={props.view.title}
        query=""
        surface={surface}
        muted={muted}
        theme={props.theme}
      >
        {props.view.groupLabel ? (
          <PaletteGroup label={props.view.groupLabel} color={highlight} />
        ) : null}
        {props.view.items.map((item, index) =>
          item.kind === "add-project-source" ? (
            <PaletteRow
              key={item.source}
              active={index === props.selectedIndex}
              title={item.title}
              description={item.description}
              surface={surface}
              selected={selected}
              text={rowText}
              selectedText={selectedText}
              muted={muted}
              onMouseDown={() => props.onSelectItem?.(item)}
            />
          ) : null,
        )}
      </PaletteShell>
    );
  }

  if (props.view.mode === "add-project-browse") {
    return (
      <PaletteShell
        title={props.view.title}
        query={displayText(props.view.query)}
        surface={surface}
        muted={muted}
        theme={props.theme}
      >
        {props.view.error ? (
          <box paddingLeft={2} paddingRight={2} backgroundColor={surface}>
            <text fg={props.theme.palette.danger}>{displayText(props.view.error)}</text>
          </box>
        ) : null}
        {props.view.loading ? (
          <box paddingLeft={2} paddingRight={2} backgroundColor={surface}>
            <text fg={muted}>Browsing filesystem...</text>
          </box>
        ) : null}
        {props.view.items.map((item) => {
          if (!isBrowseItem(item)) return null;
          const value = browseItemValue(item);
          const highlighted = value === (props.highlightedItemValue ?? null);
          return (
            <PaletteRow
              key={item.kind === "browse-up" ? "browse-up" : item.fullPath}
              active={highlighted}
              title={displayText(item.kind === "browse-up" ? ".." : item.name)}
              surface={surface}
              selected={selected}
              text={rowText}
              selectedText={selectedText}
              muted={muted}
              onMouseOver={() => props.onHighlightItem?.(item)}
              onMouseDown={() => props.onSelectItem?.(item)}
            />
          );
        })}
        {props.view.items.length === 0 && !props.view.loading && !props.view.error ? (
          <box paddingLeft={2} paddingRight={2} backgroundColor={surface}>
            <text fg={muted}>No directories found.</text>
          </box>
        ) : null}
      </PaletteShell>
    );
  }

  return (
    <PaletteShell
      title={props.view.title}
      query={displayText(props.view.query)}
      surface={surface}
      muted={muted}
      theme={props.theme}
    >
      {props.view.items
        .slice(0, 10)
        .map((item, index) =>
          item.kind === "action" ? (
            <PaletteRow
              key={item.id}
              active={index === props.selectedIndex}
              title={item.title}
              footer={formatActionKeys(item.action)}
              surface={surface}
              selected={selected}
              text={rowText}
              selectedText={selectedText}
              muted={muted}
            />
          ) : null,
        )}
      {props.view.items.length === 0 ? (
        <box paddingLeft={2} paddingRight={2} backgroundColor={surface}>
          <text fg={muted}>No matching actions.</text>
        </box>
      ) : null}
    </PaletteShell>
  );
}

function PaletteShell(props: {
  readonly title: string;
  readonly query: string;
  readonly surface: string;
  readonly muted: string;
  readonly theme: TuiTheme;
  readonly children: React.ReactNode;
}): React.ReactNode {
  const query = props.query.length > 0 ? `${props.query}█` : "";
  return (
    <box
      width="100%"
      flexDirection="column"
      border={["left"]}
      borderColor={props.theme.palette.accent}
      backgroundColor={props.surface}
    >
      <box height={1} backgroundColor={props.surface} />
      <box
        height={1}
        paddingLeft={2}
        paddingRight={2}
        flexDirection="row"
        gap={1}
        backgroundColor={props.surface}
      >
        <text fg={props.theme.palette.text} attributes={1}>
          {props.title}
        </text>
        <box flexGrow={1} />
        <text fg={props.muted}>esc</text>
      </box>
      <box height={1} backgroundColor={props.surface} />
      <box height={1} paddingLeft={2} paddingRight={2} backgroundColor={props.surface}>
        <text fg={props.muted}>{query}</text>
      </box>
      <box height={1} backgroundColor={props.surface} />
      <box flexDirection="column" backgroundColor={props.surface}>
        {props.children}
      </box>
      <box height={1} backgroundColor={props.surface} />
    </box>
  );
}

function PaletteGroup(props: { readonly label: string; readonly color: string }): React.ReactNode {
  return (
    <box paddingLeft={2} paddingRight={2}>
      <text fg={props.color} attributes={1}>
        {props.label}
      </text>
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
}): React.ReactNode {
  const rowBackground = props.active ? props.selected : props.surface;
  const rowText = props.active ? props.selectedText : props.text;
  const secondaryText = props.active ? props.selectedText : props.muted;
  return (
    <box
      paddingLeft={props.active ? 1 : 2}
      paddingRight={props.active ? 1 : 2}
      backgroundColor={props.surface}
      {...(props.onMouseDown ? { onMouseDown: props.onMouseDown } : {})}
      {...(props.onMouseOver ? { onMouseOver: props.onMouseOver } : {})}
    >
      <box
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

function isBrowseItem(
  item: TuiPaletteItem,
): item is Extract<TuiPaletteItem, { readonly kind: "browse-directory" | "browse-up" }> {
  return item.kind === "browse-directory" || item.kind === "browse-up";
}
