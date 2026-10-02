import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '../styles/theme.css'
import '../styles/tokens.css'
import '../styles/components.css'
import '../styles/base.css'
import './mock.css'
import { MockApp } from './MockApp'

/* 开发期 Mock 入口：只在 vite dev 下以 /mock.html 访问，不接后端，生产构建只打包 index.html。 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MockApp />
  </StrictMode>,
)
