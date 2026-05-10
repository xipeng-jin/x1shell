import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";

import type * as Electron from "electron";

import { loadElectron } from "./ElectronRuntime.ts";

export interface ElectronAppMetadata {
  readonly appVersion: string;
  readonly appPath: string;
  readonly isPackaged: boolean;
  readonly resourcesPath: string;
  readonly runningUnderArm64Translation: boolean;
}

export interface ElectronAppShape {
  readonly metadata: Effect.Effect<ElectronAppMetadata>;
  readonly name: Effect.Effect<string>;
  readonly whenReady: Effect.Effect<void>;
  readonly quit: Effect.Effect<void>;
  readonly exit: (code: number) => Effect.Effect<void>;
  readonly relaunch: (options: Electron.RelaunchOptions) => Effect.Effect<void>;
  readonly setPath: (
    name: Parameters<Electron.App["setPath"]>[0],
    path: string,
  ) => Effect.Effect<void>;
  readonly setName: (name: string) => Effect.Effect<void>;
  readonly setAboutPanelOptions: (
    options: Electron.AboutPanelOptionsOptions,
  ) => Effect.Effect<void>;
  readonly setAppUserModelId: (id: string) => Effect.Effect<void>;
  readonly setDesktopName: (desktopName: string) => Effect.Effect<void>;
  readonly setDockIcon: (iconPath: string) => Effect.Effect<void>;
  readonly appendCommandLineSwitch: (switchName: string, value?: string) => Effect.Effect<void>;
  readonly on: <Args extends ReadonlyArray<unknown>>(
    eventName: string,
    listener: (...args: Args) => void,
  ) => Effect.Effect<void, never, Scope.Scope>;
}

export class ElectronApp extends Context.Service<ElectronApp, ElectronAppShape>()(
  "t3/desktop/electron/App",
) {}

const addScopedAppListener = <Args extends ReadonlyArray<unknown>>(
  eventName: string,
  listener: (...args: Args) => void,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const Electron = await loadElectron();
      Electron.app.on(eventName as any, listener as any);
      return Electron.app;
    }),
    (app) =>
      Effect.sync(() => {
        app.removeListener(eventName as any, listener as any);
      }),
  ).pipe(Effect.asVoid);

const make = ElectronApp.of({
  metadata: Effect.promise(async () => {
    const Electron = await loadElectron();
    return {
      appVersion: Electron.app.getVersion(),
      appPath: Electron.app.getAppPath(),
      isPackaged: Electron.app.isPackaged,
      resourcesPath: process.resourcesPath,
      runningUnderArm64Translation: Electron.app.runningUnderARM64Translation === true,
    };
  }),
  name: Effect.promise(async () => {
    const Electron = await loadElectron();
    return Electron.app.name;
  }),
  whenReady: Effect.promise(async () => {
    const Electron = await loadElectron();
    await Electron.app.whenReady();
  }).pipe(Effect.asVoid),
  quit: Effect.promise(async () => {
    const Electron = await loadElectron();
    Electron.app.quit();
  }),
  exit: (code) =>
    Effect.promise(async () => {
      const Electron = await loadElectron();
      Electron.app.exit(code);
    }),
  relaunch: (options) =>
    Effect.promise(async () => {
      const Electron = await loadElectron();
      Electron.app.relaunch(options);
    }),
  setPath: (name, path) =>
    Effect.promise(async () => {
      const Electron = await loadElectron();
      Electron.app.setPath(name, path);
    }),
  setName: (name) =>
    Effect.promise(async () => {
      const Electron = await loadElectron();
      Electron.app.setName(name);
    }),
  setAboutPanelOptions: (options) =>
    Effect.promise(async () => {
      const Electron = await loadElectron();
      Electron.app.setAboutPanelOptions(options);
    }),
  setAppUserModelId: (id) =>
    Effect.promise(async () => {
      const Electron = await loadElectron();
      Electron.app.setAppUserModelId(id);
    }),
  setDesktopName: (desktopName) =>
    Effect.promise(async () => {
      const Electron = await loadElectron();
      const linuxApp = Electron.app as Electron.App & {
        setDesktopName?: (desktopName: string) => void;
      };
      linuxApp.setDesktopName?.(desktopName);
    }),
  setDockIcon: (iconPath) =>
    Effect.promise(async () => {
      const Electron = await loadElectron();
      Electron.app.dock?.setIcon(iconPath);
    }),
  appendCommandLineSwitch: (switchName, value) =>
    Effect.promise(async () => {
      const Electron = await loadElectron();
      if (value === undefined) {
        Electron.app.commandLine.appendSwitch(switchName);
        return;
      }
      Electron.app.commandLine.appendSwitch(switchName, value);
    }),
  on: addScopedAppListener,
});

export const layer = Layer.succeed(ElectronApp, make);
