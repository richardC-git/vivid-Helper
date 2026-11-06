import type { Candidate, CellResult } from './match'
import type { GemPrice, PriceBook } from './pricing'

export interface SummaryRow {
  key: string
  /** One entry for a confident match; several when the art is ambiguous */
  candidates: Candidate[]
  count: number
  /** Price per candidate, aligned with `candidates` */
  prices: GemPrice[]
  /** Per-gem value bounds across candidates and (without variants) price lines */
  unitMin: number | null
  unitMax: number | null
  /** Inventory cell, set on per-cell rows (see inventoryOrder) */
  slot?: { col: number; row: number }
}

export interface Summary {
  rows: SummaryRow[]
  gems: number
  unknown: number
  totalMin: number
  totalMax: number
}

function bounds(p: GemPrice): [number, number] | null {
  if (p.kind === 'exact') return [p.chaos, p.chaos]
  if (p.kind === 'range') return [p.min, p.max]
  return null
}

export function priceRow(key: string, cellCandidates: Candidate[], book: PriceBook): SummaryRow {
  const candidates = [...cellCandidates]
  const prices = candidates.map((c) => book.lookup(c.name))
  const known = prices.map(bounds).filter((b): b is [number, number] => b !== null)
  return {
    key,
    candidates,
    count: 1,
    prices,
    unitMin: known.length ? Math.min(...known.map((b) => b[0])) : null,
    unitMax: known.length ? Math.max(...known.map((b) => b[1])) : null,
  }
}

/** One row per occupied cell in the order PoE fills the inventory: down each
 *  column, then to the next column. Unreadable cells keep their place (with
 *  no candidates) so the list lines up with the inventory. */
export function inventoryOrder(cells: CellResult[], book: PriceBook): SummaryRow[] {
  return cells
    .filter((c) => c.status !== 'empty')
    .sort((a, b) => a.col - b.col || a.row - b.row)
    .map((c) => ({ ...priceRow(`${c.col},${c.row}`, c.status === 'matched' ? c.candidates : [], book), slot: { col: c.col, row: c.row } }))
}

/** Group matched cells by their candidate set and price each group. */
export function summarize(cells: CellResult[], book: PriceBook): Summary {
  const groups = new Map<string, SummaryRow>()
  let unknown = 0
  for (const cell of cells) {
    if (cell.status === 'unknown') unknown++
    if (cell.status !== 'matched') continue
    const names = cell.candidates.map((c) => c.name).sort()
    const key = names.join(' | ')
    const row = groups.get(key)
    if (row) {
      row.count++
      continue
    }
    groups.set(key, priceRow(key, cell.candidates, book))
  }
  const rows = [...groups.values()].sort((a, b) => (b.unitMax ?? -1) * b.count - (a.unitMax ?? -1) * a.count)
  return {
    rows,
    gems: rows.reduce((n, r) => n + r.count, 0),
    unknown,
    totalMin: rows.reduce((n, r) => n + (r.unitMin ?? 0) * r.count, 0),
    totalMax: rows.reduce((n, r) => n + (r.unitMax ?? 0) * r.count, 0),
  }
}
