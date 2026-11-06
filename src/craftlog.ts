// Records which gems Vivid Watcher crafts produced, for an expected-value
// estimate per beast. Scans are diffed against the last recorded inventory so
// rescans, partial sales and re-opened overlays never count a gem twice.
import type { Candidate, CellResult } from './match'
import type { GemPrice, PriceBook } from './pricing'

export const LOG_KEY = 'craftLog'
export const GEMS_PER_BEAST = 3

/** A cell's recorded identity: the gem name, or every look-alike candidate
 *  joined (sorted) when the art can't tell them apart. Always 20/20. */
export type GemKey = string

export interface Batch {
  at: number
  gems: { slot: string; key: GemKey }[]
}

export interface CraftLog {
  batches: Batch[]
  /** slot ("col,row") -> gem last recorded there */
  snapshot: Record<string, GemKey>
}

export const EMPTY_LOG: CraftLog = { batches: [], snapshot: {} }

export function gemKey(candidates: Candidate[]): GemKey {
  return candidates
    .map((c) => c.name)
    .sort()
    .join(' | ')
}

export type RecordOutcome =
  | { kind: 'recorded'; count: number }
  | { kind: 'none-new' }
  | { kind: 'skipped'; reason: string }

/** Scans with this many unreadable cells (or more than this share of the
 *  occupied ones) aren't recorded: probably not a gem inventory, or the
 *  inventory was closed. */
const MAX_UNKNOWN = 2
const MAX_UNKNOWN_SHARE = 0.2

/** Diff a scan against the log. Gems in slots that are new or changed since
 *  the last recorded scan form a new batch; every other slot is one already
 *  counted. The snapshot always becomes this scan's inventory. */
export function recordScan(log: CraftLog, cells: CellResult[], at: number): { log: CraftLog; outcome: RecordOutcome } {
  const occupied = cells.filter((c) => c.status !== 'empty')
  const unknown = occupied.filter((c) => c.status === 'unknown').length
  if (unknown > MAX_UNKNOWN && unknown > occupied.length * MAX_UNKNOWN_SHARE) {
    return { log, outcome: { kind: 'skipped', reason: `${unknown} unreadable cells` } }
  }
  const snapshot: Record<string, GemKey> = {}
  const fresh: Batch['gems'] = []
  for (const c of occupied) {
    const slot = `${c.col},${c.row}`
    // A cell that misreads once keeps what it was, so it isn't recounted
    // when it reads again.
    if (c.status !== 'matched') {
      if (log.snapshot[slot]) snapshot[slot] = log.snapshot[slot]
      continue
    }
    const key = gemKey(c.candidates)
    snapshot[slot] = key
    if (log.snapshot[slot] !== key) fresh.push({ slot, key })
  }
  if (!fresh.length) return { log: { ...log, snapshot }, outcome: { kind: 'none-new' } }
  return {
    log: { batches: [...log.batches, { at, gems: fresh }], snapshot },
    outcome: { kind: 'recorded', count: fresh.length },
  }
}

/** Drop the newest batch and forget its slots, so rescanning the same
 *  inventory records it again. */
export function undoLastBatch(log: CraftLog): CraftLog {
  const last = log.batches[log.batches.length - 1]
  if (!last) return log
  const snapshot = { ...log.snapshot }
  for (const g of last.gems) if (snapshot[g.slot] === g.key) delete snapshot[g.slot]
  return { batches: log.batches.slice(0, -1), snapshot }
}

export function gemCounts(log: CraftLog): Map<GemKey, number> {
  const counts = new Map<GemKey, number>()
  for (const b of log.batches) for (const g of b.gems) counts.set(g.key, (counts.get(g.key) ?? 0) + 1)
  return counts
}

function midpoint(p: GemPrice): number | null {
  if (p.kind === 'exact') return p.chaos
  if (p.kind === 'range') return (p.min + p.max) / 2
  return null
}

/** Chaos value of a recorded gem; look-alikes take the mean of their priced
 *  candidates. Null when nothing is priced. */
export function gemValue(key: GemKey, book: PriceBook): number | null {
  const vals = key
    .split(' | ')
    .map((n) => midpoint(book.lookup(n)))
    .filter((v): v is number => v !== null)
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
}

export interface EvRow {
  key: GemKey
  count: number
  unit: number | null
  /** Share of the sample's total value */
  share: number
}

export interface CraftEv {
  gems: number
  unpriced: number
  meanGem: number
  evPerBeast: number
  /** Half-width of the 95% confidence interval on evPerBeast */
  ci95: number
  beastChaos: number | null
  profitPerBeast: number | null
  roi: number | null
  rows: EvRow[]
}

/** Sample estimate of a beast's value: GEMS_PER_BEAST x the mean recorded gem
 *  value, with unpriced gems counted as worth nothing. */
export function craftEv(log: CraftLog, book: PriceBook, beastChaos: number | null): CraftEv {
  const counts = gemCounts(log)
  let n = 0
  let sum = 0
  let sumSq = 0
  let unpriced = 0
  const rows: EvRow[] = []
  for (const [key, count] of counts) {
    const unit = gemValue(key, book)
    if (unit === null) unpriced += count
    const v = unit ?? 0
    n += count
    sum += v * count
    sumSq += v * v * count
    rows.push({ key, count, unit, share: 0 })
  }
  const mean = n ? sum / n : 0
  const variance = n > 1 ? Math.max(0, (sumSq - n * mean * mean) / (n - 1)) : 0
  for (const r of rows) r.share = sum ? ((r.unit ?? 0) * r.count) / sum : 0
  rows.sort((a, b) => b.share - a.share || b.count - a.count)
  const evPerBeast = GEMS_PER_BEAST * mean
  const profit = beastChaos === null ? null : evPerBeast - beastChaos
  return {
    gems: n,
    unpriced,
    meanGem: mean,
    evPerBeast,
    ci95: n > 1 ? GEMS_PER_BEAST * 1.96 * Math.sqrt(variance / n) : 0,
    beastChaos,
    profitPerBeast: profit,
    roi: profit === null || !beastChaos ? null : profit / beastChaos,
    rows,
  }
}
