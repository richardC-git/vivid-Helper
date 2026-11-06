import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, ErrorBanner, Label, ScrubInput, formatPrice, type ScalpelPluginContext } from '@scalpelpoe/plugin-sdk'
import { type Calibration, INVENTORY_COLS, INVENTORY_ROWS } from './grid'
import {
  ARCHIVE_KEY,
  EMPTY_ARCHIVE,
  EMPTY_LOG,
  GEMS_PER_BEAST,
  LOG_KEY,
  archivedBatches,
  craftEv,
  toCsv,
  undoLastBatch,
} from './craftlog'
import { rankExceptional, tradeSearchUrl } from './exceptional'
import { BEAST_NAME, ensurePriceBook } from './prices'
import { TARGET_VARIANT } from './pricing'
import {
  BEAST_PRICE_KEY,
  CALIBRATION_KEY,
  EXCEPTIONAL_KEY,
  EXCEPTIONAL_MAX_KEY,
  LOGGING_KEY,
  SAMPLE_SCOPE_KEY,
  YELLOW_BEAST_KEY,
  CHAOS_ONLY_KEY,
  HIDE_UNPRICED_KEY,
  ORDER_KEY,
  THRESHOLD_KEY,
  type ListOrder,
  type ScanOutcome,
  runScan,
  scanCapture,
} from './scan'
import { setState, useStore } from './store'
import { type SummaryRow, inventoryOrder, summarize } from './summary'


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

/** Rare ("yellow") beasts each Vivid Watcher craft also consumes. */
const YELLOW_BEASTS = 3

/** Sample size below which the EV interval is too wide to lean on. */
const SMALL_SAMPLE = 90

