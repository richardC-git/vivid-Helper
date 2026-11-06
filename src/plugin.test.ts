import { describe, expect, it } from 'vitest'
import type { PriceEntry } from '@scalpelpoe/plugin-sdk'
import { FP_SIZE, type Fingerprint } from './fingerprint'
import { DEFAULT_CALIBRATION, inventoryGrid } from './grid'
import { GEM_REFS, matchCell } from './match'
import { buildPriceBook } from './pricing'
import { EMPTY_LOG, craftEv, gemCounts, recordScan, undoLastBatch } from './craftlog'
import { buildOverlay, formatValue } from './overlay'
import type { ScanOutcome } from './scan'
import { inventoryOrder, summarize } from './summary'

const gem = (name: string, chaosValue: number, variant?: string): PriceEntry =>
  ({ name, category: 'skill-gem', chaosValue, ...(variant === undefined ? {} : { variant }) }) as PriceEntry
const divine = { name: 'Divine Orb', category: 'currency', chaosValue: 200 }

/** A reference icon as if captured over a black inventory cell. */
function asCapture(fp: Fingerprint): Fingerprint {
  const rgb = new Uint8Array(fp.rgb.length)
  for (let k = 0; k < fp.alpha.length; k++) {
    for (let c = 0; c < 3; c++) rgb[k * 3 + c] = Math.round((fp.rgb[k * 3 + c] * fp.alpha[k]) / 255)
  }
  return { rgb, alpha: new Uint8Array(fp.alpha.length).fill(255) }
}

describe('pricing', () => {
  it('uses the exact 20/20 line when the host passes variants', () => {
    const book = buildPriceBook([gem('Multistrike Support', 8, '1'), gem('Multistrike Support', 74, '20/20')], [divine], 1)
    expect(book.hasVariants).toBe(true)
    expect(book.lookup('multistrike support')).toEqual({ kind: 'exact', chaos: 74 })
    expect(book.divineChaos).toBe(200)
  })

  it('has no price when variants exist but no 20/20 line does', () => {
    const book = buildPriceBook([gem('Enlighten Support', 300, '3')], [], null)
    expect(book.lookup('Enlighten Support')).toEqual({ kind: 'none' })
  })

  it('falls back to the spread across lines without variants', () => {
    const book = buildPriceBook([gem('Multistrike Support', 146), gem('Multistrike Support', 8)], [], null)
    expect(book.hasVariants).toBe(false)
    expect(book.lookup('Multistrike Support')).toEqual({ kind: 'range', min: 8, max: 146 })
    expect(book.lookup('Nope Support')).toEqual({ kind: 'none' })
  })
})

describe('inventoryGrid', () => {
  it('matches the 1080p reference layout', () => {
    const g = inventoryGrid({ width: 1920, height: 1080 }, DEFAULT_CALIBRATION)
    expect(g.x).toBeCloseTo(1271)
    expect(g.y).toBeCloseTo(588)
    expect(g.cell).toBeCloseTo(52.6)
  })

  it('scales with height and anchors to the right edge', () => {
    const g = inventoryGrid({ width: 3440, height: 1440 }, { offsetX: 5, offsetY: -2, cellScale: 1 })
    expect(g.x).toBeCloseTo(3440 - (649 * 1440) / 1080 + 5)
    expect(g.y).toBeCloseTo((588 * 1440) / 1080 - 2)
    expect(g.cell).toBeCloseTo((52.6 * 1440) / 1080)
  })
})

describe('matchCell', () => {
  it('bundles fingerprints for every support gem', () => {
    expect(GEM_REFS.length).toBeGreaterThan(250)
    expect(GEM_REFS.every((r) => r.fp.rgb.length === FP_SIZE * FP_SIZE * 3)).toBe(true)
  })

  it('identifies each reference icon as itself (top or look-alike candidate)', () => {
    for (const ref of GEM_REFS) {
      const r = matchCell(asCapture(ref.fp))
      expect(r.status, ref.name).toBe('matched')
      expect(r.candidates.map((c) => c.name), ref.name).toContain(ref.name)
    }
  })

  it('treats a flat dark cell as empty', () => {
    const n = FP_SIZE * FP_SIZE
    expect(matchCell({ rgb: new Uint8Array(n * 3).fill(12), alpha: new Uint8Array(n).fill(255) }).status).toBe('empty')
  })

  it('treats the faint tiled emblem of a real empty cell as empty', () => {
    // Real empty cells measure a luma std dev of 5-7 around a mean of ~10.
    const n = FP_SIZE * FP_SIZE
    const rgb = new Uint8Array(n * 3)
    for (let k = 0; k < n; k++) rgb.fill(k % 3 === 0 ? 22 : 4, k * 3, k * 3 + 3)
    expect(matchCell({ rgb, alpha: new Uint8Array(n).fill(255) }).status).toBe('empty')
  })
})

