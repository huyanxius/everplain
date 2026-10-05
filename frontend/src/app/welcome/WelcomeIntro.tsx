import { useLayoutEffect, useRef, useState } from 'react'
import { AgentAvatar, agentAvatarPresets } from '../../modules/agent-avatar'

/** The original ink-drop opening, with destinations measured from the live picker. */
export function WelcomeIntro({ userId, enabled }: { userId: string | null; enabled: boolean }) {
  const storageKey = `everplain:welcome-intro:${userId ?? 'signed-out'}`
  const [visible, setVisible] = useState(() => enabled && !hasSeen(storageKey))
  const [fading, setFading] = useState(false)
  const [flying, setFlying] = useState(false)
  const boundary = useRef<HTMLDivElement>(null)
  const finish = useRef<() => void>(() => {})
  useLayoutEffect(() => {
    if (!visible || !enabled) return
    const box = boundary.current
    const main = box?.parentElement
    if (!box || !main) return
    const animations: Animation[] = []
    const timers = new Set<ReturnType<typeof setTimeout>>()
    let alive = true
    let ended = false
    const siblings = Array.from(main.children).filter((element): element is HTMLElement => element instanceof HTMLElement && element !== box)
    const inert = siblings.map(element => element.inert)
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const reveal = () => {
      main.classList.remove('setup-flow--intro-hidden', 'setup-flow--intro-fly')
      siblings.forEach((element, index) => { element.inert = inert[index] })
    }
    const end = () => {
      if (!alive || ended) return
      ended = true
      try { sessionStorage.setItem(storageKey, 'seen') } catch { /* Privacy mode can make storage unavailable. */ }
      reveal()
      if (reduced?.matches || typeof box.animate !== 'function') setVisible(false)
      else {
        setFading(true)
        const timer = setTimeout(() => { timers.delete(timer); if (alive) setVisible(false) }, 500)
        timers.add(timer)
      }
      if (document.activeElement === box) (previousFocus?.isConnected ? previousFocus : main.querySelector<HTMLButtonElement>('.setup-avatars button'))?.focus({ preventScroll: true })
    }
    finish.current = end
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const onMotion = () => { if (reduced?.matches) end() }
    reduced?.addEventListener('change', onMotion)
    if (reduced?.matches || typeof box.animate !== 'function') {
      end()
      return () => { alive = false; reduced?.removeEventListener('change', onMotion) }
    }
    main.classList.add('setup-flow--intro-hidden')
    siblings.forEach(element => { element.inert = true })
    box.focus({ preventScroll: true })
    const animate = (element: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
      const animation = element.animate(keyframes, options)
      animations.push(animation)
    }
    const pause = (duration: number) => new Promise<void>(resolve => {
      const timer = setTimeout(() => { timers.delete(timer); resolve() }, duration)
      timers.add(timer)
    })
    const run = async () => {
      const width = window.innerWidth, height = window.innerHeight, cx = width / 2, cy = height * .46
      const dot = box.querySelector<HTMLElement>('.setup-intro__drop')!
      const ring = box.querySelector<HTMLElement>('.setup-intro__ring')!
      const at = (x: number, y: number, scale = '') => `translate(${x - 8}px,${y - 8}px) ${scale}`
      animate(dot, [
        { transform: at(cx, -30), offset: 0, easing: 'cubic-bezier(.55,0,1,.45)' },
        { transform: at(cx, cy, 'scale(1.5,.6)'), offset: .42, easing: 'cubic-bezier(0,.55,.45,1)' },
        { transform: at(cx, cy - 70, 'scale(.85,1.15)'), offset: .66, easing: 'cubic-bezier(.55,0,1,.45)' },
        { transform: at(cx, cy, 'scale(1.3,.75)'), offset: .86, easing: 'cubic-bezier(.3,1.6,.5,1)' },
        { transform: at(cx, cy, 'scale(1)'), offset: 1 },
      ], { duration: 1050, fill: 'forwards' })
      await pause(1050); if (!alive || ended) return
      animate(ring, [{ transform: at(cx, cy, 'scale(1)'), opacity: .5 }, { transform: at(cx, cy, 'scale(7)'), opacity: 0 }], { duration: 700, easing: 'cubic-bezier(.2,.7,.1,1)', fill: 'forwards' })
      animate(dot, [{ transform: at(cx, cy, 'scale(1)') }, { transform: at(cx, cy, 'scale(1.9)'), offset: .6 }, { transform: at(cx, cy, 'scale(0)') }], { duration: 300, easing: 'ease-in', fill: 'forwards' })
      await pause(300); if (!alive || ended) return
      const gap = Math.min(96, (width - 48) / 7), size = 72
      const figures = Array.from(box.querySelectorAll<HTMLElement>('.setup-intro__pet'))
      const row = agentAvatarPresets.map((_, index) => [cx + (index - 3) * gap, cy])
      figures.forEach((figure, index) => {
        figure.style.visibility = 'visible'
        animate(figure, [{ transform: `translate(${cx - size / 2}px,${cy - size / 2}px) scale(0)` }, { transform: `translate(${row[index][0] - size / 2}px,${row[index][1] - size / 2}px) scale(1)` }], { duration: 620, delay: Math.abs(index - 3) * 55, easing: 'cubic-bezier(.3,1.5,.5,1)', fill: 'forwards' })
      })
      await pause(1500); if (!alive || ended) return
      const targets = Array.from(main.querySelectorAll<SVGSVGElement>('.setup-avatars--companions svg')).map(element => element.getBoundingClientRect())
      if (targets.length !== figures.length) { end(); return }
      figures.forEach((figure, index) => {
        const rect = targets[index], scale = rect.width / size
        figure.querySelector('svg')?.setAttribute('data-state', 'idle')
        animate(figure, [{ transform: `translate(${row[index][0] - size / 2}px,${row[index][1] - size / 2}px) scale(1)` }, { transform: `translate(${rect.left + rect.width / 2 - size / 2}px,${rect.top + rect.height / 2 - size / 2}px) scale(${scale})` }], { duration: 800, delay: index * 35, easing: 'cubic-bezier(.65,0,.25,1)', fill: 'forwards' })
      })
      setFlying(true)
      main.classList.add('setup-flow--intro-fly')
      main.classList.remove('setup-flow--intro-hidden')
      await pause(800 + 7 * 35)
      end()
    }
    void run().catch(end)
    return () => {
      alive = false
      timers.forEach(clearTimeout)
      animations.forEach(animation => animation.cancel())
      reduced?.removeEventListener('change', onMotion)
      reveal()
    }
  }, [enabled, storageKey, visible])
  if (!visible || !enabled) return null
  return <div className={`setup-intro${flying ? ' setup-intro--fly' : ''}${fading ? ' setup-intro--out' : ''}`} ref={boundary} role="button" tabIndex={fading ? -1 : 0} aria-hidden={fading || undefined} aria-label="跳过开场动画" onClick={() => finish.current()} onKeyDown={event => { if (['Enter', ' ', 'Escape'].includes(event.key)) { event.preventDefault(); finish.current() } }}>
    <div className="setup-intro__drop" aria-hidden />
    <div className="setup-intro__ring" aria-hidden />
    {agentAvatarPresets.map((preset, index) => <div className="setup-intro__pet" key={preset.id} aria-hidden><AgentAvatar avatar={preset.id} color={preset.color} size={72} state="greet" offset={-.12 * index} /></div>)}
  </div>
}

function hasSeen(key: string) {
  try { return sessionStorage.getItem(key) === 'seen' } catch { return false }
}
