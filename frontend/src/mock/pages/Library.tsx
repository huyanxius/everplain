import { useMemo, useState } from 'react'
import {
  ArrowClockwiseIcon,
  BookmarkSimpleIcon,
  CheckCircleIcon,
  FolderIcon,
  GraphIcon,
  LinkIcon,
  MagnifyingGlassIcon,
  NoteIcon,
  PlusIcon,
  SquaresFourIcon,
  TelevisionSimpleIcon,
  UploadSimpleIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'

import { materials, topics, type MaterialKind } from '../data'
import { go } from '../state'
import { Dialog, MaterialCard, PageHead, TopicChip } from '../ui'

/* 知识库：卡片网格 + 搜索是主视图，图谱只是右上角切换过去的次级视图。 */
export function LibraryPage() {
  const [query, setQuery] = useState('')
  const [topic, setTopic] = useState<string | null>(null)
  const [kind, setKind] = useState<MaterialKind | null>(null)
  const [importing, setImporting] = useState(false)

  const shown = useMemo(
    () =>
      materials.filter(
        (m) =>
          (!topic || m.topicId === topic) &&
          (!kind || m.kind === kind) &&
          (!query || (m.title + m.summary).includes(query)),
      ),
    [query, topic, kind],
  )

  return (
    <div className="mk-page">
      <PageHead
        title="知识库"
        actions={
          <>
            <div className="qx-segmented" role="tablist" aria-label="视图">
              <button role="tab" aria-selected="true" aria-label="卡片">
                <SquaresFourIcon />
              </button>
              <button role="tab" aria-selected="false" aria-label="图谱" onClick={() => go('/graph')}>
                <GraphIcon />
              </button>
            </div>
            <button className="qx-btn qx-btn--primary" onClick={() => setImporting(true)}>
              <PlusIcon /> 添加
            </button>
          </>
        }
      >
        <label className="qx-search mk-search">
          <MagnifyingGlassIcon />
          <input placeholder="搜标题、内容、知识点" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="mk-filters">
          <button className="qx-tag" aria-pressed={!topic} onClick={() => setTopic(null)}>
            全部 {materials.length}
          </button>
          {topics.map((t) => (
            <TopicChip key={t.id} topicId={t.id} as="button" pressed={topic === t.id} onClick={() => setTopic(topic === t.id ? null : t.id)} />
          ))}
          <span className="mk-filters__sep" />
          {(['网页', 'PDF', '笔记', '视频', '书签'] as const).map((k) => (
            <button key={k} className="qx-tag qx-tag--outline" aria-pressed={kind === k} onClick={() => setKind(kind === k ? null : k)}>
              {k}
            </button>
          ))}
        </div>
      </PageHead>

      <div className="qx-notice mk-import-status">
        <ArrowClockwiseIcon className="mk-spin" />
        <span>正在导入 Chrome 书签：已完成 186 / 248，2 条打不开。</span>
        <button className="qx-btn qx-btn--ghost" onClick={() => setImporting(true)}>
          查看
        </button>
      </div>

      {shown.length ? (
        <div className="mk-grid mk-grid--cards">
          {shown.map((m) => (
            <MaterialCard key={m.id} m={m} />
          ))}
        </div>
      ) : (
        <div className="mk-empty">
          <p className="qx-heading">没有找到"{query}"</p>
          <p className="qx-meta">换个说法，或者直接问 Agent。</p>
          <a className="qx-btn qx-btn--secondary" href="#/agent/c1">
            问 Agent
          </a>
        </div>
      )}

      {importing ? <ImportDialog onClose={() => setImporting(false)} /> : null}
    </div>
  )
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const sources = [
    { icon: <BookmarkSimpleIcon />, name: 'Chrome 书签' },
    { icon: <FolderIcon />, name: 'Obsidian' },
    { icon: <TelevisionSimpleIcon />, name: 'B 站收藏夹' },
    { icon: <NoteIcon />, name: 'Apple 备忘录' },
  ]
  return (
    <Dialog title="添加资料" onClose={onClose} wide>
      <div className="mk-import">
        <div className="qx-search mk-import__link">
          <LinkIcon />
          <input placeholder="粘贴一个链接" autoFocus />
          <button className="qx-btn qx-btn--primary">收进来</button>
        </div>
        <button className="mk-dropzone">
          <UploadSimpleIcon />
          <strong>拖文件到这里，或点击选择</strong>
          <small>PDF、Word、Markdown、图片、音视频</small>
        </button>
        <div>
          <h3 className="qx-heading">从别处导入</h3>
          <div className="mk-import__sources">
            {sources.map((s) => (
              <button key={s.name} className="qx-btn qx-btn--secondary">
                {s.icon} {s.name}
              </button>
            ))}
          </div>
        </div>
        <div>
          <h3 className="qx-heading">进行中</h3>
          <ul className="mk-batches">
            <li>
              <ArrowClockwiseIcon className="mk-spin" />
              <span>Chrome 书签</span>
              <span className="qx-meta">186 / 248</span>
            </li>
            <li>
              <CheckCircleIcon />
              <span>Obsidian · 读书笔记</span>
              <span className="qx-meta">63 条</span>
            </li>
            <li className="mk-batches__fail">
              <WarningCircleIcon />
              <span>2 个网页打不开：zhihu.com 需要登录，example.org 已失效</span>
              <button className="qx-btn qx-btn--ghost">重试</button>
            </li>
          </ul>
        </div>
      </div>
    </Dialog>
  )
}
