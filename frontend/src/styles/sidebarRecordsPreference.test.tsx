import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { readSidebarRecordsOpen, setSidebarRecordsOpen, sidebarRecordsPreferenceStorageKey, useSidebarRecordsOpen } from './sidebarRecordsPreference'

function Probe() {
  const [open, setOpen] = useSidebarRecordsOpen()
  return <button onClick={() => setOpen(value => !value)}>{open ? '展开' : '收起'}</button>
}
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); setSidebarRecordsOpen(true); localStorage.clear()
})
it('defaults open and restores the stored closed choice', () => {
  expect(readSidebarRecordsOpen()).toBe(true)
  localStorage.setItem(sidebarRecordsPreferenceStorageKey, 'closed')
  expect(readSidebarRecordsOpen()).toBe(false)
})
it('updates mounted shells immediately and retains the choice after remount', () => {
  const first = render(<Probe />)
  fireEvent.click(screen.getByRole('button', { name: '展开' }))
  expect(screen.getByRole('button', { name: '收起' })).toBeVisible()
  first.unmount(); render(<Probe />)
  expect(screen.getByRole('button', { name: '收起' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '收起' }))
  expect(screen.getByRole('button', { name: '展开' })).toBeVisible()
})
it('updates on another tab storage change and reset', () => {
  render(<Probe />)
  act(() => {
    localStorage.setItem(sidebarRecordsPreferenceStorageKey, 'closed')
    window.dispatchEvent(new StorageEvent('storage', { key: sidebarRecordsPreferenceStorageKey, newValue: 'closed', storageArea: localStorage }))
  })
  expect(screen.getByRole('button', { name: '收起' })).toBeVisible()
  act(() => { localStorage.clear(); window.dispatchEvent(new StorageEvent('storage', { key: null, storageArea: localStorage })) })
  expect(screen.getByRole('button', { name: '展开' })).toBeVisible()
})
it('retains a session choice when browser storage is unavailable', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('unavailable') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable') })
  const first = render(<Probe />)
  fireEvent.click(screen.getByRole('button', { name: '展开' }))
  first.unmount(); render(<Probe />)
  expect(screen.getByRole('button', { name: '收起' })).toBeVisible()
})
