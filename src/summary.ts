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
    const candidates = [...cell.candidates]
    const prices = candidates.map((c) => book.lookup(c.name))
    const known = prices.map(bounds).filter((b): b is [number, number] => b !== null)
    groups.set(key, {
      key,
      candidates,
      count: 1,
      prices,
      unitMin: known.length ? Math.min(...known.map((b) => b[0])) : null,
      unitMax: known.length ? Math.max(...known.map((b) => b[1])) : null,
    })
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
