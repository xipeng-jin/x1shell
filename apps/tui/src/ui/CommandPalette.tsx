import type React from "react";
import { formatActionKeys } from "../domain/keybindings.js";
import type { TuiPaletteItem, TuiPaletteViewModel } from "../app/paletteViewModel.js";
import type { TuiTheme } from "../terminal/theme.js";
import { displayText } from "../domain/display.js";

export function CommandPalette(props: {
  readonly view: TuiPaletteViewModel;
  readonly onSelectItem?: (item: TuiPaletteItem) => void;
  readonly selectedIndex: number;
  readonly theme: TuiTheme;
}): React.ReactNode {
  if (props.view.mode === "add-project-sources") {
    return (
      <box border borderColor={props.theme.palette.accent} paddingLeft={1} flexDirection="column">
        <text fg={props.theme.palette.accent} attributes={1}>
          {props.view.title}
        </text>
        {props.view.groupLabel ? (
          <text fg={props.theme.palette.muted}>{props.view.groupLabel}</text>
        ) : null}
        {props.view.items.map((item, index) =>
          item.kind === "add-project-source" ? (
            <box
              key={item.source}
              flexDirection="column"
              onMouseDown={() => props.onSelectItem?.(item)}
            >
              <text
                fg={
                  index === props.selectedIndex
                    ? props.theme.palette.accent
                    : props.theme.palette.text
                }
              >
                {`${index === props.selectedIndex ? "> " : "  "}${item.title}`}
              </text>
              <text fg={props.theme.palette.muted}>{` ${item.description}`}</text>
            </box>
          ) : null,
        )}
        <text fg={props.theme.palette.muted}>Press Enter to select. Esc closes.</text>
      </box>
    );
  }

  if (props.view.mode === "add-project-browse") {
    return (
      <box border borderColor={props.theme.palette.accent} paddingLeft={1} flexDirection="column">
        <text fg={props.theme.palette.accent} attributes={1}>
          {props.view.title}
        </text>
        <text fg={props.theme.palette.text}>{displayText(props.view.query)}</text>
        {props.view.error ? (
          <text fg={props.theme.palette.danger}>{displayText(props.view.error)}</text>
        ) : null}
        {props.view.loading ? (
          <text fg={props.theme.palette.muted}>Browsing filesystem...</text>
        ) : null}
        {props.view.items.map((item, index) =>
          isBrowseItem(item) ? (
            <text
              key={item.kind === "browse-up" ? "browse-up" : item.fullPath}
              fg={
                index === props.selectedIndex
                  ? props.theme.palette.accent
                  : props.theme.palette.text
              }
              onMouseDown={() => props.onSelectItem?.(item)}
            >
              {`${index === props.selectedIndex ? "> " : "  "}${displayText(
                item.kind === "browse-up" ? ".." : item.name,
              )}`}
            </text>
          ) : null,
        )}
        {props.view.items.length === 0 && !props.view.loading && !props.view.error ? (
          <text fg={props.theme.palette.muted}>No directories found.</text>
        ) : null}
      </box>
    );
  }

  return (
    <box border borderColor={props.theme.palette.accent} paddingLeft={1} flexDirection="column">
      <text fg={props.theme.palette.accent} attributes={1}>
        {`${props.view.title} ${props.view.query ? `/ ${displayText(props.view.query)}` : ""}`}
      </text>
      {props.view.items.slice(0, 10).map((item, index) =>
        item.kind === "action" ? (
          <text
            key={item.id}
            fg={
              index === props.selectedIndex ? props.theme.palette.accent : props.theme.palette.text
            }
          >
            {`${index === props.selectedIndex ? "> " : "  "}${formatActionKeys(item.action).padEnd(12)} ${item.title}`}
          </text>
        ) : null,
      )}
      {props.view.items.length === 0 ? (
        <text fg={props.theme.palette.muted}>No matching actions.</text>
      ) : null}
    </box>
  );
}

function isBrowseItem(
  item: TuiPaletteItem,
): item is Extract<TuiPaletteItem, { readonly kind: "browse-directory" | "browse-up" }> {
  return item.kind === "browse-directory" || item.kind === "browse-up";
}
