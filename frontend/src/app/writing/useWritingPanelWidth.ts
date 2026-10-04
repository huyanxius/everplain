import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

export const WRITING_PANEL_DEFAULT = 320
export const WRITING_PANEL_MIN = 280
export const WRITING_PANEL_MAX = 520
export function writingPanelMaximum(containerWidth: number) {
  return containerWidth > 0 ? Math.max(WRITING_PANEL_MIN, Math.min(WRITING_PANEL_MAX, containerWidth - 408)) : WRITING_PANEL_MAX
}
export function clampWritingPanel(width: number, containerWidth = 0) {
  return Math.round(Math.max(WRITING_PANEL_MIN, Math.min(writingPanelMaximum(containerWidth), Number.isFinite(width) ? width : WRITING_PANEL_DEFAULT)))
}
export function useWritingPanelWidth(userId: string | null, ready = true) {
  const key = `everplain.writing.agent-width.v1:${userId ?? 'anonymous'}`
  const [preferred, setPreferred] = useState(() => { try { const value = localStorage.getItem(key); return clampWritingPanel(value ? Number(value) : WRITING_PANEL_DEFAULT) } catch { return WRITING_PANEL_DEFAULT } })
  const [containerWidth, setContainerWidth] = useState(0)
  const [resizing, setResizing] = useState(false)
  const layoutRef = useRef<HTMLDivElement | null>(null)
  const active = useRef<{ id: number; x: number; width: number; original: number } | null>(null)
  const latest = useRef(preferred); latest.current = preferred
  const width = clampWritingPanel(preferred, containerWidth)
  useEffect(() => {
    const node = layoutRef.current
    if (!node) return
    const fit = () => setContainerWidth(node.getBoundingClientRect().width)
    fit()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit)
    observer?.observe(node); window.addEventListener('resize', fit)
    return () => { observer?.disconnect(); window.removeEventListener('resize', fit) }
  }, [ready])
  function update(value: number, persist = false) {
    const next = clampWritingPanel(value, layoutRef.current?.getBoundingClientRect().width ?? containerWidth)
    latest.current = next; setPreferred(next)
    if (persist) try { localStorage.setItem(key, String(next)) } catch { /* The current layout remains usable. */ }
  }
  function cancel(event?: PointerEvent<HTMLDivElement>) {
    const drag = active.current
    if (!drag || (event && event.pointerId !== drag.id)) return
    active.current = null; latest.current = drag.original; setPreferred(drag.original); setResizing(false)
  }
  return {
    layoutRef, width, resizing,
    separatorProps: {
      'aria-valuemin': WRITING_PANEL_MIN,
      'aria-valuemax': writingPanelMaximum(containerWidth),
      'aria-valuenow': width,
      'aria-valuetext': `${width} 像素`,
      onPointerDown(event: PointerEvent<HTMLDivElement>) {
        if (event.button !== 0) return
        event.preventDefault(); active.current = { id: event.pointerId, x: event.clientX, width, original: preferred }; setResizing(true)
        event.currentTarget.setPointerCapture?.(event.pointerId)
      },
      onPointerMove(event: PointerEvent<HTMLDivElement>) {
        const drag = active.current
        if (drag?.id === event.pointerId) update(drag.width + drag.x - event.clientX)
      },
      onPointerUp(event: PointerEvent<HTMLDivElement>) {
        if (active.current?.id !== event.pointerId) return
        active.current = null; setResizing(false); update(latest.current, true)
        event.currentTarget.releasePointerCapture?.(event.pointerId)
      },
      onPointerCancel: cancel,
      onLostPointerCapture: cancel,
      onDoubleClick: () => update(WRITING_PANEL_DEFAULT, true),
      onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        if (event.key === 'Escape') { cancel(); return }
        const step = event.shiftKey ? 48 : 16
        const next = event.key === 'ArrowLeft' ? width + step : event.key === 'ArrowRight' ? width - step : event.key === 'Home' ? WRITING_PANEL_MIN : event.key === 'End' ? writingPanelMaximum(containerWidth) : null
        if (next === null) return
        event.preventDefault(); update(next, true)
      },
    },
  }
}
