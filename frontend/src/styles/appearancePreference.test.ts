import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  appearancePreferenceStorageKey,
  initializeAppearancePreference,
  readAppearancePreference,
  setAppearancePreference,
} from './appearancePreference'

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.removeItem(appearancePreferenceStorageKey)
  document.documentElement.style.removeProperty('color-scheme')
  delete document.documentElement.dataset.colorScheme
})

describe('browser appearance preference', () => {
  it.each(['system', 'light', 'dark'] as const)('restores the valid %s choice before render', (preference) => {
    window.localStorage.setItem(appearancePreferenceStorageKey, preference)
    expect(initializeAppearancePreference()).toBe(preference)
    expect(document.documentElement.dataset.colorScheme).toBe(preference)
    expect(document.documentElement.style.colorScheme).toBe(preference === 'system' ? '' : preference)
  })

  it.each([null, '', 'auto', 'Dark', '{"scheme":"dark"}'])('defaults to system for missing or invalid value %s', (preference) => {
    if (preference !== null) window.localStorage.setItem(appearancePreferenceStorageKey, preference)
    expect(readAppearancePreference()).toBe('system')
  })

  it('returns to system without keeping the previous explicit override', () => {
    setAppearancePreference('dark')
    expect(window.localStorage.getItem(appearancePreferenceStorageKey)).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    setAppearancePreference('system')
    expect(window.localStorage.getItem(appearancePreferenceStorageKey)).toBe('system')
    expect(document.documentElement.style.colorScheme).toBe('')
    expect(document.documentElement.dataset.colorScheme).toBe('system')
  })

  it('falls back safely when reading storage is denied', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Storage denied', 'SecurityError') })
    document.documentElement.style.colorScheme = 'dark'
    expect(initializeAppearancePreference()).toBe('system')
    expect(document.documentElement.style.colorScheme).toBe('')
  })

  it('applies the choice even when persistence is denied', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Storage full', 'QuotaExceededError') })
    expect(() => setAppearancePreference('light')).not.toThrow()
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(document.documentElement.dataset.colorScheme).toBe('light')
  })

  it('keeps explicit graph appearances above the OS preference and print above both', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/system-theme.css'), 'utf8')
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\)[\s\S]*?:root:not\(\[data-color-scheme='light'\]\)/)
    expect(css).toMatch(/:root\[data-color-scheme='dark'\]\s*\{\s*--qx-graph-filter: invert/)
    expect(css).toMatch(/:root\[data-color-scheme='light'\]\s*\{\s*--qx-graph-filter: none/)
    const print = css.slice(css.indexOf('@media print'))
    expect(print).toContain(':root[data-color-scheme]')
    expect(print).toContain('color-scheme: light !important')
    expect(print).toContain('--qx-graph-filter: none')
  })
})
