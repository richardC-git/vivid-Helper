// What the in-game overlay draws, computed in Scalpel's main overlay process
// and handed to the annotation overlay window through plugin storage (the two
// windows run separate copies of this plugin and share no memory).
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
}

/** Compact price label: "0.5c", "93c", "1.2k" chaos, or divines from one up. */
export function formatValue(chaos: number, divineChaos: number | null): string {
  if (divineChaos && chaos >= divineChaos) return `${round(chaos / divineChaos)}d`
  if (chaos >= 1000) return `${round(chaos / 1000)}k`
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
      if (!hideUnpriced) marks.push({ ...rect, kind: 'unpriced', label: 'no price' })
      continue
    }
    const ambiguous = cell.candidates.length > 1
    const label = formatValue(value, book.divineChaos) + (ambiguous ? '?' : '')
    const kind: MarkKind = threshold !== null && value < threshold ? 'below' : ambiguous ? 'lookalike' : 'above'
    marks.push({ ...rect, kind, label })
  }
  return marks
}
