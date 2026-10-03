import type { ReactNode } from 'react'
import { CornersOutIcon, GraphIcon, MinusIcon, PlusIcon, ShuffleIcon, SquaresFourIcon } from '@phosphor-icons/react'
import { Link } from 'react-router'
import { PageContent, PageShell } from '../ui/PageShell'
import './knowledge-layout.css'

export function KnowledgePage({ children, graph = false }: { children: ReactNode; graph?: boolean }) {
  return <PageShell wide><PageContent><main className={`ep-knowledge-page${graph ? ' ep-knowledge-page--graph' : ''}`}>{children}</main></PageContent></PageShell>
}

export function KnowledgePageHead({ title, actions, children }: { title: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return <header className="ep-knowledge-head"><div className="ep-knowledge-head__row"><h1 className="qx-section-title">{title}</h1>{actions && <div className="ep-knowledge-head__actions">{actions}</div>}</div>{children}</header>
}

export function KnowledgeViewSwitch({ view }: { view: 'cards' | 'graph' }) {
  return <nav className="qx-segmented ep-knowledge-view" aria-label="知识库视图"><Link to="/library" aria-label="资料卡片" aria-current={view === 'cards' ? 'page' : undefined}><SquaresFourIcon size={18} /></Link><Link to="/my/graph" aria-label="图谱" aria-current={view === 'graph' ? 'page' : undefined}><GraphIcon size={18} /></Link></nav>
}

export function KnowledgeGraphControls({ controls }: { controls: { zoomIn: () => void; zoomOut: () => void; fit: () => void; relayout: () => void } }) {
  return <><div className="ep-knowledge-zoom"><button type="button" className="qx-btn qx-btn--secondary qx-btn--icon" aria-label="放大" onClick={controls.zoomIn}><PlusIcon size={18} /></button><button type="button" className="qx-btn qx-btn--secondary qx-btn--icon" aria-label="缩小" onClick={controls.zoomOut}><MinusIcon size={18} /></button></div><div className="ep-knowledge-map-actions"><button type="button" className="qx-btn qx-btn--secondary qx-btn--icon" aria-label="适应画布" onClick={controls.fit}><CornersOutIcon size={17} /></button><button type="button" className="qx-btn qx-btn--secondary qx-btn--icon" aria-label="重新布局" onClick={controls.relayout}><ShuffleIcon size={17} /></button></div></>
}
