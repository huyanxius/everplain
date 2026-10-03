export type AppearancePreference = 'system' | 'light' | 'dark'

export const appearancePreferenceStorageKey = 'everplain.appearance'

/** Browser-local only: no account API or cross-device synchronization. */
export function readAppearancePreference(): AppearancePreference {
  try {
    const stored = window.localStorage.getItem(appearancePreferenceStorageKey)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

function applyAppearancePreference(preference: AppearancePreference) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  // Shared tokens, native controls, and landing-page shaders follow this choice.
  // System removes the override and retains tokens.css's existing `light dark`.
  root.style.colorScheme = preference === 'system' ? '' : preference
  root.dataset.colorScheme = preference
}

/** Call before mounting the app so a stored choice applies to the first render. */
export function initializeAppearancePreference(): AppearancePreference {
  const preference = readAppearancePreference()
  applyAppearancePreference(preference)
  return preference
}

export function setAppearancePreference(preference: AppearancePreference) {
  applyAppearancePreference(preference)
  try {
    window.localStorage.setItem(appearancePreferenceStorageKey, preference)
  } catch {
    // Storage may be unavailable. The explicit choice still applies this session.
  }
}
