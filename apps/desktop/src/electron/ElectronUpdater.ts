import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";

import type { autoUpdater as autoUpdaterType } from "electron-updater";

import { loadElectronUpdater } from "./ElectronRuntime.ts";

type AutoUpdater = typeof autoUpdaterType;

export type ElectronUpdaterFeedUrl = Parameters<AutoUpdater["setFeedURL"]>[0];

export class ElectronUpdaterCheckForUpdatesError extends Data.TaggedError(
  "ElectronUpdaterCheckForUpdatesError",
)<{
  readonly cause: unknown;
}> {
  override get message() {
    return "Electron updater failed to check for updates.";
  }
}

export class ElectronUpdaterDownloadUpdateError extends Data.TaggedError(
  "ElectronUpdaterDownloadUpdateError",
)<{
  readonly cause: unknown;
}> {
  override get message() {
    return "Electron updater failed to download the update.";
  }
}

export class ElectronUpdaterQuitAndInstallError extends Data.TaggedError(
  "ElectronUpdaterQuitAndInstallError",
)<{
  readonly cause: unknown;
}> {
  override get message() {
    return "Electron updater failed to quit and install the update.";
  }
}

export type ElectronUpdaterError =
  | ElectronUpdaterCheckForUpdatesError
  | ElectronUpdaterDownloadUpdateError
  | ElectronUpdaterQuitAndInstallError;

export interface ElectronUpdaterShape {
  readonly setFeedURL: (options: ElectronUpdaterFeedUrl) => Effect.Effect<void>;
  readonly setAutoDownload: (value: boolean) => Effect.Effect<void>;
  readonly setAutoInstallOnAppQuit: (value: boolean) => Effect.Effect<void>;
  readonly setChannel: (channel: string) => Effect.Effect<void>;
  readonly setAllowPrerelease: (value: boolean) => Effect.Effect<void>;
  readonly allowDowngrade: Effect.Effect<boolean>;
  readonly setAllowDowngrade: (value: boolean) => Effect.Effect<void>;
  readonly setDisableDifferentialDownload: (value: boolean) => Effect.Effect<void>;
  readonly checkForUpdates: Effect.Effect<void, ElectronUpdaterCheckForUpdatesError>;
  readonly downloadUpdate: Effect.Effect<void, ElectronUpdaterDownloadUpdateError>;
  readonly quitAndInstall: (options: {
    readonly isSilent: boolean;
    readonly isForceRunAfter: boolean;
  }) => Effect.Effect<void, ElectronUpdaterQuitAndInstallError>;
  readonly on: <Args extends ReadonlyArray<unknown>>(
    eventName: string,
    listener: (...args: Args) => void,
  ) => Effect.Effect<void, never, Scope.Scope>;
}

export class ElectronUpdater extends Context.Service<ElectronUpdater, ElectronUpdaterShape>()(
  "t3/desktop/electron/Updater",
) {}

const loadAutoUpdater = async () => {
  const { autoUpdater } = await loadElectronUpdater();
  return autoUpdater;
};

export const layer = Layer.succeed(ElectronUpdater, {
  setFeedURL: (options) =>
    Effect.promise(async () => {
      const autoUpdater = await loadAutoUpdater();
      autoUpdater.setFeedURL(options);
    }),
  setAutoDownload: (value) =>
    Effect.promise(async () => {
      const autoUpdater = await loadAutoUpdater();
      autoUpdater.autoDownload = value;
    }),
  setAutoInstallOnAppQuit: (value) =>
    Effect.promise(async () => {
      const autoUpdater = await loadAutoUpdater();
      autoUpdater.autoInstallOnAppQuit = value;
    }),
  setChannel: (channel) =>
    Effect.promise(async () => {
      const autoUpdater = await loadAutoUpdater();
      autoUpdater.channel = channel;
    }),
  setAllowPrerelease: (value) =>
    Effect.promise(async () => {
      const autoUpdater = await loadAutoUpdater();
      autoUpdater.allowPrerelease = value;
    }),
  allowDowngrade: Effect.promise(async () => {
    const autoUpdater = await loadAutoUpdater();
    return autoUpdater.allowDowngrade;
  }),
  setAllowDowngrade: (value) =>
    Effect.promise(async () => {
      const autoUpdater = await loadAutoUpdater();
      autoUpdater.allowDowngrade = value;
    }),
  setDisableDifferentialDownload: (value) =>
    Effect.promise(async () => {
      const autoUpdater = await loadAutoUpdater();
      autoUpdater.disableDifferentialDownload = value;
    }),
  checkForUpdates: Effect.tryPromise({
    try: async () => {
      const autoUpdater = await loadAutoUpdater();
      return autoUpdater.checkForUpdates();
    },
    catch: (cause) => new ElectronUpdaterCheckForUpdatesError({ cause }),
  }).pipe(Effect.asVoid),
  downloadUpdate: Effect.tryPromise({
    try: async () => {
      const autoUpdater = await loadAutoUpdater();
      return autoUpdater.downloadUpdate();
    },
    catch: (cause) => new ElectronUpdaterDownloadUpdateError({ cause }),
  }).pipe(Effect.asVoid),
  quitAndInstall: ({ isSilent, isForceRunAfter }) =>
    Effect.tryPromise({
      try: async () => {
        const autoUpdater = await loadAutoUpdater();
        return autoUpdater.quitAndInstall(isSilent, isForceRunAfter);
      },
      catch: (cause) => new ElectronUpdaterQuitAndInstallError({ cause }),
    }),
  on: (eventName, listener) => {
    const untypedListener = listener as unknown as (...args: Array<unknown>) => void;
    return Effect.acquireRelease(
      Effect.promise(async () => {
        const eventTarget = (await loadAutoUpdater()) as unknown as {
          on: (eventName: string, listener: (...args: Array<unknown>) => void) => void;
          removeListener: (eventName: string, listener: (...args: Array<unknown>) => void) => void;
        };
        eventTarget.on(eventName, untypedListener);
        return eventTarget;
      }),
      (eventTarget) =>
        Effect.sync(() => {
          eventTarget.removeListener(eventName, untypedListener);
        }),
    ).pipe(Effect.asVoid);
  },
} satisfies ElectronUpdaterShape);
