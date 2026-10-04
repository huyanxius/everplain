/** A completed operation changes both the menu and the settings ledger. */
const eventName = 'everplain:account-usage-changed'

export function notifyAccountUsageChanged() {
  window.dispatchEvent(new Event(eventName))
}

export function watchAccountUsageChanges(refresh: () => void) {
  window.addEventListener(eventName, refresh)
  window.addEventListener('focus', refresh)
  return () => {
    window.removeEventListener(eventName, refresh)
    window.removeEventListener('focus', refresh)
  }
}
