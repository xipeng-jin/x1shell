import { ensureBrowseDirectoryPath } from "@t3tools/shared/projectPaths";
import type { TuiActionId, TuiActionDefinition } from "../domain/keybindings.js";

export type TuiPaletteMode = "actions" | "add-project-sources" | "add-project-browse";

export type TuiPaletteItem =
  | {
      readonly kind: "action";
      readonly id: TuiActionId;
      readonly title: string;
      readonly description?: string;
      readonly disabled?: boolean;
      readonly action: TuiActionDefinition;
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

export interface TuiPaletteViewModel {
  readonly mode: TuiPaletteMode;
  readonly title: string;
  readonly query: string;
  readonly groupLabel?: string;
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly items: readonly TuiPaletteItem[];
}

export function buildActionPaletteView(input: {
  readonly actions: readonly TuiActionDefinition[];
  readonly query: string;
}): TuiPaletteViewModel {
  return {
    mode: "actions",
    title: "Command Palette",
    query: input.query,
    items: input.actions.map((action) => ({
      kind: "action",
      id: action.id,
      title: action.label,
      action,
    })),
  };
}

export function buildAddProjectSourcesPaletteView(): TuiPaletteViewModel {
  return {
    mode: "add-project-sources",
    title: "Add project",
    query: "",
    groupLabel: "Sources",
    items: [
      {
        kind: "add-project-source",
        source: "local",
        title: "Local folder",
        description: "Browse a folder on disk",
      },
    ],
  };
}

export function buildAddProjectBrowsePaletteView(input: {
  readonly query: string;
  readonly items?: readonly Extract<
    TuiPaletteItem,
    { readonly kind: "browse-directory" | "browse-up" }
  >[];
  readonly loading?: boolean;
  readonly error?: string | null;
}): TuiPaletteViewModel {
  return {
    mode: "add-project-browse",
    title: "Add project / Local folder",
    query: input.query,
    loading: input.loading ?? false,
    error: input.error ?? null,
    items: input.items ?? [],
  };
}

export function initialAddProjectBrowseQuery(input: {
  readonly addProjectBaseDirectory?: string | null;
}): string {
  const baseDirectory = input.addProjectBaseDirectory?.trim();
  return baseDirectory ? ensureBrowseDirectoryPath(baseDirectory) : "~/";
}