describe('summarize', () => {
  it('groups duplicates and totals them', () => {
    const book = buildPriceBook([gem('A Support', 10, '20/20'), gem('B Support', 3, '20/20')], [], null)
    const cell = (name: string) => ({
      col: 0,
      row: 0,
      status: 'matched' as const,
      candidates: [{ name, icon: '', distance: 1 }],
    })
    const s = summarize([cell('A Support'), cell('B Support'), cell('A Support'), { col: 0, row: 0, status: 'unknown', candidates: [] }], book)
    expect(s.gems).toBe(3)
    expect(s.unknown).toBe(1)
    expect(s.rows[0]).toMatchObject({ key: 'A Support', count: 2, unitMin: 10 })
    expect(s.totalMin).toBe(23)
    expect(s.totalMax).toBe(23)
  })
})

describe('inventoryOrder', () => {
  it('lists cells down each column, keeping unreadable cells in place', () => {
    const book = buildPriceBook([gem('A Support', 10, '20/20'), gem('B Support', 3, '20/20')], [], null)
    const at = (col: number, row: number, name?: string) => ({
      col,
      row,
      status: name ? ('matched' as const) : ('unknown' as const),
      candidates: name ? [{ name, icon: '', distance: 1 }] : [],
    })
    const rows = inventoryOrder(
      [at(1, 0, 'A Support'), { col: 2, row: 0, status: 'empty', candidates: [] }, at(0, 1), at(0, 0, 'B Support')],
      book,
    )
    expect(rows.map((r) => r.slot)).toEqual([
      { col: 0, row: 0 },
      { col: 0, row: 1 },
      { col: 1, row: 0 },
    ])
    expect(rows[0]).toMatchObject({ count: 1, unitMin: 3 })
    expect(rows[1].candidates).toEqual([])
  })
})

describe('buildOverlay', () => {
  const book = buildPriceBook(
    [gem('Cheap Support', 5, '20/20'), gem('Rich Support', 900, '20/20'), gem('Twin Support', 50, '20/20')],
    [divine],
    null,
  )
  const matched = (col: number, row: number, ...names: string[]) => ({
    col,
    row,
    status: 'matched' as const,
    candidates: names.map((name) => ({ name, icon: '', distance: 1 })),
  })
  const scan = {
    capture: { origin: { x: 0, y: 0 }, scale: 2 },
    grid: { x: 200, y: 100, cell: 100 },
    offset: { dx: 10, dy: 0 },
    cells: [
      matched(0, 0, 'Cheap Support'),
      matched(1, 0, 'Rich Support'),
      matched(0, 1, 'Twin Support', 'Cheap Support'),
      matched(2, 0, 'Unlisted Support'),
      { col: 3, row: 0, status: 'unknown' as const, candidates: [] },
      { col: 4, row: 0, status: 'empty' as const, candidates: [] },
    ],
  } as unknown as ScanOutcome

  it('places marks in game CSS px, including the auto-align offset', () => {
    const marks = buildOverlay(scan, book, null)
    expect(marks).toHaveLength(5)
    expect(marks[0]).toMatchObject({ x: 105, y: 50, size: 50 })
    expect(marks[1]).toMatchObject({ x: 155, y: 50 })
  })

  it('fades gems under the threshold, judging look-alikes by their best reading', () => {
    const kinds = buildOverlay(scan, book, 20).map((m) => [m.kind, m.label])
    expect(kinds).toEqual([
      ['below', '5c'],
      ['above', '4.5d'],
      ['lookalike', '50c?'],
      ['unpriced', 'no price'],
      ['unknown', '?'],
    ])
  })

  it('can leave unpriced gems off entirely', () => {
    const kinds = buildOverlay(scan, book, 20, true).map((m) => m.kind)
    expect(kinds).toEqual(['below', 'above', 'lookalike', 'unknown'])
  })

  it('labels in chaos only when asked', () => {
    expect(buildOverlay(scan, book, null, false, true)[1].label).toBe('900c')
  })

  it('formats chaos, thousands and divines compactly', () => {
    expect(formatValue(0.46, 200)).toBe('0.5c')
    expect(formatValue(93.4, 200)).toBe('93c')
    expect(formatValue(1500, null)).toBe('1.5kc')
    expect(formatValue(300, 200)).toBe('1.5d')
  })
})

