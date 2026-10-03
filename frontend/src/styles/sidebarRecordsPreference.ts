import { useSyncExternalStore, type Dispatch, type SetStateAction } from 'react'

export const sidebarRecordsPreferenceStorageKey = 'everplain.sidebar-records'
const listeners = new Set<() => void>()
let sessionOpen = true
let unsaved = false

export function readSidebarRecordsOpen(): boolean {
  if (unsaved) return sessionOpen
  try { sessionOpen = window.localStorage.getItem(sidebarRecordsPreferenceStorageKey) !== 'closed' } catch { /* Keep this session's choice. */ }
  return sessionOpen
}

export const setSidebarRecordsOpen: Dispatch<SetStateAction<boolean>> = value => {
  sessionOpen = typeof value === 'function' ? value(readSidebarRecordsOpen()) : value
  try {
    window.localStorage.setItem(sidebarRecordsPreferenceStorageKey, sessionOpen ? 'open' : 'closed')
    unsaved = false
  } catch { unsaved = true }
  listeners.forEach(listener => listener())
}

function storageChanged(event: StorageEvent) {
  if (event.key !== sidebarRecordsPreferenceStorageKey && event.key !== null) return
  try { if (event.storageArea && event.storageArea !== window.localStorage) return } catch { return }
  unsaved = false
  sessionOpen = event.newValue !== 'closed'
  listeners.forEach(listener => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) window.addEventListener('storage', storageChanged)
  return () => {
    listeners.delete(listener)
    if (!listeners.size) window.removeEventListener('storage', storageChanged)
  }
}

/** A browser-local layout choice, retained across PageShell remounts and reloads. */
export function useSidebarRecordsOpen(): [boolean, Dispatch<SetStateAction<boolean>>] {
  return [useSyncExternalStore(subscribe, readSidebarRecordsOpen, () => true), setSidebarRecordsOpen]
}
