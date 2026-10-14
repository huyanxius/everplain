import { useLayoutEffect, useRef, type CSSProperties } from 'react'
import { useReducedMotion } from '../../ui/useReducedMotion'
import { agentAvatarById, closedSmoothPath, type AgentAvatarId } from './avatars'
import './agent-avatar.css'

const LIQUID_POINTS = 120
const LIQUID_ORDER: readonly AgentAvatarId[] = ['cheng', 'you', 'ruo', 'heng', 'shi', 'qi', 'nian']
const LIQUID_SPEED = 1.5, LIQUID_HOLD = .9 / LIQUID_SPEED, LIQUID_FLOW = 1 / LIQUID_SPEED
const liquidCache = new Map<AgentAvatarId, number[]>()

/** Each preset is sampled once; the temporary measurement SVG never remains in the page. */
function liquidOutline(id: AgentAvatarId) {
  const cached = liquidCache.get(id)
  if (cached) return cached
  const probe = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const path = document.createElementNS(probe.namespaceURI, 'path') as SVGPathElement
  // DOM-less/test renderers keep the authentic static preset rather than inventing a contour.
  if (!path.getTotalLength || !path.getPointAtLength) return null
  probe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden'
  probe.setAttribute('aria-hidden', 'true')
  path.setAttribute('d', agentAvatarById[id].shape)
  probe.append(path); document.body.append(probe)
  try {
    const total = path.getTotalLength()
    const dense = Array.from({ length: 1440 }, (_, i) => {
      const q = path.getPointAtLength(total * i / 1440)
      return { a: Math.atan2(q.y - 62, q.x - 60), r: Math.hypot(q.x - 60, q.y - 62) }
    }).sort((m, n) => m.a - n.a)
    const radii = Array.from({ length: LIQUID_POINTS }, (_, j) => {
      let a = -Math.PI / 2 + j * 2 * Math.PI / LIQUID_POINTS
      if (a > Math.PI) a -= 2 * Math.PI
      const k = dense.findIndex(d => d.a >= a)
      if (k <= 0) return dense[0].r
      const lo = dense[k - 1], hi = dense[k]
      return lo.r + (hi.r - lo.r) * (a - lo.a) / (hi.a - lo.a || 1)
    })
    liquidCache.set(id, radii)
    return radii
  } finally { probe.remove() }
}

function spring(t: number) {
  const zeta = .7, w = 2 * Math.PI / .7, wd = w * Math.sqrt(1 - zeta ** 2)
  return 1 - Math.exp(-zeta * w * t) * (Math.cos(wd * t) + zeta * w / wd * Math.sin(wd * t))
}

export function AgentLiquid({ lead, color, size = 76 }: { lead?: AgentAvatarId; color?: string; size?: number }) {
  const reduced = useReducedMotion()
  const svg = useRef<SVGSVGElement>(null)
  const body = useRef<SVGPathElement>(null)
  const look = useRef<SVGGElement>(null)
  const nose = useRef<SVGEllipseElement>(null)
  const first = lead && agentAvatarById[lead] ? lead : 'cheng'
  const preset = agentAvatarById[first]
  useLayoutEffect(() => {
    const el = svg.current
    if (!el || !body.current || !look.current || !nose.current) return
    const seq = [first, ...LIQUID_ORDER.filter(id => id !== first)]
    const radii = seq.map(liquidOutline)
    const decor = Array.from(el.querySelectorAll<SVGGElement>('.aa-liquid-decor'))
    const t0 = window.performance.now()
    let raf = 0
    const frame = (now: number) => {
      const t = Math.max(0, now - t0) / 1000, period = LIQUID_HOLD + LIQUID_FLOW, tw = t * LIQUID_SPEED
      const k = Math.floor(t / period), local = t - k * period
      const a = k % seq.length, b = (k + 1) % seq.length
      const p = local > LIQUID_HOLD ? spring((local - LIQUID_HOLD) * LIQUID_SPEED) : 0
      const w = Math.min(1, Math.max(0, p))
      const amp = .5 + 2.6 * Math.sin(Math.PI * Math.min(1, (local - LIQUID_HOLD) / LIQUID_FLOW)) * (local > LIQUID_HOLD ? 1 : 0)
      const ra = radii[a], rb = radii[b]
      const A = agentAvatarById[seq[a]], B = agentAvatarById[seq[b]]
      if (ra && rb) body.current!.setAttribute('d', closedSmoothPath(ra.map((r0, j) => {
        const ang = -Math.PI / 2 + j * 2 * Math.PI / LIQUID_POINTS
        const r = r0 + (rb[j] - r0) * p + amp * (.6 * Math.sin(3 * ang + tw * 2.1) + .4 * Math.sin(5 * ang - tw * 1.7))
        return [60 + Math.cos(ang) * r, 62 + Math.sin(ang) * r] as const
      })))
      else body.current!.setAttribute('d', A.shape)
      const aColor = lead === seq[a] && color ? color : A.color
      const bColor = lead === seq[b] && color ? color : B.color
      el.style.setProperty('--aa-color', w === 0 ? aColor : `color-mix(in oklab, ${aColor} ${((1 - w) * 100).toFixed(1)}%, ${bColor})`)
      el.dataset.avatar = seq[a]
      look.current!.setAttribute('transform', `translate(${(A.look.x + (B.look.x - A.look.x) * p).toFixed(2)} ${(A.look.y + (B.look.y - A.look.y) * p).toFixed(2)})`)
      nose.current!.style.opacity = String(((A.nose ? 1 - w : 0) + (B.nose ? w : 0)) * .86)
      decor.forEach(g => {
        const id = g.dataset.avatar
        const v = id === seq[a] ? 1 - w : id === seq[b] ? w : 0
        g.style.opacity = v.toFixed(3)
        g.style.transform = `scale(${(.55 + .45 * v).toFixed(3)})`
      })
    }
    frame(t0)
    if (!reduced) {
      const loop = (now: number) => { frame(now); raf = requestAnimationFrame(loop) }
      raf = requestAnimationFrame(loop)
    }
    return () => cancelAnimationFrame(raf)
  }, [first, lead, color, reduced])
  return <svg ref={svg} className="agent-avatar aa-liquid" viewBox="0 0 120 120" data-avatar={first} data-state="idle" data-playing={!reduced} aria-hidden="true" style={{ width: size, height: size, '--aa-color': color ?? preset.color } as CSSProperties}>
    <g className="aa-head">
      <g className="aa-behind">{LIQUID_ORDER.map(id => <g key={id} className="aa-liquid-decor" data-avatar={id} style={{ opacity: id === first ? 1 : 0 }}>{agentAvatarById[id].behind?.()}</g>)}</g>
      <path ref={body} className="aa-body" d={preset.shape} />
      <g ref={look} transform={`translate(${preset.look.x} ${preset.look.y})`}><g className="aa-gaze">
        {[-6.6, 6.6].map(dx => <g key={dx} transform={`translate(${dx} 0)`}><g className="aa-eye"><rect className="aa-pupil" x="-3.6" y="-8" width="7.2" height="16" rx="3.6" /><path className="aa-happy" d="M-4.4 2 Q0 -5.5 4.4 2" /></g></g>)}
        <ellipse ref={nose} className="aa-nose" cx="0" cy="10.5" rx="2.6" ry="1.9" />
      </g></g>
    </g>
  </svg>
}
