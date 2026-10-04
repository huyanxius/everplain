import { useCallback, useEffect, useRef, useState } from 'react'

export type GraphFullscreenMode = 'none' | 'native' | 'viewport'

/** Fullscreen belongs to the graph element, so leaving it never recreates the canvas. */
export function useGraphFullscreen<T extends HTMLElement = HTMLElement>() {
  const fullscreenRef = useRef<T>(null)
  const [mode, setMode] = useState<GraphFullscreenMode>('none')
  const [notice, setNotice] = useState<string | null>(null)
  const modeRef = useRef<GraphFullscreenMode>('none')
  const mounted = useRef(false)
  const pending = useRef(false)
  const requestVersion = useRef(0)
  const returnFocus = useRef<HTMLElement | null>(null)

  const updateMode = useCallback((next: GraphFullscreenMode) => {
    modeRef.current = next
    if (mounted.current) setMode(next)
  }, [])

  const exitFullscreen = useCallback(async () => {
    requestVersion.current += 1
    const element = fullscreenRef.current
    const owner = element?.ownerDocument
    if (element && owner?.fullscreenElement === element) {
      try {
        await owner.exitFullscreen()
      } catch {
        if (mounted.current) setNotice('暂时无法退出浏览器全屏，请按 Esc 退出。')
        return
      }
    }
    updateMode('none')
    if (mounted.current) setNotice(null)
  }, [updateMode])

  const enterFullscreen = useCallback(async () => {
    const element = fullscreenRef.current
    if (!element || pending.current || modeRef.current !== 'none') return
    const owner = element.ownerDocument
    returnFocus.current = owner.activeElement instanceof HTMLElement ? owner.activeElement : null
    setNotice(null)
    const version = ++requestVersion.current
    const fallback = (message: string) => {
      if (!mounted.current || version !== requestVersion.current) return
      setNotice(message)
      updateMode('viewport')
    }
    if (typeof element.requestFullscreen !== 'function') {
      fallback('此浏览器不支持浏览器全屏，已切换为窗口内全屏。按 Esc 或右上角按钮退出。')
      return
    }
    pending.current = true
    try {
      // Keep this call in the click's activation scope, before awaiting anything.
      await element.requestFullscreen()
      if (!mounted.current || version !== requestVersion.current) {
        if (owner.fullscreenElement === element) await owner.exitFullscreen()
        return
      }
      // fullscreenchange is authoritative, including browser-initiated exits.
      if (owner.fullscreenElement === element) updateMode('native')
    } catch {
      fallback('浏览器未允许全屏，已切换为窗口内全屏。按 Esc 或右上角按钮退出。')
    } finally {
      pending.current = false
    }
  }, [updateMode])

  useEffect(() => {
    mounted.current = true
    const element = fullscreenRef.current
    const owner = element?.ownerDocument
    if (!owner) return () => { mounted.current = false }
    const onFullscreenChange = () => {
      if (owner.fullscreenElement === element) {
        updateMode('native')
        setNotice(null)
      } else if (modeRef.current === 'native') {
        requestVersion.current += 1
        updateMode('none')
        setNotice(null)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && (modeRef.current !== 'none' || pending.current)) {
        event.preventDefault()
        void exitFullscreen()
      }
    }
    owner.addEventListener('fullscreenchange', onFullscreenChange)
    owner.addEventListener('keydown', onKeyDown)
    return () => {
      mounted.current = false
      requestVersion.current += 1
      owner.removeEventListener('fullscreenchange', onFullscreenChange)
      owner.removeEventListener('keydown', onKeyDown)
      if (owner.fullscreenElement === element) void owner.exitFullscreen().catch(() => {})
    }
  }, [exitFullscreen, updateMode])

  useEffect(() => {
    if (mode === 'none') return
    const element = fullscreenRef.current
    if (!element) return
    const owner = element.ownerDocument
    const oldOverflow = owner.body.style.overflow
    // Keep the obscured page out of keyboard navigation in the viewport fallback.
    const inertSiblings: { element: HTMLElement; inert: boolean }[] = []
    if (mode === 'viewport') {
      owner.body.style.overflow = 'hidden'
      for (let branch: HTMLElement | null = element; branch && branch !== owner.body; branch = branch.parentElement) {
        for (const sibling of branch.parentElement?.children ?? []) {
          if (sibling !== branch && sibling instanceof HTMLElement) {
            inertSiblings.push({ element: sibling, inert: sibling.inert })
            sibling.inert = true
          }
        }
      }
    }
    element.querySelector<HTMLElement>('[data-graph-fullscreen-exit]')?.focus({ preventScroll: true })
    return () => {
      if (mode === 'viewport') owner.body.style.overflow = oldOverflow
      inertSiblings.forEach(({ element: sibling, inert }) => { sibling.inert = inert })
      const target = returnFocus.current?.isConnected
        ? returnFocus.current
        : element.querySelector<HTMLElement>('[data-graph-fullscreen-enter]')
      target?.focus({ preventScroll: true })
    }
  }, [mode])

  return { fullscreenRef, mode, isFullscreen: mode !== 'none', notice, enterFullscreen, exitFullscreen }
}
