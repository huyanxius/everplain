import { useEffect, useRef, useState } from 'react'
import { CaretDownIcon, MagnifyingGlassIcon, PlusIcon } from '@phosphor-icons/react'

import { WritingMock } from './WritingMock'

/*
 * 写作是应用侧栏里的一级菜单。点进来先到这里（写作首页：文档列表），点某一篇才进编辑页。
 * 路由：#/ 列表，#/doc/<标题> 编辑页；真实应用里对应 /writing 和 /writing/:documentId。
 *
 * 文体（公文 / 报告 / 正式文体 / 小说 / 随笔）是文档的一个属性：新建时选，列表里能按它筛选。
 * Agent 按文体分别学用户的写法，这件事在后台做，界面上不单独展示。
 */

type Genre = '公文' | '报告' | '正式文体' | '小说' | '随笔'
type Doc = { title: string; genre: Genre; excerpt: string; words: number; updated: string }

const genres: Genre[] = ['公文', '报告', '正式文体', '小说', '随笔']

const documents: Doc[] = [
  { title: '便利店与第三空间', genre: '随笔', excerpt: '我第一次注意到楼下那家便利店，是在搬来这座城市的第三个冬天。', words: 1240, updated: '刚刚' },
  { title: '城市第三空间调研报告', genre: '报告', excerpt: '本报告基于 12 位受访者的半结构访谈，考察年轻人在大城市中的非正式社交场所。', words: 8630, updated: '今天 10:42' },
  { title: '关于开展读书月活动的通知', genre: '公文', excerpt: '各学院、各部门：为营造良好的读书氛围，经研究决定，于十月开展读书月活动。', words: 960, updated: '昨天' },
  { title: '第三个冬天 · 第一章', genre: '小说', excerpt: '雨停的时候，林舟还站在便利店门口，手里那杯豆浆已经凉了。', words: 5320, updated: '周一' },
  { title: '开题报告 · 研究问题', genre: '正式文体', excerpt: '本研究关注的问题是：中国城市中的年轻人如何在家与工作之外维系低成本的社会联系。', words: 3410, updated: '9 月 28 日' },
  { title: '周记 · 十月', genre: '随笔', excerpt: '这周读完了《绝好的地方》，最大的收获是"常客"这个词。', words: 780, updated: '9 月 27 日' },
]

export function WritingApp() {
  const read = () => {
    const m = /^#\/doc\/(.+)$/.exec(window.location.hash)
    return m ? decodeURIComponent(m[1]) : null
  }
  const [doc, setDoc] = useState<string | null>(read)
  useEffect(() => {
    const on = () => setDoc(read())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  if (doc) return <WritingMock key={doc} title={doc} onBack={() => { window.location.hash = '/' }} />
  return <WritingHome onOpen={(t) => { window.location.hash = `/doc/${encodeURIComponent(t)}` }} />
}

function WritingHome({ onOpen }: { onOpen: (title: string) => void }) {
  const [genre, setGenre] = useState<Genre | null>(null)
  const [q, setQ] = useState('')
  const shown = documents.filter((d) => (!genre || d.genre === genre) && (!q || (d.title + d.excerpt).includes(q.trim())))

  return (
    <div className="wh-page">
      <aside className="wh-shellgap" aria-label="应用侧栏位置说明">
        <strong>应用侧栏</strong>
        <p>全局导航由应用外壳提供，「写作」是其中一项，点它进入这一页。</p>
      </aside>

      <main className="wh-main">
        <header className="wh-head">
          <h1 className="qx-section-title">写作</h1>
          <NewMenu onCreate={(g) => onOpen(`未命名${g}`)} />
        </header>

        <label className="qx-search wh-search">
          <MagnifyingGlassIcon />
          <input type="search" placeholder="搜标题、正文" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>

        <div className="wh-filters" role="group" aria-label="按文体筛选">
          <button type="button" className="qx-tag" aria-pressed={!genre} onClick={() => setGenre(null)}>全部 {documents.length}</button>
          {genres.map((g) => (
            <button key={g} type="button" className="qx-tag" aria-pressed={genre === g} onClick={() => setGenre(genre === g ? null : g)}>
              {g} {documents.filter((d) => d.genre === g).length}
            </button>
          ))}
        </div>

        {shown.length ? (
          <ul className="wh-list" aria-label="文档">
            {shown.map((d) => (
              <li key={d.title}>
                <button type="button" className="wh-row" onClick={() => onOpen(d.title)}>
                  <span className="wh-row__main">
                    <strong>{d.title}</strong>
                    <span className="wh-row__excerpt">{d.excerpt}</span>
                  </span>
                  <span className="wh-row__genre">{d.genre}</span>
                  <span className="wh-row__meta">{d.words.toLocaleString()} 字</span>
                  <span className="wh-row__meta wh-row__time">{d.updated}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="wh-empty">
            <p className="qx-card__title">{q || genre ? '没有找到相关文档' : '写下第一篇'}</p>
            <p className="qx-meta">{q || genre ? '换个关键词，或调整筛选条件。' : '选一种文体开始，Agent 会按这种文体学你的写法。'}</p>
          </div>
        )}
      </main>
    </div>
  )
}

/* 新建：先选文体。用产品现成的按钮和菜单条目，不另造样式。 */
function NewMenu({ onCreate }: { onCreate: (g: Genre) => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', off)
    return () => document.removeEventListener('pointerdown', off)
  }, [open])
  return (
    <div className="wh-new" ref={root}>
      <button type="button" className="qx-btn qx-btn--primary" aria-expanded={open} onClick={() => setOpen(!open)}>
        <PlusIcon /> 新建 <CaretDownIcon />
      </button>
      {open ? (
        <div className="qx-menu wh-new__menu" role="menu">
          {genres.map((g) => (
            <button key={g} type="button" className="qx-item" role="menuitem" onClick={() => { setOpen(false); onCreate(g) }}>{g}</button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
