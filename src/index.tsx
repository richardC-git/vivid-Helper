import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { Diamonds } from '@icon-park/react'
import type { ScalpelPluginContext } from '@scalpelpoe/plugin-sdk'
import { type Calibration, DEFAULT_CALIBRATION } from './grid'
import { OverlayView } from './OverlayView'
import { Panel } from './Panel'
import { type CraftLog, EMPTY_LOG, LOG_KEY } from './craftlog'
import {
  CALIBRATION_KEY,
  BEAST_PRICE_KEY,
  CHAOS_ONLY_KEY,
  EXCEPTIONAL_KEY,
  EXCEPTIONAL_MAX_KEY,
  HIDE_UNPRICED_KEY,
  LOGGING_KEY,
  type ListOrder,
  ORDER_KEY,
  THRESHOLD_KEY,
  YELLOW_BEAST_KEY,
  publishOverlay,
  runScan,
} from './scan'
import { getState, setState, subscribe } from './store'

/** Time for a hidden overlay to leave the screen before capturing; the
 *  capture grabs the screen, so a visible overlay would end up in it. */
const OVERLAY_HIDE_MS = 150

const NAME = 'Vivid Watcher Helper'

let root: Root | null = null

export default async function activate(ctx: ScalpelPluginContext): Promise<void> {
  const saved = await ctx.storage.get<Calibration>(CALIBRATION_KEY)
  if (saved) setState({ calibration: { ...DEFAULT_CALIBRATION, ...saved } })
  const order = await ctx.storage.get<ListOrder>(ORDER_KEY)
  if (order === 'value' || order === 'inventory') setState({ order })
  const threshold = await ctx.storage.get<number>(THRESHOLD_KEY)
  if (typeof threshold === 'number') setState({ threshold })
  if ((await ctx.storage.get<boolean>(HIDE_UNPRICED_KEY)) === true) setState({ hideUnpriced: true })
  if ((await ctx.storage.get<boolean>(CHAOS_ONLY_KEY)) === true) setState({ chaosOnly: true })
  const log = await ctx.storage.get<CraftLog>(LOG_KEY)
  if (log?.batches && log.snapshot) setState({ log: { ...EMPTY_LOG, ...log } })
  const beastOverride = await ctx.storage.get<number>(BEAST_PRICE_KEY)
  if (typeof beastOverride === 'number') setState({ beastOverride })
  if ((await ctx.storage.get<boolean>(LOGGING_KEY)) === false) setState({ logging: false })
  const exceptional = await ctx.storage.get<{ name: string; chaos: number }>(EXCEPTIONAL_KEY)
  if (exceptional && typeof exceptional.name === 'string' && typeof exceptional.chaos === 'number') setState({ exceptional })
  const exceptionalMax = await ctx.storage.get<number>(EXCEPTIONAL_MAX_KEY)
  if (typeof exceptionalMax === 'number') setState({ exceptionalMax })
  const yellowBeast = await ctx.storage.get<number>(YELLOW_BEAST_KEY)
  if (typeof yellowBeast === 'number') setState({ yellowBeast })

  // Keep the overlay in step with rescans (incl. calibration tweaks), price
  // refreshes and threshold changes.
  let last = getState()
  subscribe(() => {
    const next = getState()
    if (
      next.scan !== last.scan ||
      next.book !== last.book ||
      next.threshold !== last.threshold ||
      next.hideUnpriced !== last.hideUnpriced ||
      next.chaosOnly !== last.chaosOnly
    )
      void publishOverlay(ctx)
    last = next
  })

  const icon = renderToStaticMarkup(<Diamonds theme="two-tone" fill={['currentColor', 'rgba(255,255,255,0.2)']} />)

  // Results go on the in-game overlay so the game keeps focus; the tab only
  // opens when there's an error to read.
  ctx.registerHotkey({ label: 'Scan inventory gems' }, async () => {
    if (await ctx.isOverlayVisible()) {
      ctx.closeOverlay()
      await new Promise((r) => setTimeout(r, OVERLAY_HIDE_MS))
    }
    await runScan(ctx)
    if (getState().error || !getState().scan || !getState().book) {
      ctx.openTab()
      return
    }
    await publishOverlay(ctx)
    ctx.openOverlay()
  })

  ctx.registerTab({
    label: NAME,
    icon,
    render: (container) => {
      root = createRoot(container)
      root.render(<Panel ctx={ctx} />)
      return () => {
        root?.unmount()
        root = null
      }
    },
  })

  ctx.registerOverlay(
    // No dismissOnEscape: Esc is a habit key in PoE, so the overlay closes from
    // its own button or the toggle hotkey.
    { title: NAME, icon, mode: 'annotation', hotkeyLabel: 'Toggle gem overlay' },
    (container) => {
      const overlayRoot = createRoot(container)
      overlayRoot.render(<OverlayView ctx={ctx} />)
      return () => overlayRoot.unmount()
    },
  )
}
