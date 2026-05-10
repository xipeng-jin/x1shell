import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import type * as Electron from "electron";

import { loadElectron } from "./ElectronRuntime.ts";

const CONFIRM_BUTTON_INDEX = 1;

export interface ElectronDialogPickFolderInput {
  readonly owner: Option.Option<Electron.BrowserWindow>;
  readonly defaultPath: Option.Option<string>;
}

export interface ElectronDialogConfirmInput {
  readonly owner: Option.Option<Electron.BrowserWindow>;
  readonly message: string;
}

export interface ElectronDialogShape {
  readonly pickFolder: (
    input: ElectronDialogPickFolderInput,
  ) => Effect.Effect<Option.Option<string>>;
  readonly confirm: (input: ElectronDialogConfirmInput) => Effect.Effect<boolean>;
  readonly showMessageBox: (
    options: Electron.MessageBoxOptions,
  ) => Effect.Effect<Electron.MessageBoxReturnValue>;
  readonly showErrorBox: (title: string, content: string) => Effect.Effect<void>;
}

export class ElectronDialog extends Context.Service<ElectronDialog, ElectronDialogShape>()(
  "t3/desktop/electron/Dialog",
) {}

const make = ElectronDialog.of({
  pickFolder: Effect.fn("desktop.electron.dialog.pickFolder")(function* (input) {
    const openDialogOptions: Electron.OpenDialogOptions = Option.match(input.defaultPath, {
      onNone: () => ({
        properties: ["openDirectory", "createDirectory"],
      }),
      onSome: (defaultPath) => ({
        properties: ["openDirectory", "createDirectory"],
        defaultPath,
      }),
    });
    const Electron = yield* Effect.promise(() => loadElectron());
    const result = yield* Option.match(input.owner, {
      onNone: () => Effect.promise(() => Electron.dialog.showOpenDialog(openDialogOptions)),
      onSome: (owner) =>
        Effect.promise(() => Electron.dialog.showOpenDialog(owner, openDialogOptions)),
    });

    if (result.canceled) {
      return Option.none();
    }
    return Option.fromNullishOr(result.filePaths[0]);
  }),
  confirm: Effect.fn("desktop.electron.dialog.confirm")(function* (input) {
    const normalizedMessage = input.message.trim();
    if (normalizedMessage.length === 0) {
      return false;
    }

    const options = {
      type: "question" as const,
      buttons: ["No", "Yes"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      message: normalizedMessage,
    };
    const Electron = yield* Effect.promise(() => loadElectron());
    const result = yield* Option.match(input.owner, {
      onNone: () => Effect.promise(() => Electron.dialog.showMessageBox(options)),
      onSome: (owner) => Effect.promise(() => Electron.dialog.showMessageBox(owner, options)),
    });
    return result.response === CONFIRM_BUTTON_INDEX;
  }),
  showMessageBox: (options) =>
    Effect.promise(async () => {
      const Electron = await loadElectron();
      return Electron.dialog.showMessageBox(options);
    }),
  showErrorBox: (title, content) =>
    Effect.promise(async () => {
      const Electron = await loadElectron();
      Electron.dialog.showErrorBox(title, content);
    }),
});

export const layer = Layer.succeed(ElectronDialog, make);
