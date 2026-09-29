import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MeadowScene } from './MeadowScene'

const renderer = vi.hoisted(() => ({
  setProgress: vi.fn(), setPointer: vi.fn(), setMotion: vi.fn(), dispose: vi.fn(),
}))
const createRenderer = vi.hoisted(() => vi.fn())
vi.mock('./meadow-renderer', () => ({ createMeadowRenderer: createRenderer }))

let reduced = false
beforeEach(() => {
  reduced = false
  createRenderer.mockReset().mockReturnValue(renderer)
  Object.values(renderer).forEach((mock) => mock.mockClear())
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const mountScene = () => render(<section className="ep-journey"><MeadowScene /></section>)

describe('meadow scene lifecycle', () => {
  it('respects reduced motion and allows an explicit opt-in', async () => {
    reduced = true
    mountScene()
    await waitFor(() => expect(renderer.setMotion).toHaveBeenCalledWith(false))
    fireEvent.click(screen.getByRole('button', { name: '开启场景动效' }))
    expect(renderer.setMotion).toHaveBeenLastCalledWith(true)
    expect(screen.getByRole('button', { name: '暂停场景动效' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('releases the scene when navigating away and ignores later pointer events', async () => {
    const { unmount, container } = mountScene()
    await waitFor(() => expect(createRenderer).toHaveBeenCalledTimes(1))
    const journey = container.querySelector('.ep-journey')!
    unmount()
    expect(renderer.dispose).toHaveBeenCalledTimes(1)
    fireEvent.pointerMove(journey, { clientX: 200, clientY: 200 })
    expect(renderer.setPointer).not.toHaveBeenCalled()
  })

  it('keeps a readable static background when WebGL is unavailable', async () => {
    createRenderer.mockImplementation(() => { throw new Error('WebGL unavailable') })
    const { container } = mountScene()
    await waitFor(() => expect(container.querySelector('.ep-scene')).toHaveAttribute('data-renderer', 'fallback'))
    expect(container.querySelector('.ep-scene-fallback')).not.toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('canvas')).toBeNull()
  })
})
