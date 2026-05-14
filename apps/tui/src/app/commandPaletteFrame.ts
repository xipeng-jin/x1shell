const COMMAND_PALETTE_WIDTH = 84;
const COMMAND_PALETTE_MAX_WIDTH_MARGIN = 8;
const COMMAND_PALETTE_HEIGHT = 18;
const COMMAND_PALETTE_MIN_HEIGHT = 10;

export function resolveCommandPaletteFrame(input: {
  readonly viewportColumns: number;
  readonly viewportRows: number;
}): {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
} {
  const viewportWidth = Math.max(1, input.viewportColumns);
  const availableWidth = Math.max(24, viewportWidth - COMMAND_PALETTE_MAX_WIDTH_MARGIN);
  const width = Math.min(COMMAND_PALETTE_WIDTH, availableWidth);
  const height = Math.max(
    COMMAND_PALETTE_MIN_HEIGHT,
    Math.min(COMMAND_PALETTE_HEIGHT, input.viewportRows - 6),
  );
  return {
    left: Math.max(0, Math.floor((viewportWidth - width) / 2)),
    top: Math.max(1, Math.round(input.viewportRows * 0.1)),
    width,
    height,
  };
}
