// What the in-game overlay draws, computed in Scalpel's main overlay process
// and handed to the annotation overlay window through plugin storage (the two
// windows run separate copies of this plugin and share no memory).
import { INVENTORY_COLS, INVENTORY_ROWS } from './grid'
import type { PriceBook } from './pricing'
import type { ScanOutcome } from './scan'
import { priceRow } from './summary'

export const OVERLAY_KEY = 'overlay'

/** above/below: priced against the threshold. lookalike: ambiguous art at or
 *  above it. unpriced: no 20/20 line. unknown: the cell couldn't be read. */
export type MarkKind = 'above' | 'below' | 'lookalike' | 'unpriced' | 'unknown'

export interface OverlayMark {
  /** Cell rect in game-window CSS px, the annotation overlay's own space */
  x: number
  y: number
  size: number
  kind: MarkKind
  label: string
}

export interface OverlayPayload {
  /** Changes on every publish so the overlay can skip unchanged polls */
  stamp: number
  marks: OverlayMark[]
  /** Inventory grid in game CSS px, for placing the overlay's controls */
  grid: { x: number; y: number; width: number; height: number }
  /** What the scan did to the craft log, e.g. "+12 gems logged" */
  status: string
}

export function overlayGrid(scan: ScanOutcome): OverlayPayload['grid'] {
  const { capture, grid, offset } = scan
  const cell = grid.cell / capture.scale
  return {
    x: capture.origin.x + (grid.x + offset.dx) / capture.scale,
    y: capture.origin.y + (grid.y + offset.dy) / capture.scale,
    width: cell * INVENTORY_COLS,
    height: cell * INVENTORY_ROWS,
  }
}

/** Compact price label: "0.5c", "93c", "1.2kc", or divines from one up when
 *  `divineChaos` is given. */
export function formatValue(chaos: number, divineChaos: number | null): string {
  if (divineChaos && chaos >= divineChaos) return `${round(chaos / divineChaos)}d`
  if (chaos >= 1000) return `${round(chaos / 1000)}kc`
  return `${round(chaos)}c`
}

function round(v: number): string {
  return v < 10 ? String(Math.round(v * 10) / 10) : String(Math.round(v))
}

/** One mark per non-empty cell. Look-alikes and price ranges are judged and
 *  labelled by their highest possible value, so nothing valuable gets faded. */
export function buildOverlay(
  scan: ScanOutcome,
  book: PriceBook,
  threshold: number | null,
  hideUnpriced = false,
  chaosOnly = false,
): OverlayMark[] {
  const { capture, grid, offset } = scan
  const size = grid.cell / capture.scale
  const x0 = capture.origin.x + (grid.x + offset.dx) / capture.scale
  const y0 = capture.origin.y + (grid.y + offset.dy) / capture.scale
  const marks: OverlayMark[] = []
  for (const cell of scan.cells) {
    if (cell.status === 'empty') continue
    const rect = { x: x0 + cell.col * size, y: y0 + cell.row * size, size }
    if (cell.status === 'unknown') {
      marks.push({ ...rect, kind: 'unknown', label: '?' })
      continue
    }
    const value = priceRow('', cell.candidates, book).unitMax
    if (value === null) {
      // Hidden ones are faded like cheap gems, not dropped, so every gem
      // still shows whether it was read.
      marks.push({ ...rect, kind: hideUnpriced ? 'below' : 'unpriced', label: 'no price' })
      continue
    }
    const ambiguous = cell.candidates.length > 1
    const label = formatValue(value, chaosOnly ? null : book.divineChaos) + (ambiguous ? '?' : '')
    const kind: MarkKind = threshold !== null && value < threshold ? 'below' : ambiguous ? 'lookalike' : 'above'
    marks.push({ ...rect, kind, label })
  }
  return marks
}
