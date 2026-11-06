import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { Diamonds } from '@icon-park/react'
import type { ScalpelPluginContext } from '@scalpelpoe/plugin-sdk'
import { type Calibration, DEFAULT_CALIBRATION } from './grid'
import { Panel } from './Panel'
import { CALIBRATION_KEY, type ListOrder, ORDER_KEY, runScan } from './scan'
import { setState } from './store'

let root: Root | null = null

export default async function activate(ctx: ScalpelPluginContext): Promise<void> {
  const saved = await ctx.storage.get<Calibration>(CALIBRATION_KEY)
  if (saved) setState({ calibration: { ...DEFAULT_CALIBRATION, ...saved } })
  const order = await ctx.storage.get<ListOrder>(ORDER_KEY)
  if (order === 'value' || order === 'inventory') setState({ order })

  // Capture first, then switch tabs: the capture needs PoE focused.
  ctx.registerHotkey({ label: 'Scan inventory gems' }, async () => {
    await runScan(ctx)
    ctx.openTab()
  })

  ctx.registerTab({
    label: 'Gem Scanner',
    icon: renderToStaticMarkup(<Diamonds theme="two-tone" fill={['currentColor', 'rgba(255,255,255,0.2)']} />),
    render: (container) => {
      root = createRoot(container)
      root.render(<Panel ctx={ctx} />)
      return () => {
        root?.unmount()
        root = null
      }
    },
  })
}
