import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, ErrorBanner, Label, ScrubInput, formatPrice, type ScalpelPluginContext } from '@scalpelpoe/plugin-sdk'
import { type Calibration, INVENTORY_COLS, INVENTORY_ROWS } from './grid'
import { type PriceBook, GEM_CATEGORY, TARGET_VARIANT, buildPriceBook } from './pricing'
import { CALIBRATION_KEY, ORDER_KEY, type ListOrder, type ScanOutcome, runScan, scanCapture } from './scan'
import { setState, useStore } from './store'
import { type SummaryRow, inventoryOrder, summarize } from './summary'

function usePriceBook(ctx: ScalpelPluginContext): PriceBook | null {
  const [book, setBook] = useState<PriceBook | null>(null)
  useEffect(() => {
    let alive = true
    const load = async (): Promise<void> => {
      const [gems, currency] = await Promise.all([
        ctx.prices.getPrices({ category: GEM_CATEGORY }),
        ctx.prices.getPrices({ category: 'currency' }),
      ])
      if (alive) setBook(buildPriceBook(gems.prices, currency.prices, gems.updatedAt))
    }
    void load()
    const off = ctx.prices.onChange(() => void load())
    return () => {
      alive = false
      off()
    }
  }, [ctx])
  return book
}

function priceRange(min: number | null, max: number | null, unit = 'c'): string {
  if (min === null || max === null) return '-'
  return min === max ? `${formatPrice(min)}${unit}` : `${formatPrice(min)}${unit} - ${formatPrice(max)}${unit}`
}

const muted = { color: 'var(--text-muted, rgba(255,255,255,0.55))' }
const cellPad = { padding: '4px 6px' }

function Row({ row }: { row: SummaryRow }): JSX.Element {
  const ambiguous = row.candidates.length > 1
  return (
    <tr style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <td style={cellPad}>
        {row.candidates.length > 0 && (
          <img src={row.candidates[0].icon} alt="" width={28} height={28} style={{ display: 'block' }} />
        )}
      </td>
      <td style={cellPad}>
        {row.candidates.length === 0 && <span style={muted}>Unreadable</span>}
        {row.candidates.map((c, i) => (
          <div key={c.name} style={i > 0 ? muted : undefined}>
            {i > 0 ? 'or ' : ''}
            {c.name}
            {ambiguous && <span style={muted}> ({priceRange(...priceBounds(row, i))})</span>}
          </div>
        ))}
        {ambiguous && <div style={{ ...muted, fontSize: 11 }}>Look-alike art: hover it in game to confirm</div>}
      </td>
      <td style={{ ...cellPad, textAlign: 'right' }}>
        {row.slot ? <span style={muted}>{slotLabel(row.slot)}</span> : row.count}
      </td>
      <td style={{ ...cellPad, textAlign: 'right' }}>{priceRange(row.unitMin, row.unitMax)}</td>
      <td style={{ ...cellPad, textAlign: 'right' }}>
        {priceRange(row.unitMin === null ? null : row.unitMin * row.count, row.unitMax === null ? null : row.unitMax * row.count)}
      </td>
    </tr>
  )
}

/** Column then row, 1-based, matching the down-then-across fill order. */
function slotLabel(slot: { col: number; row: number }): string {
  return `${slot.col + 1}-${slot.row + 1}`
}

function priceBounds(row: SummaryRow, i: number): [number | null, number | null] {
  const p = row.prices[i]
  if (p.kind === 'exact') return [p.chaos, p.chaos]
  if (p.kind === 'range') return [p.min, p.max]
  return [null, null]
}

/** The captured inventory area with the scan grid drawn over it, so the user
 *  can see whether calibration lines the grid up with the real cells. */
function GridPreview({ scan }: { scan: ScanOutcome }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const { capture, grid, offset, cells } = scan
    const margin = grid.cell * 0.5
    const sx = Math.max(0, Math.floor(grid.x + offset.dx - margin))
    const sy = Math.max(0, Math.floor(grid.y + offset.dy - margin))
    const sw = Math.min(capture.width - sx, Math.ceil(grid.cell * INVENTORY_COLS + margin * 2))
    const sh = Math.min(capture.height - sy, Math.ceil(grid.cell * INVENTORY_ROWS + margin * 2))
    if (sw <= 0 || sh <= 0) return
    canvas.width = sw
    canvas.height = sh
    const g = canvas.getContext('2d')
    if (!g) return
    const crop = new ImageData(sw, sh)
    for (let y = 0; y < sh; y++) {
      const src = ((sy + y) * capture.width + sx) * 4
      crop.data.set(capture.pixels.subarray(src, src + sw * 4), y * sw * 4)
    }
    g.putImageData(crop, 0, 0)
    g.lineWidth = Math.max(1, grid.cell / 30)
    for (const c of cells) {
      const x = grid.x + offset.dx + c.col * grid.cell - sx
      const y = grid.y + offset.dy + c.row * grid.cell - sy
      g.strokeStyle =
        c.status === 'empty'
          ? 'rgba(255,255,255,0.25)'
          : c.status === 'unknown'
            ? '#e5484d'
            : c.candidates.length > 1
              ? '#f5a623'
              : '#46a758'
      g.strokeRect(x, y, grid.cell, grid.cell)
    }
  }, [scan])
  return <canvas ref={ref} style={{ width: '100%', imageRendering: 'auto', borderRadius: 4 }} />
}

