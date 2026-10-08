import { prefersReducedMotion } from '../../ui/useReducedMotion'

type Launch = { rect: DOMRect; text: string; at: number }
let launch: Launch | null = null
const launchPadding = new WeakMap<DOMRect, { left: number; top: number }>()
/** A single, short-lived handoff from an actual composer submission. */
export function markLaunch(rect: DOMRect, text: string, padding = { left: 8, top: 8 }) {
  launchPadding.set(rect, padding)
  const marked = { rect, text: text.trim(), at: performance.now() }
  launch = marked
  return () => { if (launch === marked) launch = null }
}
export function takeLaunch(text: string) {
  const marked = launch
  launch = null
  return marked && marked.text === text.trim() && performance.now() - marked.at <= 2000 ? marked.rect : null
}
const FLIGHT_MS = 940, SAMPLES = 56
function spring(t: number) {
  const zeta = .7, w = 2 * Math.PI / .7, wd = w * Math.sqrt(1 - zeta ** 2)
  return 1 - Math.exp(-zeta * w * t) * (Math.cos(wd * t) + zeta * w / wd * Math.sin(wd * t))
}
const springSamples = Array.from({ length: SAMPLES + 1 }, (_, i) => i === SAMPLES ? 1 : spring(i / SAMPLES * FLIGHT_MS / 1000))
const STRETCH_FRAMES: Keyframe[] = (() => {
  const vel = springSamples.map((_, i) => springSamples[Math.min(SAMPLES, i + 1)] - springSamples[Math.max(0, i - 1)])
  const peak = Math.max(...vel)
  return vel.map((v, i) => {
    const t = i / SAMPLES, n = v / peak, pinch = .035 * Math.exp(-(((t - .06) / .05) ** 2))
    return { scale: `${(1 + .055 * n - pinch).toFixed(4)} ${(1 - .04 * n - pinch).toFixed(4)}`, offset: t }
  })
})()
/** Layout and screen readers retain the real bubble; only a decorative clone flies. */
export function flyBubble(bubble: HTMLElement, from: DOMRect): () => void {
  const reveal = () => bubble.removeAttribute('data-awaiting-flight')
  if (prefersReducedMotion() || typeof bubble.animate !== 'function') { reveal(); return () => {} }
  const to = bubble.getBoundingClientRect(), shell = document.createElement('div')
  shell.className = 'cv-flight'; shell.setAttribute('aria-hidden', 'true'); shell.inert = true
  Object.assign(shell.style, { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px` })
  const ghost = bubble.cloneNode(true) as HTMLElement
  ghost.removeAttribute('data-awaiting-flight'); ghost.removeAttribute('id'); ghost.classList.add('cv-flight__bubble')
  shell.append(ghost); document.body.append(shell)
  const animations: Animation[] = [], media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  let disposed = false
  const cleanup = () => {
    if (disposed) return
    disposed = true; reveal(); shell.remove(); animations.forEach(animation => animation.cancel())
    media?.removeEventListener('change', onPreference); window.removeEventListener('resize', cleanup); window.removeEventListener('popstate', cleanup)
  }
  const onPreference = () => { if (media?.matches) cleanup() }
  media?.addEventListener('change', onPreference); window.addEventListener('resize', cleanup); window.addEventListener('popstate', cleanup)
  try {
    const linear = `linear(${springSamples.map(v => v.toFixed(4)).join(', ')})`
    const easing = typeof CSS !== 'undefined' && CSS.supports('transition-timing-function', linear) ? linear : 'cubic-bezier(.34, 1.3, .64, 1)'
    const padding = launchPadding.get(from) ?? { left: 8, top: 8 }
    const bubbleStyle = getComputedStyle(bubble)
    const dx = from.left + padding.left - (to.left + (parseFloat(bubbleStyle.paddingLeft) || 20))
    const dy = from.top + padding.top - (to.top + (parseFloat(bubbleStyle.paddingTop) || 12))
    const animate = (node: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) => {
      const animation = node.animate(frames, options); animations.push(animation); void animation.finished.catch(() => {}); return animation
    }
    const across = animate(shell, [{ translate: `${dx}px 0` }, { translate: '0 0' }], { duration: FLIGHT_MS, easing, fill: 'both' })
    animate(ghost, [{ translate: `0 ${dy}px` }, { translate: '0 0' }], { duration: FLIGHT_MS * .62, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'both' })
    animate(ghost, STRETCH_FRAMES, { duration: FLIGHT_MS, easing: 'linear', fill: 'both' })
    animate(ghost, [{ backgroundColor: 'transparent' }, { backgroundColor: getComputedStyle(bubble).backgroundColor }], { duration: FLIGHT_MS * .4, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'both' })
    void across.finished.then(cleanup, cleanup)
  } catch { cleanup() }
  return cleanup
}
export function settleComposer(form: HTMLFormElement, before: number): () => void {
  const after = form.getBoundingClientRect().height
  if (prefersReducedMotion() || Math.abs(after - before) < 1 || typeof form.animate !== 'function') return () => {}
  const animation = form.animate([{ height: `${before}px` }, { height: `${after}px` }], { duration: 320, easing: 'cubic-bezier(.16, 1, .3, 1)' })
  void animation.finished.catch(() => {})
  return () => animation.cancel()
}
