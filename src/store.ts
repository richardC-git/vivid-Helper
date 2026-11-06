// Module-level state shared by the hotkey handler and the tab. Both run in
// Scalpel's main overlay process, so a plain store is enough.
import { useSyncExternalStore } from 'react'
import { type Calibration, DEFAULT_CALIBRATION } from './grid'
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
