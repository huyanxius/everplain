import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '../../styles/theme.css'
import '../../styles/tokens.css'
import '../../styles/components.css'
import '../../styles/base.css'
import '../shared/composer.css'
import './editor.css'
import { EditorPage } from './EditorPage'

/* 共享编辑器展示页：只在 vite dev 下以 /editor.html 访问，不接后端。 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EditorPage />
  </StrictMode>,
)
