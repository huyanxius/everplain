import { afterEach, expect, it, vi } from 'vitest'
import { flyBubble, markLaunch, settleComposer, takeLaunch } from './sendFlight'
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; takeLaunch('') })
it('consumes only an equal-text launch once, expires at two seconds, and cancels stale ownership', () => {
  const clock = vi.spyOn(performance, 'now').mockReturnValue(100)
  const rect = new DOMRect(20, 300, 400, 80)
  markLaunch(rect, '  同样的问题  ')
  expect(takeLaunch('同样的问题')).toBe(rect); expect(takeLaunch('同样的问题')).toBeNull()
  markLaunch(rect, '问题'); expect(takeLaunch('历史问题')).toBeNull(); expect(takeLaunch('问题')).toBeNull()
  markLaunch(rect, '问题'); clock.mockReturnValue(2101); expect(takeLaunch('问题')).toBeNull()
  const clear = markLaunch(rect, '旧'); markLaunch(rect, '新'); clear(); expect(takeLaunch('新')).toBe(rect)
})
it('derives 57 deformation samples from spring velocity and cancels all four animation tracks', async () => {
  const cancels: ReturnType<typeof vi.fn>[] = []
  const calls: { frames: Keyframe[]; options: KeyframeAnimationOptions }[] = []
  vi.stubGlobal('CSS', { supports: () => true })
  const animate = vi.fn(function (_frames: Keyframe[], options: KeyframeAnimationOptions) {
    const cancel = vi.fn(); cancels.push(cancel); calls.push({ frames: _frames, options })
    return { cancel, finished: new Promise(() => {}) }
  })
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
  const bubble = document.createElement('div'); bubble.className = 'qx-bubble'; bubble.textContent = '真实问题'; bubble.setAttribute('data-awaiting-flight', '')
  document.body.append(bubble)
  vi.spyOn(bubble, 'getBoundingClientRect').mockReturnValue(new DOMRect(400, 100, 180, 70))
  const stop = flyBubble(bubble, new DOMRect(40, 600, 420, 90))
  expect(document.querySelector('.cv-flight')).toHaveAttribute('aria-hidden', 'true')
  expect(calls).toHaveLength(4); expect(calls[0].options.duration).toBe(940)
  expect(calls[0].options.easing).toMatch(/^linear\(/)
  expect(calls[1].options.duration).toBe(940 * .62)
  expect(calls[2].frames).toHaveLength(57); expect(calls[2].options.easing).toBe('linear')
  expect(calls[2].frames.some(frame => Number(String(frame.scale).split(' ')[0]) > 1)).toBe(true)
  expect(calls[3].frames[0]).toEqual({ backgroundColor: 'transparent' })
  stop(); stop(); expect(document.querySelector('.cv-flight')).toBeNull(); expect(bubble).not.toHaveAttribute('data-awaiting-flight')
  cancels.forEach(cancel => expect(cancel).toHaveBeenCalledOnce())
  Reflect.deleteProperty(HTMLElement.prototype, 'animate')
})
it('reveals the real bubble if animation fails or reduced motion is requested', () => {
  const bubble = document.createElement('div'); bubble.setAttribute('data-awaiting-flight', '')
  document.body.append(bubble)
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: () => { throw new Error('unsupported') } })
  flyBubble(bubble, new DOMRect()); expect(bubble).not.toHaveAttribute('data-awaiting-flight'); expect(document.querySelector('.cv-flight')).toBeNull()
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  bubble.setAttribute('data-awaiting-flight', ''); flyBubble(bubble, new DOMRect()); expect(bubble).not.toHaveAttribute('data-awaiting-flight')
  Reflect.deleteProperty(HTMLElement.prototype, 'animate')
})
it('settles composer height in 320ms and exposes cancellation', () => {
  const form = document.createElement('form'), cancel = vi.fn()
  vi.spyOn(form, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 56))
  form.animate = vi.fn(() => ({ cancel, finished: Promise.resolve() }) as unknown as Animation)
  const stop = settleComposer(form, 180)
  expect(form.animate).toHaveBeenCalledWith([{ height: '180px' }, { height: '56px' }], { duration: 320, easing: 'cubic-bezier(.16, 1, .3, 1)' })
  stop(); expect(cancel).toHaveBeenCalledOnce()
})
