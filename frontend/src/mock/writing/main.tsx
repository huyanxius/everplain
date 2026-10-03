import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '../../styles/theme.css'
import '../../styles/tokens.css'
import '../../styles/components.css'
import '../../styles/base.css'
import './writing.css'
import { WritingApp } from './WritingHome'
import '../../app/research/research-materials-page.css'
import '../shared/composer.css'
import './writing-home.css'

/* 写作 Mock：/writing.html 是写作首页（文档列表），#/doc/<标题> 是编辑页。不接后端。 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WritingApp />
  </StrictMode>,
)
