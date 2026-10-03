import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readSidebarLayoutPreference, setSidebarLayoutPreference, sidebarLayoutPreferenceStorageKey, useSidebarLayoutPreference } from './sidebarLayoutPreference'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  setSidebarLayoutPreference(false)
  window.localStorage.removeItem(sidebarLayoutPreferenceStorageKey)
})

describe('browser-local sidebar layout preference', () => {
  it.each([null, '', 'true', 'classic', 'invalid'])('retains the classic layout for %s', value => {
    if (value !== null) window.localStorage.setItem(sidebarLayoutPreferenceStorageKey, value)
    expect(readSidebarLayoutPreference()).toBe(false)
  })

  it('restores an existing split choice on the first render', () => {
    window.localStorage.setItem(sidebarLayoutPreferenceStorageKey, 'split')
    const { result } = renderHook(useSidebarLayoutPreference)
    expect(result.current[0]).toBe(true)
  })

  it('updates all mounted consumers immediately in the same tab', () => {
    const first = renderHook(useSidebarLayoutPreference)
    const second = renderHook(useSidebarLayoutPreference)
    act(() => first.result.current[1](true))
    expect(first.result.current[0]).toBe(true)
    expect(second.result.current[0]).toBe(true)
    expect(window.localStorage.getItem(sidebarLayoutPreferenceStorageKey)).toBe('split')
    act(() => second.result.current[1](false))
    expect(first.result.current[0]).toBe(false)
    expect(window.localStorage.getItem(sidebarLayoutPreferenceStorageKey)).toBe('classic')
  })

  it('responds to another tab changing, deleting, or clearing the preference', () => {
    const { result } = renderHook(useSidebarLayoutPreference)
    const change = (value: string | null, key: string | null = sidebarLayoutPreferenceStorageKey) => act(() => {
      if (value === null) window.localStorage.removeItem(sidebarLayoutPreferenceStorageKey)
      else window.localStorage.setItem(sidebarLayoutPreferenceStorageKey, value)
      window.dispatchEvent(new StorageEvent('storage', { key, newValue: value, storageArea: window.localStorage }))
    })
    change('split')
    expect(result.current[0]).toBe(true)
    change(null)
    expect(result.current[0]).toBe(false)
    change('split')
    change(null, null)
    expect(result.current[0]).toBe(false)
  })

  it('ignores unrelated storage keys and session storage', () => {
    const { result } = renderHook(useSidebarLayoutPreference)
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'another-key', newValue: 'split' }))
      window.dispatchEvent(new StorageEvent('storage', { key: sidebarLayoutPreferenceStorageKey, newValue: 'split', storageArea: window.sessionStorage }))
    })
    expect(result.current[0]).toBe(false)
  })

  it('keeps a failed write effective across subscribers and remounts', () => {
    const first = renderHook(useSidebarLayoutPreference)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded') })
    act(() => first.result.current[1](true))
    expect(first.result.current[0]).toBe(true)
    first.unmount()
    const second = renderHook(useSidebarLayoutPreference)
    expect(second.result.current[0]).toBe(true)
    act(() => second.result.current[1](false))
    expect(second.result.current[0]).toBe(false)
  })

  it('supports toggling when storage reads and writes are unavailable', () => {
    setSidebarLayoutPreference(false)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage denied') })
    const { result } = renderHook(useSidebarLayoutPreference)
    expect(result.current[0]).toBe(false)
    act(() => result.current[1](true))
    expect(result.current[0]).toBe(true)
  })
})
