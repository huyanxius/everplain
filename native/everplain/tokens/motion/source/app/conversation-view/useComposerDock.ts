import { useLayoutEffect, useRef, type RefObject } from 'react'
import { useReducedMotion } from '../../ui/useReducedMotion'
import type { ComposerOrigin } from './homeSubmission'

/** FLIP the shared input itself, preserving focus, selection and its live value. */
export function useComposerDock(ref: RefObject<HTMLDivElement | null>, empty: boolean, origin?: ComposerOrigin) {
  const reduced = useReducedMotion()
  const entryOrigin = useRef(origin)
  const previous = useRef<{ empty: boolean; rect: ComposerOrigin } | null>(null)
  const cancel = useRef<() => void>(() => {})
  useLayoutEffect(() => {
    const node = ref.current
    const form = node?.querySelector('form')
    if (!node || !form) return
    const to = form.getBoundingClientRect()
    if (empty) entryOrigin.current = undefined
    const from = !empty && entryOrigin.current ? entryOrigin.current : previous.current?.empty && !empty ? previous.current.rect : null
    cancel.current()
    previous.current = { empty, rect: to }
    if (from && !reduced && typeof form.animate === 'function' && to.width > 0) {
      const style = getComputedStyle(form)
      const token = style.getPropertyValue('--qx-motion-slow').trim()
      const duration = parseFloat(token) * (token.endsWith('ms') ? 1 : 1000) || 420
      const easing = style.getPropertyValue('--qx-ease').trim() || 'cubic-bezier(.16, 1, .3, 1)'
      // Width interpolates without stretching the text. Translation uses viewport
      // geometry so the same motion covers homepage, new conversation and mobile.
      const animation = form.animate([
        { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)`, width: `${from.width}px` },
        { transform: 'translate(0, 0)', width: `${to.width}px` },
      ], { duration, easing })
      node.dataset.docking = 'true'
      let finished = false
      const finish = () => {
        if (finished) return
        finished = true; animation.cancel(); delete node.dataset.docking
      }
      cancel.current = finish
      void animation.finished.then(finish, finish)
    }
    // Keep the starting geometry current while typing, resizing or scrolling.
    const remember = () => { if (empty) previous.current = { empty, rect: form.getBoundingClientRect() } }
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(remember)
    resize?.observe(form)
    if (node.parentElement) resize?.observe(node.parentElement)
    node.addEventListener('submit', remember, true)
    node.addEventListener('keydown', remember, true)
    window.visualViewport?.addEventListener('resize', remember)
    window.addEventListener('resize', remember)
    window.addEventListener('scroll', remember, true)
    return () => {
      resize?.disconnect()
      node.removeEventListener('submit', remember, true); node.removeEventListener('keydown', remember, true)
      window.visualViewport?.removeEventListener('resize', remember)
      window.removeEventListener('resize', remember); window.removeEventListener('scroll', remember, true)
    }
  }, [empty, reduced, ref])
  useLayoutEffect(() => {
    const stop = () => cancel.current()
    window.addEventListener('resize', stop)
    window.visualViewport?.addEventListener('resize', stop)
    window.addEventListener('popstate', stop)
    return () => { stop(); window.removeEventListener('resize', stop); window.visualViewport?.removeEventListener('resize', stop); window.removeEventListener('popstate', stop) }
  }, [])
}