describe('craft log', () => {
  const at = (col: number, row: number, ...names: string[]) => ({
    col,
    row,
    status: names.length ? ('matched' as const) : ('unknown' as const),
    candidates: names.map((name) => ({ name, icon: '', distance: 1 })),
  })
  const first = [at(0, 0, 'A Support'), at(0, 1, 'B Support'), at(1, 0, 'Minion Pact Support', 'Communion Support')]

  it('logs a new inventory once, however often it is rescanned', () => {
    const one = recordScan(EMPTY_LOG, first, 1)
    expect(one.outcome).toEqual({ kind: 'recorded', count: 3 })
    const again = recordScan(one.log, first, 2)
    expect(again.outcome).toEqual({ kind: 'none-new' })
    expect(again.log.batches).toHaveLength(1)
    expect(gemCounts(again.log).get('Communion Support | Minion Pact Support')).toBe(1)
  })

  it('logs only the changed slots after selling some and crafting more', () => {
    const { log } = recordScan(EMPTY_LOG, first, 1)
    // A sold, B kept, a new gem where A was and one in a fresh slot.
    const next = recordScan(log, [at(0, 0, 'C Support'), at(0, 1, 'B Support'), at(2, 0, 'A Support')], 2)
    expect(next.outcome).toEqual({ kind: 'recorded', count: 2 })
    expect(gemCounts(next.log).get('A Support')).toBe(2)
    expect(gemCounts(next.log).get('B Support')).toBe(1)
  })

  it("doesn't recount a gem that misread for one scan", () => {
    const { log } = recordScan(EMPTY_LOG, first, 1)
    const misread = recordScan(log, [at(0, 0), at(0, 1, 'B Support')], 2).log
    expect(recordScan(misread, [at(0, 0, 'A Support'), at(0, 1, 'B Support')], 3).outcome.kind).toBe('none-new')
  })

  it('skips scans that are mostly unreadable', () => {
    const r = recordScan(EMPTY_LOG, [at(0, 0, 'A Support'), at(1, 0), at(2, 0), at(3, 0)], 1)
    expect(r.outcome.kind).toBe('skipped')
    expect(r.log).toBe(EMPTY_LOG)
  })

  it('undo forgets the batch so a rescan logs it again', () => {
    const { log } = recordScan(EMPTY_LOG, first, 1)
    const undone = undoLastBatch(log)
    expect(undone.batches).toHaveLength(0)
    expect(recordScan(undone, first, 2).outcome).toEqual({ kind: 'recorded', count: 3 })
  })

  it('values a beast as three times the mean gem, unpriced as zero', () => {
    const book = buildPriceBook(
      [gem('A Support', 30, '20/20'), gem('Communion Support', 10, '20/20'), gem('Minion Pact Support', 20, '20/20')],
      [],
      null,
    )
    const log = recordScan(EMPTY_LOG, [...first.slice(0, 1), at(0, 1, 'Unlisted Support'), first[2]], 1).log
    // Values 30, 0, and the look-alike's mean of 10 and 20 = 15.
    const ev = craftEv(log, book, 20)
    expect(ev.gems).toBe(3)
    expect(ev.unpriced).toBe(1)
    expect(ev.meanGem).toBe(15)
    expect(ev.evPerBeast).toBe(45)
    expect(ev.profitPerBeast).toBe(25)
    expect(ev.roi).toBe(1.25)
    expect(ev.ci95).toBeCloseTo(3 * 1.96 * Math.sqrt(225 / 3), 6)
    expect(ev.rows[0]).toMatchObject({ key: 'A Support', share: 30 / 45 })
  })
})
