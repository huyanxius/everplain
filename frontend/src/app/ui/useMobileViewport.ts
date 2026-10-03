import { useLayoutEffect } from 'react'

/** Share the visible mobile viewport with the frame and native top-layer dialogs. */
export function useMobileViewport(enabled: boolean) {
  useLayoutEffect(() => {
    if (!enabled) return
    const style = document.documentElement.style
    const properties = ['--app-viewport-height', '--app-viewport-offset-top'] as const
    const previous = properties.map(name => [name, style.getPropertyValue(name), style.getPropertyPriority(name)] as const)
    const viewport = window.visualViewport
    let frame = 0
    const update = () => {
      frame = 0
      // Pinch zoom is browser navigation, not a smaller application layout.
      if (viewport && Math.abs(viewport.scale - 1) > 0.01) return
      const height = viewport?.height ?? window.innerHeight
      if (height <= 0) return
      style.setProperty('--app-viewport-height', `${Math.round(height)}px`)
      style.setProperty('--app-viewport-offset-top', `${Math.max(0, Math.round(viewport?.offsetTop ?? 0))}px`)
    }
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update) }
    update()
    viewport?.addEventListener('resize', schedule)
    viewport?.addEventListener('scroll', schedule)
    window.addEventListener('resize', schedule)
    return () => {
      window.cancelAnimationFrame(frame)
      viewport?.removeEventListener('resize', schedule)
      viewport?.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      for (const [name, value, priority] of previous) {
        if (value) style.setProperty(name, value, priority)
        else style.removeProperty(name)
      }
    }
  }, [enabled])
}
