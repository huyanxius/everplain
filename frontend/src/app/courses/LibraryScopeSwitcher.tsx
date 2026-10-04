import { useEffect, useRef, useState } from 'react'
import { CaretDownIcon, LinkIcon, PlusIcon } from '@phosphor-icons/react'
import { Link, useSearchParams } from 'react-router'
import { formatMaterialSize } from '../../modules/research-materials'
import type { SharedCourse, readKnowledgeStorage } from '../../modules/shared-knowledge'
import './library-scope.css'

type Props = {
  libraries: SharedCourse[]
  selectedId?: string | null
  view: 'cards' | 'graph'
  storage?: Awaited<ReturnType<typeof readKnowledgeStorage>> | null
  onCreate: () => void
  onManage?: () => void
}

export function LibraryScopeSwitcher({ libraries, selectedId, view, storage, onCreate, onManage }: Props) {
  const [params] = useSearchParams()
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLSpanElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const owners = libraries.filter(library => library.access === 'owner')
  const readers = libraries.filter(library => library.access === 'reader')
  const current = libraries.find(library => library.id === selectedId)
  useEffect(() => { setOpen(false) }, [selectedId, view])
  useEffect(() => {
    if (!open) return
    const outside = (event: MouseEvent) => { if (!anchor.current?.contains(event.target as Node)) setOpen(false) }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus() }
    }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', key) }
  }, [open])
  function href(id?: string) {
    const query = new URLSearchParams()
    if (id) query.set('kb_id', id)
    if (view === 'graph' && params.get('view') === 'points') query.set('view', 'points')
    return `${view === 'cards' ? '/library' : '/my/graph'}${query.size ? `?${query}` : ''}`
  }
  return <span className="ep-library-scope" ref={anchor}>
    <button ref={trigger} type="button" className="qx-btn qx-btn--ghost qx-title-control" aria-label={`切换知识库：${current?.name ?? '全部资料'}`} aria-expanded={open} aria-controls="library-scope-menu" onClick={() => setOpen(value => !value)}>{current?.name ?? '全部资料'}<CaretDownIcon aria-hidden="true" /></button>
    {open && <span id="library-scope-menu" className="qx-menu ep-library-scope__menu" aria-label="知识库目录" onClick={() => setOpen(false)}>
      <Link className="qx-item" to={href()} aria-current={!selectedId ? 'true' : undefined}>全部资料<span className="qx-item__trail">{owners.reduce((total, library) => total + (library.documents.length || library.readyDocumentCount), 0)}</span></Link>
      <span className="qx-group-label">我的</span>
      {owners.map(library => <Link className="qx-item" key={library.id} to={href(library.id)} aria-current={library.id === selectedId ? 'true' : undefined}><span>{library.name}</span><span className="qx-item__trail">{library.documents.length || library.readyDocumentCount}</span></Link>)}
      {onManage && <button type="button" className="qx-item" onClick={onManage}>管理知识库</button>}
      <button type="button" className="qx-item" disabled={!!storage && owners.length >= storage.max_libraries} onClick={onCreate}><PlusIcon />新建知识库</button>
      <span className="qx-group-label">共享给我的</span>
      {readers.map(library => <Link className="qx-item" key={library.id} to={`/shared/${encodeURIComponent(library.id)}`}><span>{library.name}</span><span className="qx-item__trail">只读</span></Link>)}
      {!readers.length && <span className="qx-meta ep-library-scope__hint">还没有加入的知识库</span>}
      <Link className="qx-item" to="/sharing"><LinkIcon />用邀请链接加入</Link>
      {storage && Number.isFinite(storage.used_bytes) && <span className="qx-meta ep-library-scope__storage">已用 {formatMaterialSize(storage.used_bytes)} / {formatMaterialSize(storage.max_bytes)} · {storage.library_count} / {storage.max_libraries} 个知识库 · 资料仅对你可见</span>}
    </span>}
  </span>
}
