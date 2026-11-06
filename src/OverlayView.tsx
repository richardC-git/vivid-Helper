import { useEffect, useState } from 'react'
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

export function OverlayView({ ctx }: { ctx: ScalpelPluginContext }): JSX.Element {
  const [marks, setMarks] = useState<OverlayMark[]>([])
  useEffect(() => {
    let alive = true
    let lastStamp = -1
    const poll = async (): Promise<void> => {
      const payload = await ctx.storage.get<OverlayPayload>(OVERLAY_KEY)
      if (!alive || !payload || payload.stamp === lastStamp) return
      lastStamp = payload.stamp
      setMarks(payload.marks)
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
      {marks.map((m) => (
        <Mark key={`${m.x},${m.y}`} mark={m} />
      ))}
    </div>
  )
}
