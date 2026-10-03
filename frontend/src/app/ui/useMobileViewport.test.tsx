import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useMobileViewport } from './useMobileViewport'

const originalViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  if (originalViewport) Object.defineProperty(window, 'visualViewport', originalViewport)
  else Reflect.deleteProperty(window, 'visualViewport')
  document.documentElement.style.removeProperty('--app-viewport-height')
  document.documentElement.style.removeProperty('--app-viewport-offset-top')
})

it('tracks the visible mobile keyboard area and restores shared variables on desktop', async () => {
  const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 })
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
  const remove = vi.spyOn(viewport, 'removeEventListener')
  const style = document.documentElement.style
  style.setProperty('--app-viewport-height', '90dvh')
  const { rerender } = renderHook(({ enabled }) => useMobileViewport(enabled), { initialProps: { enabled: true } })
  expect(style.getPropertyValue('--app-viewport-height')).toBe('844px')
  act(() => { viewport.height = 380; viewport.offsetTop = 12; viewport.dispatchEvent(new Event('resize')) })
  await waitFor(() => expect(style.getPropertyValue('--app-viewport-height')).toBe('380px'))
  expect(style.getPropertyValue('--app-viewport-offset-top')).toBe('12px')
  rerender({ enabled: false })
  expect(style.getPropertyValue('--app-viewport-height')).toBe('90dvh')
  expect(style.getPropertyValue('--app-viewport-offset-top')).toBe('')
  expect(remove).toHaveBeenCalledWith('resize', expect.any(Function))
  expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function))
})

it('leaves pinch zoom to the browser and cleans up pending viewport work', async () => {
  const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 })
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
  const style = document.documentElement.style
  const { unmount } = renderHook(() => useMobileViewport(true))
  act(() => { viewport.scale = 2; viewport.height = 300; viewport.offsetTop = 100; viewport.dispatchEvent(new Event('resize')) })
  await new Promise(resolve => window.requestAnimationFrame(resolve))
  expect(style.getPropertyValue('--app-viewport-height')).toBe('844px')
  expect(style.getPropertyValue('--app-viewport-offset-top')).toBe('0px')
  act(() => { viewport.scale = 1; viewport.dispatchEvent(new Event('scroll')) })
  unmount()
  await new Promise(resolve => window.requestAnimationFrame(resolve))
  expect(style.getPropertyValue('--app-viewport-height')).toBe('')
})
