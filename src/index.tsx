import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { Diamonds } from '@icon-park/react'
import type { ScalpelPluginContext } from '@scalpelpoe/plugin-sdk'
import { type Calibration, DEFAULT_CALIBRATION } from './grid'
import { OverlayView } from './OverlayView'
import { Panel } from './Panel'
import { ensurePriceBook } from './prices'
import {
  CALIBRATION_KEY,
  HIDE_UNPRICED_KEY,
  type ListOrder,
  ORDER_KEY,
  THRESHOLD_KEY,
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

  // Keep the overlay in step with rescans (incl. calibration tweaks), price
  // refreshes and threshold changes.
  let last = getState()
  subscribe(() => {
    const next = getState()
    if (
      next.scan !== last.scan ||
      next.book !== last.book ||
      next.threshold !== last.threshold ||
      next.hideUnpriced !== last.hideUnpriced
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
    await Promise.all([runScan(ctx), ensurePriceBook(ctx).catch(() => {})])
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
    { title: NAME, icon, mode: 'annotation', hotkeyLabel: 'Toggle gem overlay', dismissOnEscape: true },
    (container) => {
      const overlayRoot = createRoot(container)
      overlayRoot.render(<OverlayView ctx={ctx} />)
      return () => overlayRoot.unmount()
    },
  )
}
