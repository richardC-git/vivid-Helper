import refsData from './data/gem-refs.json'
import { type Fingerprint, type RgbaImage, decodeBytes, distance, fingerprintRegion, lumaStdDev } from './fingerprint'
import { INVENTORY_COLS, INVENTORY_ROWS, type GridRect } from './grid'

export interface GemRef {
  name: string
  icon: string
  fp: Fingerprint
}

export const GEM_REFS: GemRef[] = refsData.gems.map((g) => ({
  name: g.name,
  icon: g.icon,
  fp: { rgb: decodeBytes(g.rgb), alpha: decodeBytes(g.alpha) },
}))

// Thresholds on the 0..255 scale of `distance` / `lumaStdDev`. Tuned against
// synthetic renders (npm run sim); adjust against real captures if needed.
export const EMPTY_STDDEV = 6
// Correct synthetic matches peak around 24; the slack is for real captures.
export const MATCH_MAX_DISTANCE = 40
/** Best and runner-up closer than this are flagged as uncertain. */
export const AMBIGUOUS_GAP = 3

// Auto-alignment: a few px of calibration error shifts the 16x16 sampling
// grid enough to wreck matching, so each scan searches a small window of
// whole-grid offsets (as a fraction of cell size) on a handful of occupied
// cells and keeps the best one.
const ALIGN_RANGE = 0.08
const ALIGN_STEPS = 4
const ALIGN_SAMPLE_CELLS = 12
/** Refs per sampled cell the offset search scores against (vs all ~260). */
const ALIGN_SHORTLIST = 8

export interface Candidate {
  name: string
  icon: string
  distance: number
}

export interface CellResult {
  col: number
  row: number
  status: 'empty' | 'matched' | 'unknown'
  /** Best match first. More than one entry means the icons are too alike to
   *  tell apart (some support gems share near-identical or identical art). */
  candidates: Candidate[]
  /** Best distance, also set for 'unknown' cells to help tune thresholds */
  distance?: number
}

export interface ScanResult {
  cells: CellResult[]
  /** Auto-alignment offset applied on top of `grid`, in frame px */
  offset: { dx: number; dy: number }
}

function bestDistance(fp: Fingerprint, refs: GemRef[]): number {
  let best = Infinity
  for (const ref of refs) best = Math.min(best, distance(fp, ref.fp))
  return best
}

function shortlist(fp: Fingerprint, k: number): GemRef[] {
  return GEM_REFS.map((ref) => ({ ref, d: distance(fp, ref.fp) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, k)
    .map((x) => x.ref)
}

export function matchCell(fp: Fingerprint): Omit<CellResult, 'col' | 'row'> {
  if (lumaStdDev(fp) < EMPTY_STDDEV) return { status: 'empty', candidates: [] }
  const scored = GEM_REFS.map((ref) => ({ name: ref.name, icon: ref.icon, distance: distance(fp, ref.fp) })).sort(
    (a, b) => a.distance - b.distance,
  )
  const bestD = scored[0].distance
  if (bestD > MATCH_MAX_DISTANCE) return { status: 'unknown', candidates: [], distance: bestD }
  return { status: 'matched', candidates: scored.filter((c) => c.distance <= bestD + AMBIGUOUS_GAP), distance: bestD }
}

// Each cell is fingerprinted whole so it lines up with the full-image
// reference; grid lines fall in the icons' transparent margin, which the
// reference alpha masks out of the distance.
function cellFingerprint(frame: RgbaImage, grid: GridRect, col: number, row: number, dx: number, dy: number): Fingerprint {
  return fingerprintRegion(frame, grid.x + col * grid.cell + dx, grid.y + row * grid.cell + dy, grid.cell, grid.cell)
}

function findAlignment(frame: RgbaImage, grid: GridRect): { dx: number; dy: number } {
  const occupied: { col: number; row: number; refs: GemRef[] }[] = []
  for (let row = 0; row < INVENTORY_ROWS && occupied.length < ALIGN_SAMPLE_CELLS; row++) {
    for (let col = 0; col < INVENTORY_COLS && occupied.length < ALIGN_SAMPLE_CELLS; col++) {
      const fp = cellFingerprint(frame, grid, col, row, 0, 0)
      if (lumaStdDev(fp) >= EMPTY_STDDEV) occupied.push({ col, row, refs: shortlist(fp, ALIGN_SHORTLIST) })
    }
  }
  if (!occupied.length) return { dx: 0, dy: 0 }
  const step = (grid.cell * ALIGN_RANGE) / ALIGN_STEPS
  let bestScore = Infinity
  let bestOffset = { dx: 0, dy: 0 }
  for (let iy = -ALIGN_STEPS; iy <= ALIGN_STEPS; iy++) {
    for (let ix = -ALIGN_STEPS; ix <= ALIGN_STEPS; ix++) {
      const dx = ix * step
      const dy = iy * step
      let score = 0
      for (const c of occupied) score += bestDistance(cellFingerprint(frame, grid, c.col, c.row, dx, dy), c.refs)
      if (score < bestScore) {
        bestScore = score
        bestOffset = { dx, dy }
      }
    }
  }
  return bestOffset
}

/** Fingerprint and match every inventory cell. `grid` is in the frame's own
 *  pixel space (already converted from CSS px by the caller). */
export function scanGrid(frame: RgbaImage, grid: GridRect): ScanResult {
  const offset = findAlignment(frame, grid)
  const cells: CellResult[] = []
  for (let row = 0; row < INVENTORY_ROWS; row++) {
    for (let col = 0; col < INVENTORY_COLS; col++) {
      cells.push({ col, row, ...matchCell(cellFingerprint(frame, grid, col, row, offset.dx, offset.dy)) })
    }
  }
  return { cells, offset }
}
