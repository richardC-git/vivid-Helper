import type { PriceEntry } from '@scalpelpoe/plugin-sdk'

/** poe.ninja's variant label for a level 20, quality 20, uncorrupted gem. */
export const TARGET_VARIANT = '20/20'
export const GEM_CATEGORY = 'skill-gem'

// Scalpel <= 1.0.5 drops ninja's `variant` from plugin price entries, leaving
// several same-named lines per gem. If a host passes it through, we price the
// exact 20/20 line; otherwise the best we can do is the spread across lines.
type MaybeVariantEntry = PriceEntry & { variant?: string }

export type GemPrice =
  | { kind: 'exact'; chaos: number }
  | { kind: 'range'; min: number; max: number }
  | { kind: 'none' }

export interface PriceBook {
  hasVariants: boolean
  divineChaos: number | null
  updatedAt: number | null
  lookup(name: string): GemPrice
}

export function buildPriceBook(gems: PriceEntry[], currency: PriceEntry[], updatedAt: number | null): PriceBook {
  const entries = gems as MaybeVariantEntry[]
  const hasVariants = entries.some((e) => typeof e.variant === 'string')
  const byName = new Map<string, MaybeVariantEntry[]>()
  for (const e of entries) {
    const key = e.name.toLowerCase()
    const list = byName.get(key)
    if (list) list.push(e)
    else byName.set(key, [e])
  }
  const divine = currency.find((e) => e.name === 'Divine Orb')
  return {
    hasVariants,
    divineChaos: divine?.chaosValue ?? null,
    updatedAt,
    lookup(name) {
      const lines = byName.get(name.toLowerCase())
      if (!lines?.length) return { kind: 'none' }
      if (hasVariants) {
        const exact = lines.find((e) => e.variant === TARGET_VARIANT)
        return exact ? { kind: 'exact', chaos: exact.chaosValue } : { kind: 'none' }
      }
      const values = lines.map((e) => e.chaosValue)
      return { kind: 'range', min: Math.min(...values), max: Math.max(...values) }
    },
  }
}
