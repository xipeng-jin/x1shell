declare module "@babel/core" {
  import type { Rolldown } from "tsdown";

  export type TransformOptions = {
    filename?: string;
    configFile?: false | string;
    babelrc?: false | string;
    sourceMaps?: boolean;
    presets?: unknown[];
  };

  export type BabelFileResult = {
    code?: string | null;
    map?: Rolldown.SourceMapInput;
  };

  export function transformAsync(
    code: string,
    options: TransformOptions,
  ): Promise<BabelFileResult | null>;
}

declare module "@babel/preset-typescript" {
  const preset: unknown;
  export default preset;
}

declare module "babel-preset-solid" {
  const preset: unknown;
  export default preset;
}