function CraftLogPanel({ ctx }: { ctx: ScalpelPluginContext }): JSX.Element {
  const { log, book, beastChaos, beastOverride, logging, yellowBeast, exceptional, archive, sampleScope } = useStore()
  const [confirmClear, setConfirmClear] = useState(false)
  const [confirmClearArchive, setConfirmClearArchive] = useState(false)
  const league = ctx.getLeague()
  const allBatches = useMemo(() => [...archivedBatches(archive), ...log.batches], [archive, log])
  // "This league" reads the archive too, in case a league's scans were
  // archived and the user came back to it.
  const sample = useMemo(
    () => (sampleScope === 'all' ? allBatches : allBatches.filter((b) => b.league === league)),
    [allBatches, sampleScope, league],
  )
  const countGems = (bs: typeof allBatches): number => bs.reduce((n, b) => n + b.gems.length, 0)
  const archivedLeagues = Object.entries(archive.leagues).filter(([, bs]) => bs.length)
  const setScope = (scope: 'all' | 'league'): void => {
    setState({ sampleScope: scope })
    void ctx.storage.set(SAMPLE_SCOPE_KEY, scope)
  }
  const [copied, setCopied] = useState<string | null>(null)
  const copyCsv = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(toCsv(allBatches))
      setCopied(`Copied ${countGems(allBatches)} rows`)
    } catch {
      setCopied("Couldn't reach the clipboard")
    }
  }
  const beastPrice = beastOverride ?? beastChaos
  // One craft: the Vivid Watcher, its yellow beasts and an exceptional gem.
  // Unset ingredient prices count as free, and say so below.
  const craftCost = beastPrice === null ? null : beastPrice + YELLOW_BEASTS * (yellowBeast ?? 0) + (exceptional?.chaos ?? 0)
  const ev = useMemo(() => (book ? craftEv(sample, book, craftCost) : null), [sample, book, craftCost])
  const setYellowBeast = (v: number | null): void => {
    const value = v !== null && v > 0 ? v : null
    setState({ yellowBeast: value })
    void (value === null ? ctx.storage.delete(YELLOW_BEAST_KEY) : ctx.storage.set(YELLOW_BEAST_KEY, value))
  }
  const lastBatch = log.batches[log.batches.length - 1]
  const save = (next: typeof log): void => {
    setState({ log: next, logStatus: null })
    void ctx.storage.set(LOG_KEY, next)
  }
  const toggleLogging = (): void => {
    setState({ logging: !logging })
    void ctx.storage.set(LOGGING_KEY, !logging)
  }
  const setBeastOverride = (v: number | null): void => {
    const value = v !== null && v > 0 ? v : null
    setState({ beastOverride: value })
    void (value === null ? ctx.storage.delete(BEAST_PRICE_KEY) : ctx.storage.set(BEAST_PRICE_KEY, value))
  }
  const c = (v: number): string => `${formatPrice(v)}c`
  return (
    <details open style={{ marginTop: 16 }}>
      <summary style={{ cursor: 'pointer' }}>
        Craft log{log.batches.length ? ` - ${countGems(log.batches)} gems from ${log.batches.length} scans in ${league}` : ''}
        {!logging && <span style={{ color: '#f5a623' }}> (logging off)</span>}
      </summary>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
        <Button size="sm" variant={logging ? 'primary' : 'ghost'} onClick={toggleLogging}>
          {logging ? 'Logging on' : 'Logging off'}
        </Button>
        <span style={{ ...muted, fontSize: 12 }}>
          {logging
            ? 'Turn off while testing. Scans keep track of the inventory but log nothing.'
            : "Scans aren't logged. Gems scanned now won't be logged later either; only ones that change after it's back on."}
        </span>
      </div>
      <p style={{ ...muted, fontSize: 12 }}>
        Each scan logs the gems in slots that changed since the last logged scan, so rescans and partly sold
        inventories don't count twice. Every {GEMS_PER_BEAST} gems is one {BEAST_NAME}.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Label>{BEAST_NAME} price</Label>
        <div style={{ width: 90 }}>
          <ScrubInput value={beastPrice} onChange={setBeastOverride} min={0} step={1} suffix="c" />
        </div>
        <span style={{ ...muted, fontSize: 12 }}>
          {beastOverride !== null
            ? `your price (poe.ninja: ${beastChaos === null ? 'none' : c(beastChaos)}; clear to use it)`
            : beastChaos === null
              ? 'no poe.ninja price yet, enter one'
              : 'from poe.ninja'}
        </span>
        <Button size="sm" variant="ghost" onClick={() => void ctx.prices.refresh()}>
          Refresh prices
        </Button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 6 }}>
        <Label>Yellow beast price</Label>
        <div style={{ width: 90 }}>
          <ScrubInput value={yellowBeast} onChange={setYellowBeast} min={0} step={1} suffix="c" />
        </div>
        <span style={{ ...muted, fontSize: 12 }}>
          each, x{YELLOW_BEASTS}. Exceptional gem:{' '}
          {exceptional ? `${exceptional.name} at ${c(exceptional.chaos)}` : 'none chosen (pick one in the finder below)'}
        </span>
      </div>
      {craftCost !== null && (
        <div style={{ ...muted, fontSize: 12, marginTop: 4 }}>
          Cost per craft {c(craftCost)} = {c(beastPrice ?? 0)} + {YELLOW_BEASTS} x {c(yellowBeast ?? 0)} +{' '}
          {c(exceptional?.chaos ?? 0)}
          {(yellowBeast === null || !exceptional) && ' (unset ingredients counted as free)'}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 8 }}>
        <span style={{ ...muted, fontSize: 12 }}>Sample:</span>
        <Button size="sm" variant={sampleScope === 'all' ? 'primary' : 'ghost'} onClick={() => setScope('all')}>
          All leagues ({countGems(allBatches)})
        </Button>
        <Button size="sm" variant={sampleScope === 'league' ? 'primary' : 'ghost'} onClick={() => setScope('league')}>
          This league ({countGems(allBatches.filter((b) => b.league === league))})
        </Button>
        <span style={{ ...muted, fontSize: 12 }}>Gem counts; prices are always {league}&apos;s.</span>
      </div>

      {ev && ev.gems > 0 && (
        <div style={{ marginTop: 10, lineHeight: 1.6 }}>
          <div>
            EV per craft: <strong>{c(ev.evPerBeast)}</strong>
            <span style={muted}> ± {c(ev.ci95)} (95%)</span>
          </div>
          {ev.profitPerBeast !== null && ev.roi !== null && (
            <div>
              Profit per craft: <strong>{c(ev.profitPerBeast)}</strong>
              <span style={muted}>
                {' '}
                ({ev.roi >= 0 ? '+' : ''}
                {Math.round(ev.roi * 100)}% on {c(ev.craftCost ?? 0)})
              </span>
            </div>
          )}
          <div style={{ ...muted, fontSize: 12 }}>
            Mean gem {c(ev.meanGem)} over {ev.gems} gems (~{Math.floor(ev.gems / GEMS_PER_BEAST)} crafts)
            {ev.unpriced > 0 && `; ${ev.unpriced} without a 20/20 price counted as 0`}
            {ev.gems < SMALL_SAMPLE && '. Small sample: a few lucky gems swing this a lot'}
            . Uses current prices.
          </div>
          <table style={{ width: '100%', marginTop: 6, borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ ...muted, textAlign: 'left', fontSize: 11 }}>
                <th style={cellPad}>Most value from</th>
                <th style={{ ...cellPad, textAlign: 'right' }}>Seen</th>
                <th style={{ ...cellPad, textAlign: 'right' }}>Each</th>
                <th style={{ ...cellPad, textAlign: 'right' }}>Share</th>
              </tr>
            </thead>
            <tbody>
              {ev.rows.slice(0, 10).map((r) => (
                <tr key={r.key} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <td style={cellPad}>{r.key}</td>
                  <td style={{ ...cellPad, textAlign: 'right' }}>{r.count}</td>
                  <td style={{ ...cellPad, textAlign: 'right' }}>{r.unit === null ? '-' : c(r.unit)}</td>
                  <td style={{ ...cellPad, textAlign: 'right' }}>{Math.round(r.share * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10, alignItems: 'center' }}>
        <Button size="sm" variant="ghost" disabled={!log.batches.length} onClick={() => void copyCsv()}>
          Copy CSV
        </Button>
        <Button size="sm" variant="ghost" disabled={!lastBatch} onClick={() => save(undoLastBatch(log))}>
          {lastBatch ? `Undo last scan (${lastBatch.gems.length} gems)` : 'Undo last scan'}
        </Button>
        <Button
          size="sm"
          variant={confirmClear ? 'danger' : 'ghost'}
          disabled={!log.batches.length && !confirmClear}
          onClick={() => {
            if (!confirmClear) return setConfirmClear(true)
            save(EMPTY_LOG)
            setConfirmClear(false)
          }}
          onBlur={() => setConfirmClear(false)}
        >
          {confirmClear ? `Click again to clear ${league}'s log` : 'Clear log'}
        </Button>
        {copied && <span style={{ ...muted, fontSize: 12 }}>{copied}</span>}
      </div>
      {archivedLeagues.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8, alignItems: 'center' }}>
          <span style={{ ...muted, fontSize: 12 }}>
            Archived:{' '}
            {archivedLeagues.map(([name, bs]) => `${name} ${countGems(bs)} gems`).join(', ')}. Still counted under
            All leagues and in Copy CSV.
          </span>
          <Button
            size="sm"
            variant={confirmClearArchive ? 'danger' : 'ghost'}
            onClick={() => {
              if (!confirmClearArchive) return setConfirmClearArchive(true)
              setState({ archive: EMPTY_ARCHIVE })
              void ctx.storage.set(ARCHIVE_KEY, EMPTY_ARCHIVE)
              setConfirmClearArchive(false)
            }}
            onBlur={() => setConfirmClearArchive(false)}
          >
            {confirmClearArchive ? 'Click again to delete the archive' : 'Clear archive'}
          </Button>
        </div>
      )}
    </details>
  )
}

