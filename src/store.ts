// Module-level state shared by the hotkey handler and the tab. Both run in
// Scalpel's main overlay process, so a plain store is enough.
import { useSyncExternalStore } from 'react'
import { type Calibration, DEFAULT_CALIBRATION } from './grid'
import { type CraftLog, EMPTY_LOG, type RecordOutcome } from './craftlog'
import type { GemListingsResult } from '@scalpelpoe/plugin-sdk'
import type { PriceBook } from './pricing'
import type { ListOrder, ScanOutcome } from './scan'

export interface State {
  scan: ScanOutcome | null
  scanning: boolean
  error: string | null
  calibration: Calibration
  order: ListOrder
  book: PriceBook | null
  /** Minimum chaos value to list and highlight; null shows everything */
  threshold: number | null
  /** Leave gems without a 20/20 price off the overlay and list */
  hideUnpriced: boolean
  /** Label the overlay in chaos even for gems worth a divine or more */
  chaosOnly: boolean
  log: CraftLog
  /** What the last scan did to the log, shown on the overlay */
  logStatus: RecordOutcome | null
  /** Vivid Watcher price from poe.ninja */
  beastChaos: number | null
  /** User-entered beast price, used instead of poe.ninja's when set */
  beastOverride: number | null
  /** Off for testing: scans update the slot memory but add nothing to the log */
  logging: boolean
  /** poe.ninja gem lines with listing counts, loaded when the finder opens */
  listings: GemListingsResult | null
  /** Finder's price cap per exceptional gem, chaos */
  exceptionalMax: number
  /** Exceptional gem fed to each craft and what it cost when chosen */
  exceptional: { name: string; chaos: number } | null
  /** User's cost per yellow beast (poe.ninja doesn't price them) */
  yellowBeast: number | null
}

let state: State = {
  scan: null,
  scanning: false,
  error: null,
  calibration: DEFAULT_CALIBRATION,
  order: 'value',
  book: null,
  threshold: null,
  hideUnpriced: false,
  chaosOnly: false,
  log: EMPTY_LOG,
  logStatus: null,
  beastChaos: null,
  beastOverride: null,
  logging: true,
  listings: null,
  exceptionalMax: 10,
  exceptional: null,
  yellowBeast: null,
}
const listeners = new Set<() => void>()

export function getState(): State {
  return state
}

export function setState(patch: Partial<State>): void {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

export function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function useStore(): State {
  return useSyncExternalStore(subscribe, getState)
}
