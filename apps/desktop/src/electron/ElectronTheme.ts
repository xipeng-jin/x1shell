import type { DesktopTheme } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";

import { loadElectron } from "./ElectronRuntime.ts";

export interface ElectronThemeShape {
  readonly shouldUseDarkColors: Effect.Effect<boolean>;
  readonly setSource: (theme: DesktopTheme) => Effect.Effect<void>;
  readonly onUpdated: (listener: () => void) => Effect.Effect<void, never, Scope.Scope>;
}

export class ElectronTheme extends Context.Service<ElectronTheme, ElectronThemeShape>()(
  "t3/desktop/electron/Theme",
) {}

const make = ElectronTheme.of({
  shouldUseDarkColors: Effect.promise(async () => {
    const Electron = await loadElectron();
    return Electron.nativeTheme.shouldUseDarkColors;
  }),
  setSource: (theme) =>
    Effect.promise(async () => {
      const Electron = await loadElectron();
      Electron.nativeTheme.themeSource = theme;
    }),
  onUpdated: (listener) =>
    Effect.acquireRelease(
      Effect.promise(async () => {
        const Electron = await loadElectron();
        Electron.nativeTheme.on("updated", listener);
        return Electron.nativeTheme;
      }),
      (nativeTheme) =>
        Effect.suspend(() => {
          nativeTheme.removeListener("updated", listener);
          return Effect.void;
        }),
    ),
});

export const layer = Layer.succeed(ElectronTheme, make);
