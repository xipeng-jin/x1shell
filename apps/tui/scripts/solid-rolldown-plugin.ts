import { resolve } from "node:path";
import { transformAsync } from "@babel/core";
import typescript from "@babel/preset-typescript";
import solid from "babel-preset-solid";
import type { Rolldown } from "tsdown";

type TransformResult = {
  code: string;
  map: Rolldown.SourceMapInput;
};

export function solidOpenTuiPlugin(root = process.cwd()): Rolldown.Plugin {
  const srcRoot = normalizePath(resolve(root, "src"));

  return {
    name: "x1shell-solid-opentui-jsx",
    async transform(code, id): Promise<Rolldown.TransformResult> {
      const filename = normalizePath(id.split("?")[0] ?? id);
      if (!shouldTransform(filename, srcRoot)) {
        return null;
      }

      return transformSolidOpenTuiJsx(code, filename);
    },
  };
}

export async function transformSolidOpenTuiJsx(
  code: string,
  filename: string,
): Promise<TransformResult> {
  const transformed = await transformAsync(code, {
    filename,
    configFile: false,
    babelrc: false,
    sourceMaps: true,
    presets: [
      [
        solid,
        {
          moduleName: "@opentui/solid",
          generate: "universal",
        },
      ],
      [
        typescript,
        {
          isTSX: true,
          allExtensions: true,
        },
      ],
    ],
  });

  if (!transformed?.code) {
    throw new Error(`Solid JSX transform produced no output for ${filename}`);
  }

  return {
    code: transformed.code,
    map: transformed.map ?? null,
  };
}

function shouldTransform(filename: string, srcRoot: string): boolean {
  if (!/\.[jt]sx$/.test(filename)) {
    return false;
  }
  if (filename.includes("/node_modules/") || filename.includes("/dist/")) {
    return false;
  }
  return filename === srcRoot || filename.startsWith(`${srcRoot}/`);
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}
