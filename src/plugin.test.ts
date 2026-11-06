import { describe, expect, it } from 'vitest'
import type { PriceEntry } from '@scalpelpoe/plugin-sdk'
import { FP_SIZE, type Fingerprint } from './fingerprint'
import { DEFAULT_CALIBRATION, inventoryGrid } from './grid'
import { GEM_REFS, matchCell } from './match'
import { buildPriceBook } from './pricing'
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
