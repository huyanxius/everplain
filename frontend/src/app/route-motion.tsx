import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { useReducedMotion } from '../ui/useReducedMotion'

import {
  getRouteMotionDirection,
  isContinuousResearchTransition,
  type RouteMotionDirection,
} from './route-motion-model'

const routeMotionDurationMs = 300

type RouteMotionState = {
  active: boolean
  direction: RouteMotionDirection
  pathname: string
}

/** 页面只在真实 pathname 变化后进入；search 与 hash 变化不重复播放。 */
export function RouteMotionSurface({ children, identityKey }: { children: ReactNode; identityKey?: string | null }) {
  const { pathname } = useLocation()
  const surface = useRef<HTMLDivElement>(null)
  const previousIdentity = useRef(identityKey)
  const reduced = useReducedMotion()
  const [motion, setMotion] = useState<RouteMotionState>({
    active: false,
    direction: 'lateral',
    pathname,
  })

  useLayoutEffect(() => {
    const identityChanged = previousIdentity.current !== identityKey
    previousIdentity.current = identityKey
    setMotion((current) => current.pathname === pathname
      ? identityChanged || reduced ? { ...current, active: false } : current
      : {
          active: !reduced && !identityChanged && current.pathname !== '/settings' && pathname !== '/settings' && !isContinuousResearchTransition(current.pathname, pathname),
          direction: getRouteMotionDirection(current.pathname, pathname),
          pathname,
        })
  }, [pathname, reduced, identityKey])

  useLayoutEffect(() => {
    if (!motion.active || reduced) return
    // Animate only new content; no old-page snapshots, router remount keys or data delays.
    // Opacity avoids making fixed/popover descendants relative to a transformed ancestor.
    const target = surface.current?.querySelector<HTMLElement>('.application-frame__main') ?? surface.current
    const durationToken = target ? getComputedStyle(target).getPropertyValue('--qx-motion-base').trim() : ''
    const tokenDuration = parseFloat(durationToken) * (durationToken.endsWith('s') && !durationToken.endsWith('ms') ? 1000 : 1)
    const duration = Number.isFinite(tokenDuration) && tokenDuration >= 0 ? tokenDuration * 1.25 : routeMotionDurationMs
    const animation = target?.animate?.([{ opacity: .58 }, { opacity: 1 }], {
      duration, easing: target ? getComputedStyle(target).getPropertyValue('--qx-ease-standard').trim() || 'cubic-bezier(0.65, 0, 0.35, 1)' : 'ease-in-out',
    })
    // Finish on the same clock as WAAPI; the previous fixed 240ms cleanup could
    // truncate a longer theme token before its visible transition completed.
    const timer = window.setTimeout(() => {
      setMotion((current) => current.pathname === motion.pathname
        ? { ...current, active: false }
        : current)
    }, duration)
    return () => { window.clearTimeout(timer); animation?.cancel() }
  }, [motion.active, motion.pathname, reduced])

  const active = motion.active && motion.pathname === pathname
  const direction = motion.pathname === pathname ? motion.direction : 'lateral'

  return (
    <div
      ref={surface}
      className="route-motion-surface"
      data-testid="route-motion-surface"
      data-motion-active={active ? 'true' : 'false'}
      data-motion-direction={direction}
    >
      {children}
    </div>
  )
}
