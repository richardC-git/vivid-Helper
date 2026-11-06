// Picks the exceptional support gem to feed each Vivid Watcher craft: cheap,
// and stocked by enough sellers that buying several from one is likely.
import type { GemListing } from '@scalpelpoe/plugin-sdk'

/** Exceptional supports top out at level 3-4 (5 with a corruption). Awakened
 *  gems also stay under it but aren't exceptional. */
const EXCEPTIONAL_MAX_LEVEL = 5

export const DEFAULT_MAX_PRICE = 10

export interface ExceptionalPick {
  name: string
  /** poe.ninja line the price and volume come from, e.g. '1' */
  variant?: string
  chaos: number
  listings: number
}

/** Support gems whose every poe.ninja line is at most EXCEPTIONAL_MAX_LEVEL,
 *  derived from the data so new leagues' exceptional gems are included. */
export function exceptionalNames(lines: GemListing[]): Set<string> {
  const maxLevel = new Map<string, number>()
  for (const l of lines) {
    if (!l.name.endsWith(' Support') || l.name.startsWith('Awakened ')) continue
    maxLevel.set(l.name, Math.max(maxLevel.get(l.name) ?? 0, l.gemLevel))
  }
  return new Set([...maxLevel].filter(([, lvl]) => lvl <= EXCEPTIONAL_MAX_LEVEL).map(([n]) => n))
}

/** For each exceptional gem, its cheapest uncorrupted line (ties go to the
 *  bigger supply). Corrupted gems are left out since Bestiary crafts may not
 *  take them. Returned priced at or under `maxPrice`, most listings first. */
export function rankExceptional(lines: GemListing[], maxPrice: number | null): ExceptionalPick[] {
  const names = exceptionalNames(lines)
  const best = new Map<string, GemListing>()
  for (const l of lines) {
    if (!names.has(l.name) || l.corrupted || l.chaosValue <= 0) continue
    const cur = best.get(l.name)
    if (!cur || l.chaosValue < cur.chaosValue || (l.chaosValue === cur.chaosValue && l.listingCount > cur.listingCount))
      best.set(l.name, l)
  }
  return [...best.values()]
    .filter((l) => maxPrice === null || l.chaosValue <= maxPrice)
    .map((l) => ({ name: l.name, variant: l.variant, chaos: l.chaosValue, listings: l.listingCount }))
    .sort((a, b) => b.listings - a.listings || a.chaos - b.chaos)
}

const TRADE_SEARCH = 'https://www.pathofexile.com/trade/search'

/** Trade-site search for a gem: instant buyout, uncorrupted, cheapest first.
 *  The query rides in the URL (`?q=`), so opening it costs no trade API
 *  request. */
export function tradeSearchUrl(name: string, league: string): string {
  const query = {
    query: {
      // 'securable' is the trade site's Instant Buyout status
      status: { option: 'securable' },
      type: name,
      filters: { misc_filters: { filters: { corrupted: { option: 'false' } } } },
    },
    sort: { price: 'asc' },
  }
  return `${TRADE_SEARCH}/${encodeURIComponent(league)}?q=${encodeURIComponent(JSON.stringify(query))}`
}
