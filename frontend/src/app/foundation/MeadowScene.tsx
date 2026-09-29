import { useEffect, useRef, useState } from 'react'
import { PauseIcon, PlayIcon } from '@phosphor-icons/react'
import meadow from '../../assets/website/meadow.webp'
import library from '../../assets/website/library.webp'
import type { MeadowRenderer } from './meadow-renderer'

export function MeadowScene() {
  const host = useRef<HTMLDivElement>(null)
  const engine = useRef<MeadowRenderer | null>(null)
  const [motion, setMotion] = useState(() => !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  const motionRef = useRef(motion)
  motionRef.current = motion

  useEffect(() => {
    const element = host.current
    const journey = element?.closest<HTMLElement>('.ep-journey')
    if (!element || !journey || !window.matchMedia) return
    let disposed = false
    let frame = 0
    let progress = 0
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => {
      frame = 0
      const rect = journey.getBoundingClientRect()
      progress = Math.max(0, Math.min(1, -rect.top / Math.max(1, rect.height - window.innerHeight)))
      const transition = Math.max(0, Math.min(1, (progress - .16) / .52))
      element.style.setProperty('--library-opacity', String(transition * transition * (3 - 2 * transition)))
      engine.current?.setProgress(progress)
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }
    const onPreference = () => setMotion(!media.matches)
    const onPointer = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || !motionRef.current) return
      engine.current?.setPointer((event.clientX / window.innerWidth - .5) * 2, (.5 - event.clientY / window.innerHeight) * 2)
    }
    const onLeave = () => engine.current?.setPointer(0, 0)
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    journey.addEventListener('pointermove', onPointer, { passive: true })
    journey.addEventListener('pointerleave', onLeave)
    media.addEventListener('change', onPreference)
    update()
    // Keep the large rendering dependency out of the initial page bundle.
    void import('./meadow-renderer').then(({ createMeadowRenderer }) => {
      if (disposed) return
      try {
        engine.current = createMeadowRenderer(element, { meadow, library })
        engine.current.setMotion(motionRef.current)
        engine.current.setProgress(progress)
      } catch {
        element.dataset.renderer = 'fallback'
      }
    }).catch(() => { if (!disposed) element.dataset.renderer = 'fallback' })
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      journey.removeEventListener('pointermove', onPointer)
      journey.removeEventListener('pointerleave', onLeave)
      media.removeEventListener('change', onPreference)
      engine.current?.dispose()
      engine.current = null
    }
  }, [])

  useEffect(() => { engine.current?.setMotion(motion) }, [motion])

  return <div className="ep-scene-wrap">
    <div className="ep-scene" ref={host} aria-hidden="true">
      <div className="ep-scene-fallback"><img src={meadow} alt="" fetchPriority="high" /><img className="ep-library-matte" src={library} alt="" /></div>
    </div>
    <div className="ep-scene-shade" aria-hidden="true" />
    <button className="ep-motion-toggle" type="button" onClick={() => setMotion(!motion)} aria-label={motion ? '暂停场景动效' : '开启场景动效'} aria-pressed={!motion}>
      {motion ? <PauseIcon size={13} weight="fill" aria-hidden="true" /> : <PlayIcon size={13} weight="fill" aria-hidden="true" />}<span>{motion ? '让风停一会儿' : '让风继续'}</span>
    </button>
  </div>
}
