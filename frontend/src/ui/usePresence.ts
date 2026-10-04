import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useReducedMotion } from './useReducedMotion'

/** Cancel native close synchronously; the owner's React handler controls exit and teardown. */
export function useNativeDialogCancel<T extends HTMLElement>(ref: RefObject<T | null>, active = true) {
  useLayoutEffect(() => {
    const dialog = ref.current
    if (!active || !(dialog instanceof HTMLDialogElement)) return
    const preventClose = (event: Event) => event.preventDefault()
    dialog.addEventListener('cancel', preventClose)
    return () => dialog.removeEventListener('cancel', preventClose)
  }, [ref, active])
}

/** Read the actual CSS timeline, so a missing stylesheet/reduced motion never delays dismissal. */
function exitDuration(element: HTMLElement) {
  const style = getComputedStyle(element)
  if (!style.transitionProperty || style.transitionProperty === 'none') return 0
  const milliseconds = (value: string) => (parseFloat(value) || 0) * (value.trim().endsWith('ms') ? 1 : 1000)
  const durations = style.transitionDuration.split(',').map(milliseconds)
  const delays = style.transitionDelay.split(',').map(milliseconds)
  return Math.min(500, Math.max(0, ...durations.map((duration, index) => duration + (delays[index % delays.length] || 0))))
}

function useExitAnimation<T extends HTMLElement>(ref: RefObject<T | null>, exiting: boolean, onExited: () => void) {
  const reduced = useReducedMotion()
  const finishRef = useRef(onExited)
  useLayoutEffect(() => { finishRef.current = onExited }, [onExited])
  useLayoutEffect(() => {
    if (!exiting) return
    const element = ref.current
    const duration = element && !reduced ? exitDuration(element) : 0
    if (!element || !duration) { finishRef.current(); return }
    let done = false
    const finish = () => { if (!done) { done = true; finishRef.current() } }
    // Ignore child controls, pseudo-element backdrops and interrupted transitions.
    const onEnd = (event: TransitionEvent) => {
      if (event.target === element && !event.pseudoElement && event.propertyName === 'opacity') finish()
    }
    element.addEventListener('transitionend', onEnd)
    const timeout = window.setTimeout(finish, duration + 50)
    return () => { done = true; window.clearTimeout(timeout); element.removeEventListener('transitionend', onEnd) }
  }, [exiting, reduced, ref])
}

/** Keep only this surface mounted until its exit finishes. Never retains pages or previous-account content. */
export function usePresence<T extends HTMLElement>(open: boolean, ref: RefObject<T | null>, scopeKey?: string) {
  const [retained, setRetained] = useState(open)
  const [scope, setScope] = useState(scopeKey)
  useNativeDialogCancel(ref, open || retained)
  // Scope replacement is not a visual dismissal: discard before commit, without a snapshot.
  if (scope !== scopeKey) { setScope(scopeKey); setRetained(false) }
  useLayoutEffect(() => { if (open) setRetained(true) }, [open])
  useExitAnimation(ref, !open && retained, () => setRetained(false))
  return {
    present: open || retained,
    props: { 'data-presence': open ? 'open' : 'closing', inert: !open, 'aria-hidden': !open || undefined } as const,
  }
}

/** For mount-owned dialogs: animate user dismissal before asking the owner to unmount.
 * Route/auth teardown still unmounts immediately; actions and network work are never deferred.
 */
export function useAnimatedDismiss<T extends HTMLElement>(ref: RefObject<T | null>, onDismiss: () => void) {
  useNativeDialogCancel(ref)
  const [closing, setClosing] = useState(false)
  const reduced = useReducedMotion()
  const pending = useRef(false)
  const dismissRef = useRef(onDismiss)
  useLayoutEffect(() => { dismissRef.current = onDismiss }, [onDismiss])
  useExitAnimation(ref, closing, () => { onDismiss(); pending.current = false; setClosing(false) })
  const cancel = useCallback(() => { pending.current = false; setClosing(false) }, [])
  const dismiss = useCallback(() => {
    if (pending.current) return
    if (reduced || !ref.current || !exitDuration(ref.current)) { dismissRef.current(); return }
    pending.current = true
    setClosing(true)
  }, [reduced, ref])
  return {
    cancel,
    dismiss,
    props: { 'data-presence': closing ? 'closing' : 'open', inert: closing } as const,
  }
}
