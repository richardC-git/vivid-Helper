// Module-level state shared by the hotkey handler and the tab. Both run in
// Scalpel's main overlay process, so a plain store is enough.
import { useSyncExternalStore } from 'react'
import { type Calibration, DEFAULT_CALIBRATION } from './grid'
import type { ListOrder, ScanOutcome } from './scan'

export interface State {
  scan: ScanOutcome | null
  scanning: boolean
  error: string | null
  calibration: Calibration
  order: ListOrder
}

let state: State = { scan: null, scanning: false, error: null, calibration: DEFAULT_CALIBRATION, order: 'value' }
const listeners = new Set<() => void>()

export function getState(): State {
  return state
}

export function setState(patch: Partial<State>): void {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function useStore(): State {
  return useSyncExternalStore(subscribe, getState)
}
