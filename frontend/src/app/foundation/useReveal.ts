import { useEffect, useRef, useState } from 'react'

export const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/**
 * 演示区块进入视口后才开始播放，只触发一次。
 * 没有 IntersectionObserver（测试环境、老浏览器）时视为立即可见，
 * 这样演示至少会停在终态，而不是永远空白。
 */
export function useReveal<T extends Element>(threshold = 0.35) {
  const ref = useRef<T>(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (typeof IntersectionObserver === 'undefined') { setShown(true); return }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setShown(true); observer.disconnect() }
    }, { threshold })
    observer.observe(node)
    return () => observer.disconnect()
  }, [threshold])
  return [ref, shown] as const
}

/**
 * 按步推进的演示时间线：step 从 0 走到 total。
 * 减少动态效果时直接跳到终态；replay 让访客再看一遍。
 */
export function useTimeline(active: boolean, delays: number[]) {
  const [step, setStep] = useState(0)
  const [run, setRun] = useState(0)
  const total = delays.length
  const key = delays.join(',')
  useEffect(() => {
    if (!active) { setStep(0); return }
    if (prefersReducedMotion()) { setStep(total); return }
    setStep(0)
    let elapsed = 0
    const timers = delays.map((delay, index) => {
      elapsed += delay
      return window.setTimeout(() => setStep(index + 1), elapsed)
    })
    return () => timers.forEach(window.clearTimeout)
    // key 已覆盖 delays 的内容变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, run, key, total])
  return { step, done: step >= total, replay: () => setRun(value => value + 1) }
}