/** Ranks exceptional supports by supply under a price cap, to pick the one
 *  most likely to be bought several at a time. Needs the fork's listing data. */
function ExceptionalPanel({ ctx }: { ctx: ScalpelPluginContext }): JSX.Element {
  const { listings, exceptionalMax, exceptional } = useStore()
  const [loading, setLoading] = useState(false)
  const supported = typeof ctx.prices.getGemListings === 'function'
  const load = async (): Promise<void> => {
    if (!ctx.prices.getGemListings || loading) return
    setLoading(true)
    try {
      const result = await ctx.prices.getGemListings()
      setState({ listings: result })
      // Keep the chosen gem's cost current.
      const chosen = exceptional && rankExceptional(result.lines, null).find((p) => p.name === exceptional.name)
      if (chosen && chosen.chaos !== exceptional.chaos) choose(chosen.name, chosen.chaos)
    } finally {
      setLoading(false)
    }
  }
  const choose = (name: string, chaos: number): void => {
    setState({ exceptional: { name, chaos } })
    void ctx.storage.set(EXCEPTIONAL_KEY, { name, chaos })
  }
  const setMax = (v: number | null): void => {
    const value = v !== null && v > 0 ? v : 10
    setState({ exceptionalMax: value })
    void ctx.storage.set(EXCEPTIONAL_MAX_KEY, value)
  }
  const picks = useMemo(() => (listings ? rankExceptional(listings.lines, exceptionalMax) : []), [listings, exceptionalMax])
  return (
    <details
      style={{ marginTop: 16 }}
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open && !listings) void load()
      }}
    >
      <summary style={{ cursor: 'pointer' }}>Exceptional gem finder</summary>
      {!supported ? (
        <p style={{ ...muted, fontSize: 12 }}>Needs the patched Scalpel build (1.0.5-gems.12 or later) for listing counts.</p>
      ) : (
        <>
          <p style={{ ...muted, fontSize: 12 }}>
            Cheapest uncorrupted listing of each exceptional support at or under the cap, most listed first: more
            listings means better odds of a seller with several. Choose one to count its price in each craft&apos;s cost.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <Label>Max price</Label>
            <div style={{ width: 90 }}>
              <ScrubInput value={exceptionalMax} onChange={setMax} min={1} step={1} suffix="c" />
            </div>
            <Button size="sm" variant="ghost" onClick={() => void load()} disabled={loading}>
              {loading ? 'Loading...' : 'Reload listings'}
            </Button>
            {listings?.updatedAt && (
              <span style={{ ...muted, fontSize: 12 }}>
                poe.ninja, {listings.league}, {new Date(listings.updatedAt).toLocaleTimeString()}
              </span>
            )}
          </div>
          {listings?.error && (
            <div style={{ marginTop: 8 }}>
              <ErrorBanner message={listings.error} tone="warn" />
            </div>
          )}
          {listings && (
            <table style={{ width: '100%', marginTop: 8, borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ ...muted, textAlign: 'left', fontSize: 11 }}>
                  <th style={cellPad}>Gem</th>
                  <th style={{ ...cellPad, textAlign: 'right' }}>Price</th>
                  <th style={{ ...cellPad, textAlign: 'right' }}>Listings</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {picks.slice(0, 15).map((p) => (
                  <tr key={p.name} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    <td style={cellPad}>
                      {p.name}
                      {p.variant && p.variant !== '1' && <span style={muted}> ({p.variant})</span>}
                    </td>
                    <td style={{ ...cellPad, textAlign: 'right' }}>{formatPrice(p.chaos)}c</td>
                    <td style={{ ...cellPad, textAlign: 'right' }}>{p.listings}</td>
                    <td style={{ ...cellPad, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <Button
                        size="sm"
                        variant="ghost"
                        title={`Search ${p.name} on the trade site (${ctx.getLeague()}) in your browser`}
                        onClick={() => ctx.openExternal(tradeSearchUrl(p.name, ctx.getLeague()))}
                      >
                        Trade
                      </Button>{' '}
                      <Button
                        size="sm"
                        variant={exceptional?.name === p.name ? 'primary' : 'ghost'}
                        onClick={() => choose(p.name, p.chaos)}
                      >
                        {exceptional?.name === p.name ? 'Chosen' : 'Choose'}
                      </Button>
                    </td>
                  </tr>
                ))}
                {!picks.length && (
                  <tr>
                    <td colSpan={4} style={{ ...cellPad, ...muted }}>
                      No exceptional supports at or under {exceptionalMax}c.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </>
      )}
    </details>
  )
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
  const { scan, scanning, error, order, book, threshold, hideUnpriced, chaosOnly } = useStore()
  useEffect(() => {
    void ensurePriceBook(ctx)
  }, [ctx])
  const summary = useMemo(() => (scan && book ? summarize(scan.cells, book) : null), [scan, book])
  const allRows = useMemo(
    () => (scan && book && summary ? (order === 'inventory' ? inventoryOrder(scan.cells, book) : summary.rows) : []),
    [scan, book, summary, order],
  )
  // Rows priced entirely under the threshold collapse into one summary line.
  // Judged by the highest possible value, so look-alikes and ranges stay if
  // either reading clears it; unpriced and unreadable rows always stay.
  const isBelow = (r: SummaryRow): boolean => threshold !== null && r.unitMax !== null && r.unitMax < threshold
  // Matched gems with no price line; unreadable rows (no candidates) stay.
  const isUnpriced = (r: SummaryRow): boolean => r.candidates.length > 0 && r.unitMax === null
  const rows = allRows.filter((r) => !isBelow(r) && !(hideUnpriced && isUnpriced(r)))
  const unpricedHidden = hideUnpriced ? allRows.filter(isUnpriced).reduce((n, r) => n + r.count, 0) : 0
  const hidden = allRows.filter(isBelow)
  const hiddenCount = hidden.reduce((n, r) => n + r.count, 0)
  const hiddenMin = hidden.reduce((n, r) => n + (r.unitMin ?? 0) * r.count, 0)
  const hiddenMax = hidden.reduce((n, r) => n + (r.unitMax ?? 0) * r.count, 0)
  const toggleChaosOnly = (): void => {
    setState({ chaosOnly: !chaosOnly })
    void ctx.storage.set(CHAOS_ONLY_KEY, !chaosOnly)
  }
  const toggleUnpriced = (): void => {
    setState({ hideUnpriced: !hideUnpriced })
    void ctx.storage.set(HIDE_UNPRICED_KEY, !hideUnpriced)
  }
  const setThreshold = (next: number | null): void => {
    const value = next !== null && next > 0 ? next : null
    setState({ threshold: value })
    void (value === null ? ctx.storage.delete(THRESHOLD_KEY) : ctx.storage.set(THRESHOLD_KEY, value))
  }
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
          Tip: bind "Scan inventory gems" in Settings &gt; Macros and press it in game with your inventory open. Prices appear over your inventory; close them with the overlay's ✕ or your toggle hotkey.
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
          <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <span style={{ ...muted, fontSize: 12 }}>List:</span>
            <Button size="sm" variant={order === 'value' ? 'primary' : 'ghost'} onClick={() => setOrder('value')}>
              By value
            </Button>
            <Button size="sm" variant={order === 'inventory' ? 'primary' : 'ghost'} onClick={() => setOrder('inventory')}>
              Inventory order
            </Button>
            <span style={{ ...muted, fontSize: 12, marginLeft: 12 }}>Min price:</span>
            <div style={{ width: 90 }}>
              <ScrubInput value={threshold} onChange={setThreshold} min={0} step={5} suffix="c" />
            </div>
            {threshold !== null && book?.divineChaos && (
              <span style={{ ...muted, fontSize: 12 }}>({(threshold / book.divineChaos).toFixed(2)} div)</span>
            )}
            <Button size="sm" variant={hideUnpriced ? 'primary' : 'ghost'} onClick={toggleUnpriced}>
              Hide no-price
            </Button>
            <Button size="sm" variant={chaosOnly ? 'primary' : 'ghost'} onClick={toggleChaosOnly}>
              Chaos only
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
              {hiddenCount > 0 && (
                <tr style={{ borderTop: '1px solid rgba(255,255,255,0.06)', ...muted }}>
                  <td />
                  <td style={cellPad}>
                    {hiddenCount} {hiddenCount === 1 ? 'gem' : 'gems'} under {threshold}c
                  </td>
                  <td style={{ ...cellPad, textAlign: 'right' }}>{order === 'value' ? hiddenCount : ''}</td>
                  <td />
                  <td style={{ ...cellPad, textAlign: 'right' }}>{priceRange(hiddenMin, hiddenMax)}</td>
                </tr>
              )}
              {unpricedHidden > 0 && (
                <tr style={{ borderTop: '1px solid rgba(255,255,255,0.06)', ...muted }}>
                  <td />
                  <td style={cellPad}>
                    {unpricedHidden} {unpricedHidden === 1 ? 'gem' : 'gems'} with no price hidden
                  </td>
                  <td style={{ ...cellPad, textAlign: 'right' }}>{order === 'value' ? unpricedHidden : ''}</td>
                  <td />
                  <td />
                </tr>
              )}
            </tbody>
          </table>
          {book?.updatedAt && (
            <div style={{ ...muted, fontSize: 11, marginTop: 8 }}>
              poe.ninja prices from {new Date(book.updatedAt).toLocaleTimeString()}
            </div>
          )}
        </>
      )}

      <CraftLogPanel ctx={ctx} />
      <ExceptionalPanel ctx={ctx} />
      <CalibrationPanel ctx={ctx} />
    </div>
  )
}
