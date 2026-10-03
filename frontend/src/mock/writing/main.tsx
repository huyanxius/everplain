import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '../../styles/theme.css'
import '../../styles/tokens.css'
import '../../styles/components.css'
import '../../styles/base.css'
import './writing.css'
import { WritingMock } from './WritingMock'

/* 写作工作台单页 Mock：只在 vite dev 下以 /writing.html 访问，不接后端。 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WritingMock />
  </StrictMode>,
)
