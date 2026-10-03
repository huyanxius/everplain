import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SettingsModal } from './SettingsModal'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const dialogMethods = Object.getOwnPropertyDescriptors(HTMLDialogElement.prototype)

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) { this.setAttribute('open', '') },
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) { this.removeAttribute('open') },
  })
})

afterEach(() => {
  cleanup()
  for (const key of ['showModal', 'close']) {
    if (dialogMethods[key]) Object.defineProperty(HTMLDialogElement.prototype, key, dialogMethods[key])
    else Reflect.deleteProperty(HTMLDialogElement.prototype, key)
  }
  document.body.style.overflow = ''
})

describe('SettingsModal', () => {
  it('shows the real selected pet and name and follows same-user profile updates', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const profile = { name: '小叶', avatar_id: 'nian', color: '#ec8a52' }
    client.setQueryData(['agent-profile', 'owner'], profile)
    render(<QueryClientProvider client={client}><SettingsModal userId="owner" accountName="林同学" onClose={() => undefined}>账户内容</SettingsModal></QueryClientProvider>)
    expect(screen.getByText('小叶')).toBeVisible()
    expect(screen.getByText('林同学')).toBeVisible()
    expect(document.querySelector('.ep-settings-dialog__identity .agent-avatar')).toHaveAttribute('data-avatar', 'nian')
    act(() => { client.setQueryData(['agent-profile', 'owner'], { ...profile, name: '新伙伴', avatar_id: 'you' }) })
    expect(await screen.findByText('新伙伴')).toBeVisible()
    expect(document.querySelector('.ep-settings-dialog__identity .agent-avatar')).toHaveAttribute('data-avatar', 'you')
    cleanup()
    client.clear()
  })

  it('keeps a compact identity and close control outside the scrollable settings body', () => {
    const onClose = vi.fn()
    render(<SettingsModal onClose={onClose}><section>账户内容</section></SettingsModal>)

    const dialog = screen.getByRole('dialog', { name: '账户设置' })
    expect(dialog).toHaveFocus()
    const header = dialog.querySelector('.ep-settings-dialog__heading')!
    const body = dialog.querySelector('.ep-settings-dialog__content')!
    expect(within(header as HTMLElement).getByText('账户')).toBeVisible()
    expect(screen.queryByRole('heading', { name: '设置' })).not.toBeInTheDocument()
    expect(body).toHaveTextContent('账户内容')
    expect(body).not.toContainElement(screen.getByRole('button', { name: '关闭账户设置' }))
    fireEvent.click(screen.getByRole('button', { name: '关闭账户设置' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('dismisses on native cancel and backdrop clicks, but not clicks within the panel', () => {
    const onClose = vi.fn()
    render(<SettingsModal onClose={onClose}><section>账户内容</section></SettingsModal>)
    const dialog = screen.getByRole('dialog', { name: '账户设置' })
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({ left: 100, right: 900, top: 100, bottom: 700 } as DOMRect)

    fireEvent.click(dialog, { clientX: 150, clientY: 150 })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(dialog, { clientX: 20, clientY: 20 })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('leaves the outer settings open while an account confirmation owns dismissal', () => {
    const onClose = vi.fn()
    render(
      <SettingsModal onClose={onClose}>
        <section role="dialog" aria-modal="true" aria-label="确认账户操作">确认</section>
      </SettingsModal>,
    )
    const dialog = screen.getByRole('dialog', { name: '账户设置' })
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({ left: 100, right: 900, top: 100, bottom: 700 } as DOMRect)

    fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }))
    fireEvent.click(dialog, { clientX: 20, clientY: 20 })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('restores the previous page scroll and focus when dismissed', () => {
    const trigger = document.createElement('button')
    trigger.textContent = '打开设置'
    document.body.append(trigger)
    trigger.focus()
    document.body.style.overflow = 'auto'
    const { unmount } = render(<SettingsModal onClose={() => undefined}>账户内容</SettingsModal>)

    expect(document.body.style.overflow).toBe('hidden')
    screen.getByRole('button', { name: '关闭账户设置' }).focus()
    unmount()
    expect(document.body.style.overflow).toBe('auto')
    expect(trigger).toHaveFocus()
    trigger.remove()
  })
})
