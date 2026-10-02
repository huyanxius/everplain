import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '../styles/theme.css'
import '../styles/tokens.css'
import '../styles/components.css'
import '../styles/base.css'
import './design-system.css'
import { DesignSystemPage } from './DesignSystemPage'

/* 开发期样张入口：只在 vite dev 下以 /design-system.html 访问，生产构建只打包 index.html。 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DesignSystemPage />
  </StrictMode>,
)
