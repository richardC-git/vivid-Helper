import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ScalpelPluginContext } from '@scalpelpoe/plugin-sdk'
import { type MarkKind, OVERLAY_KEY, type OverlayMark, type OverlayPayload } from './overlay'

/** How often the overlay checks for a newer scan. It runs in its own window
 *  and can't share memory with the main overlay, so it polls storage. */
const POLL_MS = 500

const BORDER: Record<MarkKind, string> = {
  above: '2px solid #46a758',
  below: '1px solid rgba(255,255,255,0.08)',
  lookalike: '2px solid #f5a623',
  unpriced: '2px dashed rgba(255,255,255,0.45)',
  unknown: '2px solid #e5484d',
}

function Mark({ mark }: { mark: OverlayMark }): JSX.Element {
  const below = mark.kind === 'below'
  const fontSize = Math.max(10, Math.round(mark.size * 0.24))
  return (
    <div
      style={{
        position: 'absolute',
        left: mark.x,
        top: mark.y,
        width: mark.size,
        height: mark.size,
        boxSizing: 'border-box',
        border: BORDER[mark.kind],
        background: below ? 'rgba(0,0,0,0.62)' : undefined,
      }}
    >
      <span
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 1,
          textAlign: 'center',
          fontSize: below ? Math.max(9, Math.round(fontSize * 0.8)) : fontSize,
          fontWeight: below ? 400 : 700,
          lineHeight: 1.1,
          color: below ? 'rgba(255,255,255,0.4)' : '#fff',
          textShadow: '0 0 2px #000, 0 0 3px #000',
          background: below ? undefined : 'rgba(0,0,0,0.55)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}
      >
        {mark.label}
      </span>
    </div>
  )
}

const BAR_HEIGHT = 26

/** Status line and close button above the inventory's top-right corner. The
 *  overlay is click-through everywhere else; this bar alone takes clicks, and
 *  closing is a deliberate click so a habitual Esc can't lose the overlay. */
function ControlBar({ ctx, payload }: { ctx: ScalpelPluginContext; payload: OverlayPayload }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const { grid, status } = payload
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    ctx.setInteractiveRegion({ x: r.left, y: r.top, width: r.width, height: r.height })
    return () => ctx.setInteractiveRegion(null)
  }, [ctx, grid.x, grid.y, grid.width, status])
  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        // Anchored by its right edge so it sizes to its text; a left anchor
        // near the window edge shrank it and wrapped the status line.
        right: `calc(100% - ${grid.x + grid.width}px)`,
        top: Math.max(0, grid.y - BAR_HEIGHT - 4),
        whiteSpace: 'nowrap',
        height: BAR_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 4px 0 10px',
        borderRadius: 4,
        background: 'rgba(10,10,14,0.85)',
        border: '1px solid rgba(255,255,255,0.15)',
        color: '#fff',
        fontSize: 13,
        pointerEvents: 'auto',
      }}
    >
      {status && <span>{status}</span>}
      <button
        type="button"
        onClick={() => ctx.closeOverlay()}
        title="Close overlay"
        style={{
          width: 20,
          height: 20,
          border: 'none',
          borderRadius: 3,
          background: 'rgba(255,255,255,0.12)',
          color: '#fff',
          fontSize: 14,
          lineHeight: '20px',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        ✕
      </button>
    </div>
  )
}

export function OverlayView({ ctx }: { ctx: ScalpelPluginContext }): JSX.Element {
  const [payload, setPayload] = useState<OverlayPayload | null>(null)
  useEffect(() => {
    let alive = true
    let lastStamp = -1
    const poll = async (): Promise<void> => {
      const payload = await ctx.storage.get<OverlayPayload>(OVERLAY_KEY)
      if (!alive || !payload || payload.stamp === lastStamp) return
      lastStamp = payload.stamp
      setPayload(payload)
    }
    void poll()
    const timer = setInterval(() => void poll(), POLL_MS)
    // Re-check the moment it's shown so a reopen doesn't flash the last scan.
    const offVisibility = ctx.onOverlayVisibility((visible) => {
      if (visible) void poll()
    })
    return () => {
      alive = false
      clearInterval(timer)
      offVisibility()
    }
  }, [ctx])
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {payload?.marks.map((m) => (
        <Mark key={`${m.x},${m.y}`} mark={m} />
      ))}
      {payload?.grid && <ControlBar ctx={ctx} payload={payload} />}
    </div>
  )
}
