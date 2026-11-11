export const BOARD_PADDING = 0.5;

export function chooseBoardShape(mode, width, height) {
  if (mode === 'classic') return { rows: 8, cols: 8 };
  if (mode === 'tall') return { rows: 12, cols: 8 };
  if (mode === 'wide') return { rows: 8, cols: 12 };
  const ratio = Math.max(1, height) / Math.max(1, width);
  const longerSide = ratio > 1 ? ratio : 1 / ratio;
  const count = Math.max(8, Math.min(16, Math.round((8 + BOARD_PADDING) * longerSide - BOARD_PADDING)));
  return ratio >= 1 ? { rows: count, cols: 8 } : { rows: 8, cols: count };
}

export function fitBoard(rows, cols, width, height) {
  const cell = Math.min(Math.max(1, width) / (cols + BOARD_PADDING), Math.max(1, height) / (rows + BOARD_PADDING));
  return { width: Math.max(1, Math.floor(cell * (cols + BOARD_PADDING))),
    height: Math.max(1, Math.floor(cell * (rows + BOARD_PADDING))), cell };
}
