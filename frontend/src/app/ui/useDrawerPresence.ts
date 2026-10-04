import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useReducedMotion } from '../../ui/useReducedMotion'

/** Only the drawer's transform owns dismissal; unrelated fades must not release the modal. */
function transformDuration(element: HTMLElement) {
  const style = getComputedStyle(element)
  const properties = style.transitionProperty.split(',').map(value => value.trim())
  const milliseconds = (value: string) => (parseFloat(value) || 0) * (value.trim().endsWith('ms') ? 1 : 1000)
  const durations = style.transitionDuration.split(',').map(milliseconds)
  const delays = style.transitionDelay.split(',').map(milliseconds)
  let duration = 0
  properties.forEach((property, index) => {
    if (property === 'transform' || property === 'all') {
      duration = Math.max(0, durations[index % durations.length] + delays[index % delays.length])
    }
  })
  return duration
}

type DrawerPresenceOptions = {
  open: boolean
  enabled: boolean
  scopeKey?: string
  drawerRef: RefObject<HTMLElement | null>
  triggerRef: RefObject<HTMLButtonElement | null>
  onDismiss: () => void
}

type ModalOwner = { scopeKey?: string; release: (restoreFocus: boolean) => void }

/** Retains modal ownership, never an old page/account tree, through the visible drawer exit. */
export function useDrawerPresence({ open, enabled, scopeKey, drawerRef, triggerRef, onDismiss }: DrawerPresenceOptions) {
  const reduced = useReducedMotion()
  const [state, setState] = useState({ scopeKey, retained: enabled && open, blocked: false })
  // An account change is immediate teardown. Wait for the old open request to be cleared.
  if (state.scopeKey !== scopeKey) setState({ scopeKey, retained: false, blocked: open })
  else if (state.blocked && !open) setState({ scopeKey, retained: false, blocked: false })
  const targetOpen = enabled && open && !state.blocked && state.scopeKey === scopeKey
  const present = enabled && !state.blocked && state.scopeKey === scopeKey && (targetOpen || state.retained)
  const dismissRef = useRef(onDismiss)
  useLayoutEffect(() => { dismissRef.current = onDismiss }, [onDismiss])

  useLayoutEffect(() => {
    if (!enabled || state.blocked || state.scopeKey !== scopeKey) {
      if (state.retained) setState(value => ({ ...value, retained: false }))
      return
    }
    if (targetOpen) {
      if (!state.retained) setState(value => ({ ...value, retained: true }))
      return
    }
    if (!state.retained) return
    const drawer = drawerRef.current
    const duration = drawer && !reduced ? transformDuration(drawer) : 0
    if (!drawer || !duration) { setState(value => ({ ...value, retained: false })); return }
    let cancelled = false
    const finish = () => {
      if (cancelled) return
      cancelled = true
      setState(value => ({ ...value, retained: false }))
    }
    const onEnd = (event: TransitionEvent) => {
      if (event.target === drawer && !event.pseudoElement && event.propertyName === 'transform') finish()
    }
    drawer.addEventListener('transitionend', onEnd)
    // Missing events cannot leave the page inert. The fallback follows the actual CSS declaration.
    const timeout = window.setTimeout(finish, duration)
    return () => { cancelled = true; window.clearTimeout(timeout); drawer.removeEventListener('transitionend', onEnd) }
  }, [drawerRef, enabled, reduced, scopeKey, state.blocked, state.retained, state.scopeKey, targetOpen])

  const ownerRef = useRef<ModalOwner | null>(null)
  const release = useCallback((restoreFocus: boolean) => {
    const owner = ownerRef.current
    ownerRef.current = null
    owner?.release(restoreFocus)
  }, [])
  useLayoutEffect(() => {
    if (!present) { release(enabled && ownerRef.current?.scopeKey === scopeKey); return }
    if (ownerRef.current && ownerRef.current.scopeKey === scopeKey) return
    release(false)
    const drawer = drawerRef.current
    if (!drawer) return
    const trigger = triggerRef.current
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    drawer.querySelector<HTMLButtonElement>('[data-close-drawer]')?.focus()
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key === 'Escape') { event.preventDefault(); dismissRef.current(); return }
      if (event.key !== 'Tab') return
      const controls = Array.from(drawer.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),summary,[tabindex="0"]'))
        .filter(node => node.getClientRects().length > 0 && !node.closest('[inert], [aria-hidden="true"]'))
      if (!controls.length) { event.preventDefault(); return }
      const first = controls[0], last = controls[controls.length - 1]
      if (event.shiftKey && (document.activeElement === first || !drawer.contains(document.activeElement))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !drawer.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handleKey)
    ownerRef.current = { scopeKey, release: restoreFocus => {
      document.body.style.overflow = overflow
      document.removeEventListener('keydown', handleKey)
      const focusStayedInDrawer = drawer.contains(document.activeElement) || document.activeElement === document.body
      if (restoreFocus && focusStayedInDrawer && trigger?.isConnected && !trigger.disabled && !trigger.closest('[inert], [aria-hidden="true"]')) trigger.focus()
    } }
  }, [drawerRef, enabled, present, release, scopeKey, triggerRef])
  useLayoutEffect(() => () => release(false), [release])

  return { open: targetOpen, present }
}
