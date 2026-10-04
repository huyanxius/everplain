import { useRef, useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ConversationComposer, type ConversationComposerProps } from './ConversationComposer'

beforeEach(() => {
  vi.useFakeTimers()
  const computed = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => element.hasAttribute('data-motion-surface')
    ? { transitionProperty: 'opacity, transform', transitionDuration: '.14s', transitionDelay: '0s' } as CSSStyleDeclaration
    : computed(element))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

function Fixture({ action }: { action: () => void }) {
  const [open, setOpen] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const tools = useRef<HTMLDivElement>(null)
  const anchor = useRef<HTMLButtonElement>(null)
  const file = useRef<HTMLInputElement>(null)
  return <ConversationComposer mode="standard" value="unsent draft" label="问题" placeholder="问题" maxLength={1000}
    busy={false} canSend={false} canStop={false} uploading={false} toolsOpen={open}
    inputRef={input} toolsRef={tools} toolsButtonRef={anchor} fileRef={file} accept=".pdf" attachments={[]}
    tools={<button type="button" onClick={() => { action(); setOpen(false) }}>上传文件</button>}
    onChange={() => {}} onKeyDown={() => {}} onSubmit={event => event.preventDefault()} onStop={() => {}}
    onToggleTools={() => setOpen(value => !value)} onUpload={() => {}} onRemoveAttachment={() => {}} />
}

it('keeps top-layer content through Escape exit and cancels removal on rapid reopen', () => {
  render(<Fixture action={() => {}} />)
  const trigger = screen.getByRole('button', { name: '添加附件' })
  const input = screen.getByRole('textbox')
  fireEvent.click(trigger)
  const menu = screen.getByRole('menu')
  fireEvent.keyDown(screen.getByRole('button', { name: '上传文件' }), { key: 'Escape' })
  expect(trigger).toHaveFocus()
  expect(menu).toHaveAttribute('data-presence', 'closing')
  expect(menu).toHaveAttribute('inert')
  expect(menu.style.display).not.toBe('none')
  act(() => vi.advanceTimersByTime(60))
  fireEvent.click(trigger)
  act(() => vi.advanceTimersByTime(400))
  expect(screen.getByRole('menu')).toBe(menu)
  expect(screen.getByRole('textbox')).toBe(input)
  expect(input).toHaveValue('unsent draft')
})

it('executes attachment actions immediately once while the surface exits', () => {
  const action = vi.fn()
  render(<Fixture action={action} />)
  fireEvent.click(screen.getByRole('button', { name: '添加附件' }))
  const menu = screen.getByRole('menu')
  fireEvent.click(screen.getByRole('button', { name: '上传文件' }))
  expect(action).toHaveBeenCalledOnce()
  expect(menu).toBeInTheDocument()
  expect(menu).toHaveAttribute('inert')
  act(() => vi.advanceTimersByTime(190))
  expect(menu).not.toBeInTheDocument()
  expect(action).toHaveBeenCalledOnce()
})

it('drops closing attachment content on scope replacement without remounting the input', () => {
 const props = { mode: 'standard', value: 'next draft', label: '问题', placeholder: '问题', maxLength: 1000,
  busy: false, canSend: false, canStop: false, uploading: false, toolsOpen: true,
  inputRef: { current: null }, toolsRef: { current: null }, toolsButtonRef: { current: null }, fileRef: { current: null }, accept: '.pdf', attachments: [],
  tools: <button>Account A attachment</button>, onChange: () => {}, onKeyDown: () => {}, onSubmit: () => {}, onStop: () => {}, onToggleTools: () => {}, onUpload: () => {}, onRemoveAttachment: () => {},
 } as ConversationComposerProps
 const view = render(<ConversationComposer {...props} {...{ scopeKey: 'account-a' }} />)
 const input = screen.getByRole('textbox')
 view.rerender(<ConversationComposer {...props} toolsOpen={false} {...{ scopeKey: 'account-b' }} />)
 expect(screen.queryByText('Account A attachment')).not.toBeInTheDocument()
 expect(screen.getByRole('textbox')).toBe(input)
})
