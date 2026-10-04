import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useEffect, useRef, useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { usePresence } from '../../ui/usePresence'
import { ConversationLayout } from './ConversationLayout'
import { ConversationSourcePanel } from './ConversationSourcePanel'

let mobile = false
let reduced = false
const mediaListeners = new Map<string, Set<() => void>>()
const previousShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
const previousClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close')
const show = vi.fn(function (this: HTMLDialogElement) { this.open = true })
const close = vi.fn(function (this: HTMLDialogElement) { this.open = false })

beforeEach(() => {
  vi.useFakeTimers()
  mobile = false
  reduced = false
  mediaListeners.clear()
  show.mockClear()
  close.mockClear()
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() { return query.includes('reduced-motion') ? reduced : mobile },
    addEventListener: (_type: string, fn: () => void) => {
      if (!mediaListeners.has(query)) mediaListeners.set(query, new Set())
      mediaListeners.get(query)!.add(fn)
    },
    removeEventListener: (_type: string, fn: () => void) => mediaListeners.get(query)?.delete(fn),
  }))
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: show })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: close })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  if (previousShow) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', previousShow)
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
  if (previousClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', previousClose)
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
})

function SourceOwner() {
  const [open, setOpen] = useState(false)
  const surface = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const motion = usePresence(open, surface)
  const restore = useRef(false)
  useEffect(() => {
    if (!open && !motion.present && restore.current) { trigger.current?.focus(); restore.current = false }
  }, [open, motion.present])
  return <><button ref={trigger} onClick={() => { restore.current = true; setOpen(value => !value) }}>Toggle source</button>
    <ConversationLayout embedded={false} empty={false} research={false} runtimeMode="base"
      sourceOpen={motion.present} sourceClosing={!open} sourceMotionRef={surface}
      title="Test" label="Conversation" modes={null} actions={null} pet={null} prompt="" thread={null} composer={null}
      source={<ConversationSourcePanel closing={!open} onClose={() => setOpen(false)} />} />
  </>
}
function openSource() {
  const trigger = screen.getByRole('button', { name: 'Toggle source' })
  trigger.focus()
  fireEvent.click(trigger)
  const wrapper = document.querySelector<HTMLElement>('.cv-layout__source')!
  wrapper.style.transitionProperty = 'opacity, transform'
  wrapper.style.transitionDuration = '0.14s'
  wrapper.style.transitionDelay = '0s'
  return { trigger, wrapper }
}
function end(surface: Element) {
  const event = new Event('transitionend', { bubbles: true })
  Object.assign(event, { propertyName: 'opacity', pseudoElement: '' })
  fireEvent(surface, event)
}

it('retains a desktop source until its own exit, with hidden and inert closing content', () => {
  render(<SourceOwner />)
  const { trigger, wrapper } = openSource()
  fireEvent.click(screen.getByRole('button', { name: '关闭研究面板' }))
  expect(wrapper).toHaveAttribute('data-presence', 'closing')
  expect(wrapper).toHaveAttribute('inert')
  expect(wrapper).toHaveAttribute('aria-hidden', 'true')
  end(wrapper.firstElementChild!)
  expect(wrapper).toBeInTheDocument()
  end(wrapper)
  expect(wrapper).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
})

it('keeps the native mobile sheet open but explicitly inert until the owner exit completes', () => {
  mobile = true
  render(<SourceOwner />)
  const { trigger, wrapper } = openSource()
  const sheet = screen.getByRole('dialog')
  expect(show).toHaveBeenCalledOnce()
  expect(screen.getByRole('button', { name: '关闭研究面板' })).toHaveFocus()
  fireEvent(sheet, new Event('cancel', { cancelable: true }))
  expect(sheet).toHaveAttribute('open')
  expect(sheet).toHaveAttribute('inert')
  expect(sheet).toHaveAttribute('aria-hidden', 'true')
  expect(wrapper).toHaveAttribute('inert')
  expect(close).not.toHaveBeenCalled()
  expect(trigger).not.toHaveFocus()
  end(wrapper)
  expect(close).toHaveBeenCalledOnce()
  expect(sheet).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
})

it('cancels the old exit on rapid mobile reopening without closing or remounting the native sheet', () => {
  mobile = true
  render(<SourceOwner />)
  const { trigger, wrapper } = openSource()
  const sheet = screen.getByRole('dialog')
  fireEvent.click(screen.getByRole('button', { name: '关闭研究面板' }))
  act(() => vi.advanceTimersByTime(60))
  fireEvent.click(trigger)
  expect(wrapper).not.toHaveAttribute('inert')
  expect(sheet).not.toHaveAttribute('inert')
  expect(sheet).not.toHaveAttribute('aria-hidden')
  expect(screen.getByRole('dialog')).toBe(sheet)
  act(() => vi.advanceTimersByTime(500))
  expect(show).toHaveBeenCalledOnce()
  expect(close).not.toHaveBeenCalled()
  expect(sheet).toHaveAttribute('open')
})

it('closes an in-flight mobile sheet immediately when reduced motion becomes enabled', () => {
  mobile = true
  render(<SourceOwner />)
  const { wrapper, trigger } = openSource()
  const setTimer = vi.spyOn(window, 'setTimeout')
  const clearTimer = vi.spyOn(window, 'clearTimeout')
  fireEvent.click(screen.getByRole('button', { name: '关闭研究面板' }))
  const timerIndex = setTimer.mock.calls.findIndex(call => call[1] === 190)
  expect(timerIndex).toBeGreaterThanOrEqual(0)
  act(() => {
    reduced = true
    for (const notify of mediaListeners.get('(prefers-reduced-motion: reduce)') ?? []) notify()
  })
  expect(wrapper).not.toBeInTheDocument()
  expect(close).toHaveBeenCalledOnce()
  expect(trigger).toHaveFocus()
  expect(clearTimer).toHaveBeenCalledWith(setTimer.mock.results[timerIndex].value)
})

it('does not retain a native sheet when the owner is unmounted during exit', () => {
  mobile = true
  const view = render(<SourceOwner />)
  openSource()
  const sheet = screen.getByRole('dialog')
  const setTimer = vi.spyOn(window, 'setTimeout')
  const clearTimer = vi.spyOn(window, 'clearTimeout')
  fireEvent.click(screen.getByRole('button', { name: '关闭研究面板' }))
  const timerIndex = setTimer.mock.calls.findIndex(call => call[1] === 190)
  expect(timerIndex).toBeGreaterThanOrEqual(0)
  view.unmount()
  expect(close).toHaveBeenCalledOnce()
  expect(sheet).not.toBeInTheDocument()
  expect(clearTimer).toHaveBeenCalledWith(setTimer.mock.results[timerIndex].value)
})

it('dismisses without a delay when no shared transition stylesheet is present', () => {
  mobile = true
  render(<SourceOwner />)
  fireEvent.click(screen.getByRole('button', { name: 'Toggle source' }))
  fireEvent.click(screen.getByRole('button', { name: '关闭研究面板' }))
  expect(document.querySelector('.cv-layout__source')).toBeNull()
  expect(close).toHaveBeenCalledOnce()
})
