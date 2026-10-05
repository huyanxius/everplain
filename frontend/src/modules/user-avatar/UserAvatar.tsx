import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import '../companion'
import { PEOPLE, type UserAvatarCustom, type UserAvatarId } from './avatar-data'
import { withCustom } from './avatar-colors'
import { renderAvatarLayers } from './avatar-layers'
import './user-avatar.css'
export type UserAvatarMood = 'idle' | 'happy'
export type UserAvatarProps = { id: UserAvatarId; custom?: UserAvatarCustom | null; variant: 'head' | 'resting'; mood?: UserAvatarMood; size?: number }
const motionQuery = '(prefers-reduced-motion: reduce)'
const isReduced = () => typeof window !== 'undefined' && !!window.matchMedia?.(motionQuery).matches
/** The original prototype fragments share Companion's layered animated skeleton. */
export function UserAvatar({ id, custom, variant, mood = 'idle', size = 120 }: UserAvatarProps) {
  const root = useRef<SVGSVGElement>(null)
  const uid = `ua-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}-`
  const [reduced, setReduced] = useState(isReduced)
  const [clickedHappy, setClickedHappy] = useState(false)
  const happyTimer = useRef<number | undefined>(undefined)
  const head = variant === 'head'
  const p = withCustom(PEOPLE.find(person => person.id === id) ?? PEOPLE[0], custom)
  useEffect(() => {
    const media = window.matchMedia?.(motionQuery)
    if (!media) return
    const onChange = () => setReduced(media.matches)
    media.addEventListener?.('change', onChange)
    return () => media.removeEventListener?.('change', onChange)
  }, [])
  useEffect(() => {
    const el = root.current
    if (!el) return
    if (reduced) { el.style.setProperty('--turn', '0.25'); el.style.setProperty('--nod', '0'); return }
    let target = { turn: .2, nod: 0 }
    const current = { turn: .2, nod: 0 }
    let lastMove = 0, frame = 0
    const onMove = (event: PointerEvent) => {
      target = {
        turn: Math.max(-1, Math.min(1, (event.clientX - window.innerWidth / 2) / (window.innerWidth * .45))),
        nod: Math.max(-1, Math.min(1, (event.clientY - window.innerHeight / 2) / (window.innerHeight * .6))),
      }
      lastMove = performance.now()
    }
    const tick = (now: number) => {
      if (now - lastMove > 4000) target = { turn: Math.sin(now / 2300) * .7 + Math.sin(now / 900) * .12, nod: Math.sin(now / 3100) * .35 }
      current.turn += (target.turn - current.turn) * .08; current.nod += (target.nod - current.nod) * .08
      el.style.setProperty('--turn', current.turn.toFixed(3)); el.style.setProperty('--nod', current.nod.toFixed(3))
      frame = requestAnimationFrame(tick)
    }
    window.addEventListener('pointermove', onMove, { passive: true }); frame = requestAnimationFrame(tick)
    return () => { window.removeEventListener('pointermove', onMove); cancelAnimationFrame(frame) }
  }, [reduced])
  useEffect(() => () => window.clearTimeout(happyTimer.current), [])
  const smile = () => {
    setClickedHappy(true); window.clearTimeout(happyTimer.current)
    happyTimer.current = window.setTimeout(() => setClickedHappy(false), 1600)
  }
  return <svg ref={root} className={`companion user-avatar${!head && p.fxClass ? ` ${p.fxClass}` : ''}`}
    data-avatar-id={id} data-variant={variant} data-mood={clickedHappy ? 'happy' : mood} data-reduced-motion={reduced}
    viewBox={head ? '12 10 176 176' : '0 -10 220 224'} width={size} height={head ? size : size * 224 / 220}
    aria-hidden={head ? true : undefined} role={head ? undefined : 'button'} aria-label={head ? undefined : '你的形象，点一下笑'} tabIndex={head ? undefined : 0}
    onClick={head ? undefined : smile} onKeyDown={head ? undefined : event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); smile() } }}
    style={{ '--turn': .2, '--nod': 0, '--cp-hair': p.hair, '--cp-hair-back': p.hairBack, '--cp-hair-shade': p.hairShade, '--cp-hand-shade': '#f0dccb', '--cp-fold': p.fold, '--blush': p.blush ?? .85, '--hat': p.hat ?? '', '--hat-band': p.hatBand ?? '', '--ua-soft-edge': `url(#${uid}soft-edge)`, '--ua-soft': `url(#${uid}soft)` } as CSSProperties}
    // All fragments are static source illustrations; overrides accept only valid hex colors.
    dangerouslySetInnerHTML={{ __html: renderAvatarLayers(p, uid, head) }} />
}
