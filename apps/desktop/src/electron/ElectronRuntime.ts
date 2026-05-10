import type * as Electron from "electron";
import type * as ElectronUpdater from "electron-updater";

type CjsDynamicImport<T extends object> = T | { readonly default?: T };

const normalizeCjsDynamicImport = <T extends object>(module: CjsDynamicImport<T>): T => {
  if ("default" in module && module.default !== undefined) {
    return module.default;
  }
  return module as T;
};

export const loadElectron = async (): Promise<typeof Electron> =>
  normalizeCjsDynamicImport<typeof Electron>(await import("electron"));

export const loadElectronUpdater = async (): Promise<typeof ElectronUpdater> =>
  normalizeCjsDynamicImport<typeof ElectronUpdater>(await import("electron-updater"));
