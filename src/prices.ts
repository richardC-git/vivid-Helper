import type { ScalpelPluginContext } from '@scalpelpoe/plugin-sdk'
import { GEM_CATEGORY, buildPriceBook } from './pricing'
import { setState } from './store'

let ready: Promise<void> | null = null

/** Load the price book into the store once, and keep it current as Scalpel
 *  refreshes poe.ninja data. Resolves when the first load is done. Lazy so the
 *  overlay window's copy of the plugin, which never prices, doesn't fetch. */
export function ensurePriceBook(ctx: ScalpelPluginContext): Promise<void> {
  if (ready) return ready
  const load = async (): Promise<void> => {
    const [gems, currency] = await Promise.all([
      ctx.prices.getPrices({ category: GEM_CATEGORY }),
      ctx.prices.getPrices({ category: 'currency' }),
    ])
    setState({ book: buildPriceBook(gems.prices, currency.prices, gems.updatedAt) })
  }
  ctx.prices.onChange(() => void load())
  ready = load().catch((e) => {
    ready = null
    throw e
  })
  return ready
}
