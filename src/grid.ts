// PoE1 inventory geometry. The game scales its UI with window height and
// anchors the inventory panel to the right edge, so the grid is described as
// fractions of height measured from the right edge. Defaults are derived from
// a 1920x1080 layout (grid top-left ~(1271, 588), cells ~52.6px) and are
// expected to need small per-setup nudges via Calibration.

export const INVENTORY_COLS = 12
export const INVENTORY_ROWS = 5

const RIGHT_OFFSET_PER_H = (1920 - 1271) / 1080
const TOP_PER_H = 588 / 1080
const CELL_PER_H = 52.6 / 1080

export interface Calibration {
  /** CSS px nudges applied after the height-scaled defaults */
  offsetX: number
  offsetY: number
  /** Multiplier on the default cell size */
  cellScale: number
}

export const DEFAULT_CALIBRATION: Calibration = { offsetX: 0, offsetY: 0, cellScale: 1 }

export interface GridRect {
  x: number
  y: number
  cell: number
}

/** Inventory grid top-left and cell size, in game-window CSS px. */
export function inventoryGrid(gameSize: { width: number; height: number }, cal: Calibration): GridRect {
  const h = gameSize.height
  return {
    x: gameSize.width - h * RIGHT_OFFSET_PER_H + cal.offsetX,
    y: h * TOP_PER_H + cal.offsetY,
    cell: h * CELL_PER_H * cal.cellScale,
  }
}
