import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ConversationLayout } from './ConversationLayout'

let reduced = false
let rect = { left: 300, top: 260, width: 680, height: 58 }
const cancels: ReturnType<typeof vi.fn>[] = []
const animate = vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => {
  let reject: (reason?: unknown) => void = () => {}
  const finished = new Promise<void>((_resolve, onReject) => { reject = onReject })
  const cancel = vi.fn(() => reject(new Error('Animation cancelled'))); cancels.push(cancel)
  return { cancel, finished } as unknown as Animation
})
beforeEach(() => {
  reduced = false; rect = { left: 300, top: 260, width: 680, height: 58 }; cancels.length = 0; animate.mockClear()
  vi.stubGlobal('matchMedia', () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} }))
  vi.spyOn(HTMLFormElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ ...rect, x: rect.left, y: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height, toJSON() {} }))
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete (HTMLElement.prototype as { animate?: unknown }).animate })
function Fixture({ empty, origin }: { empty: boolean; origin?: typeof rect }) {
  return <ConversationLayout embedded={false} empty={empty} research={false} runtimeMode="base" sourceOpen={false}
    title="对话" label="对话" modes={null} actions={null} pet={null} prompt="来啦。" thread={<p>问题</p>}
    composerOrigin={origin} composer={<form><textarea aria-label="问题" defaultValue="保留草稿" /></form>} />
}

it('animates the existing focused form from center to bottom without replacing its input', () => {
  const view = render(<Fixture empty />)
  const input = screen.getByRole('textbox'); input.focus()
  rect = { ...rect, top: 720, width: 692 }
  view.rerender(<Fixture empty={false} />)
  expect(screen.getByRole('textbox')).toBe(input)
  expect(input).toHaveFocus(); expect(input).toHaveValue('保留草稿')
  expect(animate).toHaveBeenCalledWith([
    { transform: 'translate(0px, -460px)', width: '680px' },
    { transform: 'translate(0, 0)', width: '692px' },
  ], { duration: 420, easing: 'cubic-bezier(.16, 1, .3, 1)' })
  expect(input.closest('.cv-layout__compose')).toHaveAttribute('data-docking', 'true')
})

it('continues the home-origin motion when its one-time submit state is consumed', async () => {
  rect = { left: 300, top: 720, width: 692, height: 58 }
  const origin = { left: 260, top: 390, width: 400, height: 58 }
  const view = render(<StrictMode><Fixture empty={false} origin={origin} /></StrictMode>)
  await act(async () => {})
  const last = cancels.at(-1)!
  expect(last).not.toHaveBeenCalled()
  view.rerender(<StrictMode><Fixture empty={false} /></StrictMode>)
  expect(last).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox').closest('.cv-layout__compose')).toHaveAttribute('data-docking', 'true')
})

it('uses current narrow viewport geometry and cancels cleanly on resize', () => {
  rect = { left: 24, top: 210, width: 342, height: 92 }
  const view = render(<Fixture empty />)
  rect = { left: 22, top: 648, width: 346, height: 92 }
  view.rerender(<Fixture empty={false} />)
  expect(animate.mock.calls[0]?.[0]).toEqual([
    { transform: 'translate(2px, -438px)', width: '342px' },
    { transform: 'translate(0, 0)', width: '346px' },
  ])
  fireEvent(window, new Event('resize'))
  expect(cancels[0]).toHaveBeenCalled()
  expect(screen.getByRole('textbox').closest('.cv-layout__compose')).not.toHaveAttribute('data-docking')
})

it('does not animate restored conversations or reduced-motion first sends', () => {
  const existing = render(<Fixture empty={false} />)
  expect(animate).not.toHaveBeenCalled(); existing.unmount()
  reduced = true
  const view = render(<Fixture empty />)
  rect = { ...rect, top: 720 }
  view.rerender(<Fixture empty={false} />)
  expect(animate).not.toHaveBeenCalled()
})

it('cleans up on leaving and starts the next conversation from its own center', () => {
  const view = render(<Fixture empty={false} origin={{ ...rect, top: 100 }} />)
  rect = { ...rect, top: 320 }
  view.rerender(<Fixture empty />)
  expect(cancels[0]).toHaveBeenCalled()
  rect = { ...rect, top: 720 }
  view.rerender(<Fixture empty={false} />)
  expect(animate.mock.calls.at(-1)?.[0]).toEqual([
    { transform: 'translate(0px, -400px)', width: '680px' },
    { transform: 'translate(0, 0)', width: '680px' },
  ])
  view.unmount(); expect(cancels.at(-1)).toHaveBeenCalled()
})
