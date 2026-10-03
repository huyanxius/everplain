import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './app/App'
import { AppProviders } from './app/AppProviders'
import { ErrorBoundary } from './app/ErrorBoundary'
import { initializeAppearancePreference } from './styles/appearancePreference'
import './styles/theme.css'
import './styles/tokens.css'
import './styles/components.css'
import './styles/base.css'
import './styles/application-states.css'
import './styles/system-theme.css'

initializeAppearancePreference()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <AppProviders>
        <App />
      </AppProviders>
    </ErrorBoundary>
  </StrictMode>,
)
