import { useSyncExternalStore } from 'react'

export const sidebarLayoutPreferenceStorageKey = 'everplain.sidebar-layout'
const listeners = new Set<() => void>()
let sessionValue = false
let hasUnsavedChoice = false

/** Browser-local preference. Missing or unrecognized values retain the classic layout. */
export function readSidebarLayoutPreference(): boolean {
  if (hasUnsavedChoice) return sessionValue
  try {
    sessionValue = window.localStorage.getItem(sidebarLayoutPreferenceStorageKey) === 'split'
  } catch {
    // Keep the most recent choice when storage is unavailable.
  }
  return sessionValue
}

function notify() {
  listeners.forEach(listener => listener())
}

export function setSidebarLayoutPreference(value: boolean): void {
  sessionValue = value
  try {
    window.localStorage.setItem(sidebarLayoutPreferenceStorageKey, value ? 'split' : 'classic')
    hasUnsavedChoice = false
  } catch {
    hasUnsavedChoice = true
  }
  notify()
}

function onStorage(event: StorageEvent) {
  if (event.key !== sidebarLayoutPreferenceStorageKey && event.key !== null) return
  try {
    if (event.storageArea && event.storageArea !== window.localStorage) return
  } catch {
    return
  }
  hasUnsavedChoice = false
  sessionValue = event.key !== null && event.newValue === 'split'
  notify()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) window.removeEventListener('storage', onStorage)
  }
}

export function useSidebarLayoutPreference(): [boolean, (value: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, readSidebarLayoutPreference, () => false)
  return [enabled, setSidebarLayoutPreference]
}