function CalibrationPanel({ ctx }: { ctx: ScalpelPluginContext }): JSX.Element {
  const { calibration, scan } = useStore()
  const update = (patch: Partial<Calibration>): void => {
    const next = { ...calibration, ...patch }
    // Re-run against the last capture so the preview updates without needing
    // the game focused again.
    setState({ calibration: next, scan: scan ? scanCapture(scan.capture, next) : null })
    void ctx.storage.set(CALIBRATION_KEY, next)
  }
  return (
    <details style={{ marginTop: 16 }}>
      <summary style={{ cursor: 'pointer' }}>Calibration</summary>
      <p style={{ ...muted, fontSize: 12 }}>
        Green = matched, amber = look-alike, red = unreadable, grey = empty. If the boxes don't sit on the inventory
        cells, nudge them below; scans also auto-correct small offsets.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 8, alignItems: 'center' }}>
        <Label>Offset X</Label>
        <ScrubInput value={calibration.offsetX} onChange={(v) => update({ offsetX: v ?? 0 })} step={1} suffix="px" />
        <Label>Offset Y</Label>
        <ScrubInput value={calibration.offsetY} onChange={(v) => update({ offsetY: v ?? 0 })} step={1} suffix="px" />
        <Label>Cell size</Label>
        <ScrubInput
          value={calibration.cellScale}
          onChange={(v) => update({ cellScale: v ?? 1 })}
          min={0.5}
          max={2}
          step={0.005}
          decimals={3}
          suffix="x"
        />
      </div>
      {scan ? (
        <div style={{ marginTop: 8 }}>
          <GridPreview scan={scan} />
          <div style={{ ...muted, fontSize: 11 }}>
            Auto-align: {(scan.offset.dx / scan.capture.scale).toFixed(1)}, {(scan.offset.dy / scan.capture.scale).toFixed(1)}{' '}
            px
          </div>
        </div>
      ) : (
        <p style={muted}>Scan once to see the grid preview.</p>
      )}
    </details>
  )
}

export function Panel({ ctx }: { ctx: ScalpelPluginContext }): JSX.Element {
  const { scan, scanning, error, order } = useStore()
  const book = usePriceBook(ctx)
  const summary = useMemo(() => (scan && book ? summarize(scan.cells, book) : null), [scan, book])
  const rows = useMemo(
    () => (scan && book && summary ? (order === 'inventory' ? inventoryOrder(scan.cells, book) : summary.rows) : []),
    [scan, book, summary, order],
  )
  const setOrder = (next: ListOrder): void => {
    setState({ order: next })
    void ctx.storage.set(ORDER_KEY, next)
  }

  return (
    <div style={{ padding: 12, color: 'var(--text)', fontSize: 13 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Button variant="primary" onClick={() => void runScan(ctx)} disabled={scanning}>
          {scanning ? 'Scanning...' : 'Scan inventory'}
        </Button>
        <span style={{ ...muted, fontSize: 12 }}>
          Tip: bind "Scan inventory gems" in Settings &gt; Macros and press it in game with your inventory open.
        </span>
      </div>

      {error && (
        <div style={{ marginTop: 12 }}>
          <ErrorBanner message={error} tone="warn" />
        </div>
      )}

      {book && !book.hasVariants && (
        <div style={{ marginTop: 12 }}>
          <ErrorBanner
            tone="warn"
            message={`This Scalpel version doesn't pass gem level/quality to plugins, so each gem shows the range across all its poe.ninja listings instead of the exact ${TARGET_VARIANT} price.`}
          />
        </div>
      )}

      {summary && (
        <>
          <div style={{ marginTop: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ ...muted, fontSize: 12 }}>List:</span>
            <Button size="sm" variant={order === 'value' ? 'primary' : 'ghost'} onClick={() => setOrder('value')}>
              By value
            </Button>
            <Button size="sm" variant={order === 'inventory' ? 'primary' : 'ghost'} onClick={() => setOrder('inventory')}>
              Inventory order
            </Button>
          </div>
          <div style={{ marginTop: 12 }}>
            <strong>{summary.gems}</strong> gems
            {summary.unknown > 0 && <span style={muted}> - {summary.unknown} cells unreadable</span>}
            {' - total '}
            <strong>{priceRange(summary.totalMin, summary.totalMax)}</strong>
            {book?.divineChaos && (
              <span style={muted}>
                {' '}
                ({priceRange(summary.totalMin / book.divineChaos, summary.totalMax / book.divineChaos, ' div')})
              </span>
            )}
          </div>
          <table style={{ width: '100%', marginTop: 8, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ ...muted, textAlign: 'left', fontSize: 11 }}>
                <th />
                <th style={cellPad}>Gem ({TARGET_VARIANT})</th>
                <th style={{ ...cellPad, textAlign: 'right' }}>
                  {order === 'inventory' ? <span title="Column-row, counted down each column">Slot</span> : 'Qty'}
                </th>
                <th style={{ ...cellPad, textAlign: 'right' }}>Each</th>
                <th style={{ ...cellPad, textAlign: 'right' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Row key={r.key} row={r} />
              ))}
            </tbody>
          </table>
          {book?.updatedAt && (
            <div style={{ ...muted, fontSize: 11, marginTop: 8 }}>
              poe.ninja prices from {new Date(book.updatedAt).toLocaleTimeString()}
            </div>
          )}
        </>
      )}

      <CalibrationPanel ctx={ctx} />
    </div>
  )
}
