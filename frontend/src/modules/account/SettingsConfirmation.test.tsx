import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { AccountConfirmationDialog } from './SettingsConfirmation'

afterEach(() => { cleanup(); vi.useRealTimers() })

function Confirmation({ pending = false, onCancel = vi.fn(), onConfirm = vi.fn() }: {
  pending?: boolean
  onCancel?: () => void
  onConfirm?: () => void
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  return <><button ref={trigger} onClick={() => setOpen(true)}>Open confirmation</button>
    {open && <AccountConfirmationDialog title="Confirm change" description="A test change" confirmLabel="Confirm" cancelLabel="Cancel"
      pending={pending} triggerRef={trigger} onConfirm={onConfirm} onCancel={() => { onCancel(); setOpen(false) }} />}</>
}

function enableExit(panel: HTMLElement) {
  panel.style.transitionProperty = 'opacity, transform'
  panel.style.transitionDuration = '0.14s'
  panel.style.transitionDelay = '0s'
}

it('animates a user cancellation once and restores focus only after removal', () => {
  vi.useFakeTimers()
  const onCancel = vi.fn()
  render(<Confirmation onCancel={onCancel} />)
  const trigger = screen.getByRole('button', { name: 'Open confirmation' })
  fireEvent.click(trigger)
  const panel = screen.getByRole('dialog')
  enableExit(panel)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(panel).toHaveAttribute('data-presence', 'closing')
  expect(panel).toHaveAttribute('inert')
  expect(panel.parentElement).toHaveAttribute('data-presence', 'closing')
  expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled()
  expect(onCancel).not.toHaveBeenCalled()
  fireEvent.keyDown(document, { key: 'Escape' })
  fireEvent.keyDown(document, { key: 'Tab' })
  act(() => vi.advanceTimersByTime(200))
  expect(onCancel).toHaveBeenCalledOnce()
  expect(panel).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
})

it('does not delay confirmation or a dismissal without a CSS timeline', () => {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(<Confirmation onConfirm={onConfirm} onCancel={onCancel} />)
  fireEvent.click(screen.getByRole('button', { name: 'Open confirmation' }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
  expect(onConfirm).toHaveBeenCalledOnce()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(onCancel).toHaveBeenCalledOnce()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('does not start cancellation while a mutation is pending', () => {
  const onCancel = vi.fn()
  render(<Confirmation pending onCancel={onCancel} />)
  fireEvent.click(screen.getByRole('button', { name: 'Open confirmation' }))
  const panel = screen.getByRole('dialog')
  enableExit(panel)
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(panel).toHaveAttribute('data-presence', 'open')
  expect(onCancel).not.toHaveBeenCalled()
})
