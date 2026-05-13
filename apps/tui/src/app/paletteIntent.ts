export type PaletteIntent = {
  readonly kind: "add-project";
  readonly requestId: number;
};

export function nextAddProjectPaletteIntent(current: PaletteIntent | null): PaletteIntent {
  return {
    kind: "add-project",
    requestId: (current?.requestId ?? 0) + 1,
  };
}
