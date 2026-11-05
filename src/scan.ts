import type { GameCapture, ScalpelPluginContext } from '@scalpelpoe/plugin-sdk'
import { type Calibration, type GridRect, inventoryGrid } from './grid'
import { type ScanResult, scanGrid } from './match'
import { getState, setState } from './store'

export interface ScanOutcome extends ScanResult {
  /** Grid in frame px, before the auto-alignment offset */
  grid: GridRect
  capture: GameCapture
  at: number
}

export function scanCapture(capture: GameCapture, cal: Calibration): ScanOutcome {
  const css = inventoryGrid(capture.gameSize, cal)
  const grid: GridRect = {
    x: (css.x - capture.origin.x) * capture.scale,
    y: (css.y - capture.origin.y) * capture.scale,
    cell: css.cell * capture.scale,
  }
  const result = scanGrid({ pixels: capture.pixels, width: capture.width, height: capture.height }, grid)
  return { ...result, grid, capture, at: Date.now() }
}

/** Full-window capture: the grid position depends on the window size, which
 *  we only learn from the capture itself. Resolves null when PoE isn't the
 *  focused window (or on Linux, where capture is unsupported). */
export async function captureAndScan(ctx: ScalpelPluginContext, cal: Calibration): Promise<ScanOutcome | null> {
  const capture = await ctx.captureGameWindow()
  return capture ? scanCapture(capture, cal) : null
}

export const CALIBRATION_KEY = 'calibration'

export async function runScan(ctx: ScalpelPluginContext): Promise<void> {
  if (getState().scanning) return
  setState({ scanning: true, error: null })
  try {
    const scan = await captureAndScan(ctx, getState().calibration)
    if (scan) setState({ scan })
    else setState({ error: 'Path of Exile must be the focused window. Use the hotkey in-game with your inventory open.' })
  } catch (e) {
    ctx.log('scan failed', e)
    setState({ error: `Scan failed: ${e instanceof Error ? e.message : String(e)}` })
  } finally {
    setState({ scanning: false })
  }
}
