import { useMemo, useState } from 'react'
import {
  ArrowClockwiseIcon,
  BookmarkSimpleIcon,
  CheckCircleIcon,
  CopyIcon,
  DotsThreeIcon,
  FileTextIcon,
  FolderIcon,
  GlobeIcon,
  LinkIcon,
  MagnifyingGlassIcon,
  NoteIcon,
  PencilSimpleIcon,
  PlusIcon,
  PuzzlePieceIcon,
  ShareNetworkIcon,
  SignOutIcon,
  TelevisionSimpleIcon,
  TrashIcon,
  UploadSimpleIcon,
  UsersIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'

import { joinedLibraries, libraries, libraryById, materialById, materials, topicById, topics, type MaterialKind } from '../data'
import { go } from '../state'
import { Dialog, MaterialCard, PageHead, TopicChip } from '../ui'
import { GraphView } from './Graph'

type View = 'cards' | 'points' | 'graph'

/*
 * 知识库：所有资料的家。现在散在 /library、/library/knowledge（知识整理）、/imports、
 * /my/graph、/sharing 五处的东西都收在这一页：
 *   左栏选库（我的 / 共享给我的），右边三个视图：资料、知识点、图谱；
 *   「添加」弹窗里是全部导入来源和导入记录；「共享」是库上的一个动作。
 * 参数：lib 选中的库，view 视图，add 打开添加弹窗（add=records 直接到记录），share 打开共享。
 */
export function LibraryPage({ lib, view: viewParam }: { lib: string | null; view: string | null }) {
  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
  const view: View = viewParam === 'points' || viewParam === 'graph' ? viewParam : 'cards'
  const current = lib ? libraryById[lib] : null
  const readOnly = !!current?.owner
  const [query, setQuery] = useState('')
  const [topic, setTopic] = useState<string | null>(null)
  const [kind, setKind] = useState<MaterialKind | null>(null)
  const [menu, setMenu] = useState(false)

  const link = (next: { lib?: string | null; view?: View; extra?: string }) => {
    const q = new URLSearchParams()
    const l = next.lib === undefined ? lib : next.lib
    const v = next.view ?? view
    if (l) q.set('lib', l)
    if (v !== 'cards') q.set('view', v)
    const qs = q.toString() + (next.extra ? `${q.toString() ? '&' : ''}${next.extra}` : '')
    return `/library${qs ? `?${qs}` : ''}`
  }
  const close = () => go(link({}))

  const inLib = useMemo(() => (lib ? materials.filter((m) => m.libraryId === lib) : readOnly ? [] : materials), [lib, readOnly])
  const shown = inLib.filter((m) => (!topic || m.topicId === topic) && (!kind || m.kind === kind) && (!query || (m.title + m.summary + m.points.join('')).includes(query)))

  return (
    <div className="mk-page mk-lib">
      <nav className="mk-lib__nav" aria-label="库">
        <a className="qx-item" href={`#${link({ lib: null })}`} aria-current={!lib ? 'true' : undefined}>
          <span>全部资料</span>
          <span className="qx-item__trail">{materials.length}</span>
        </a>
        <p className="qx-group-label">我的</p>
        {libraries.map((l) => (
          <a key={l.id} className="qx-item" href={`#${link({ lib: l.id })}`} aria-current={lib === l.id ? 'true' : undefined}>
            <span>{l.name}</span>
            {l.shared ? <UsersIcon className="qx-item__trail" aria-label={l.shared === 'public' ? '已公开' : '已共享'} /> : <span className="qx-item__trail">{materials.filter((m) => m.libraryId === l.id).length}</span>}
          </a>
        ))}
        <button className="qx-item mk-muted-item">
          <PlusIcon /> 新建库
        </button>
        <p className="qx-group-label">共享给我的</p>
        {joinedLibraries.map((l) => (
          <a key={l.id} className="qx-item" href={`#${link({ lib: l.id })}`} aria-current={lib === l.id ? 'true' : undefined}>
            <span>{l.name}</span>
            <span className="qx-item__trail">只读</span>
          </a>
        ))}
        <a className="qx-item mk-muted-item" href="#/discover">
          <LinkIcon /> 用邀请链接加入
        </a>
      </nav>

      <div className="mk-lib__main">
        <PageHead
          title={current?.name ?? '全部资料'}
          actions={
            <>
              {current && !readOnly ? (
                <a className="qx-btn qx-btn--secondary" href={`#${link({ extra: 'share' })}`}>
                  <ShareNetworkIcon /> {current.shared ? '共享中' : '共享'}
                </a>
              ) : null}
              {!readOnly ? (
                <a className="qx-btn qx-btn--primary" href={`#${link({ extra: 'add' })}`}>
                  <PlusIcon /> 添加
                </a>
              ) : null}
              {current ? (
                <div className="mk-menu-anchor">
                  <button className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="库选项" aria-expanded={menu} onClick={() => setMenu(!menu)}>
                    <DotsThreeIcon weight="bold" />
                  </button>
                  {menu ? (
                    <div className="qx-menu mk-menu" role="menu">
                      {readOnly ? (
                        <button className="qx-item mk-danger" role="menuitem">
                          <SignOutIcon /> 退出这个库
                        </button>
                      ) : (
                        <>
                          <button className="qx-item" role="menuitem">
                            <PencilSimpleIcon /> 重命名
                          </button>
                          <div className="qx-menu__divider" />
                          <button className="qx-item mk-danger" role="menuitem">
                            <TrashIcon /> 删除这个库
                          </button>
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          }
        >
          {readOnly ? <p className="qx-meta">{current?.owner} 分享给你 · 只读，Agent 可以引用</p> : null}
          <div className="mk-lib__bar">
            <div className="qx-segmented" role="tablist" aria-label="视图">
              <button role="tab" aria-selected={view === 'cards'} onClick={() => go(link({ view: 'cards' }))}>资料</button>
              <button role="tab" aria-selected={view === 'points'} onClick={() => go(link({ view: 'points' }))}>知识点</button>
              <button role="tab" aria-selected={view === 'graph'} onClick={() => go(link({ view: 'graph' }))}>图谱</button>
            </div>
            {view !== 'graph' ? (
              <label className="qx-search mk-search">
                <MagnifyingGlassIcon />
                <input placeholder="搜标题、内容、知识点" value={query} onChange={(e) => setQuery(e.target.value)} />
              </label>
            ) : null}
          </div>
          {view === 'cards' ? (
            <div className="mk-filters">
              <button className="qx-tag" aria-pressed={!topic} onClick={() => setTopic(null)}>
                全部主题
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
          ) : null}
        </PageHead>

        {!readOnly && view === 'cards' ? (
          <div className="qx-notice mk-import-status">
            <ArrowClockwiseIcon className="mk-spin" />
            <span>正在整理 Chrome 书签：186 / 248，2 条打不开。</span>
            <a className="qx-btn qx-btn--ghost" href={`#${link({ extra: 'add=records' })}`}>
              导入记录
            </a>
          </div>
        ) : null}

        {readOnly ? <ReadOnlyEmpty /> : view === 'graph' ? <GraphView materials={inLib} /> : view === 'points' ? <PointsView list={shown} /> : shown.length ? (
          <div className="mk-grid mk-grid--cards">
            {shown.map((m) => (
              <MaterialCard key={m.id} m={m} />
            ))}
          </div>
        ) : (
          <div className="mk-empty">
            <p className="qx-heading">{query ? `没有找到"${query}"` : '这里还是空的'}</p>
            <p className="qx-meta">{query ? '换个说法，或者直接问 Agent。' : '粘贴链接、拖文件，或者从别处一次导入。'}</p>
            {query ? (
              <a className="qx-btn qx-btn--secondary" href="#/">问 Agent</a>
            ) : (
              <a className="qx-btn qx-btn--primary" href={`#${link({ extra: 'add' })}`}>
                <PlusIcon /> 添加资料
              </a>
            )}
          </div>
        )}
      </div>

      {params.has('add') ? <AddDialog onClose={close} initial={params.get('add') === 'records' ? 'records' : 'add'} defaultLib={lib && !readOnly ? lib : 'inbox'} /> : null}
      {params.has('share') && current && !readOnly ? <ShareDialog libId={current.id} onClose={close} /> : null}
    </div>
  )
}

/*
 * 知识点视图：现在 /library/knowledge 的"知识整理"。按主题分组，每条能看到出自哪几份资料，
 * 点开直接改；改过的保留用户版本，重新整理时不覆盖。
 */
function PointsView({ list }: { list: readonly (typeof materials)[number][] }) {
  const groups = topics
    .map((t) => ({ t, items: list.filter((m) => m.topicId === t.id).flatMap((m) => m.points.map((p) => ({ p, m }))) }))
    .filter((g) => g.items.length)
  const [editing, setEditing] = useState<string | null>(null)
  return (
    <div className="mk-points-view">
      {groups.map(({ t, items }) => (
        <section key={t.id} className="mk-points-view__group">
          <h2 className="qx-heading">
            <i className="mk-dot" style={{ background: t.color }} /> {t.name}
            <span className="qx-meta">{items.length}</span>
          </h2>
          <ul>
            {items.map(({ p, m }) => {
              const key = m.id + p
              return (
                <li key={key} className="qx-card">
                  {editing === key ? (
                    <input className="qx-input" autoFocus defaultValue={p} onBlur={() => setEditing(null)} onKeyDown={(e) => e.key === 'Enter' && setEditing(null)} />
                  ) : (
                    <button className="mk-points-view__text" onClick={() => setEditing(key)}>
                      {p}
                    </button>
                  )}
                  <a className="qx-meta mk-points-view__src" href={`#/library/${m.id}`}>
                    {m.title}
                  </a>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

function ReadOnlyEmpty() {
  return (
    <div className="mk-grid mk-grid--cards">
      {['m1', 'm5', 'm2'].map((id) => {
        const m = materialById[id]
        return (
          <a key={id} className="qx-card qx-card--interactive mk-mcard" href="#/discover/p1">
            <div className="mk-mcard__top">
              <span className="mk-mcard__kind">{m.kind}</span>
              <i className="mk-dot" style={{ background: topicById[m.topicId].color }} />
            </div>
            <h3 className="qx-card__title">{m.title}</h3>
            <p className="qx-card__body mk-clamp">{m.summary}</p>
            <div className="qx-card__meta">林舟 · {m.points.length} 个知识点</div>
          </a>
        )
      })}
    </div>
  )
}

/*
 * 添加资料：链接、文件、从别处导入、导入记录都在这里。
 * 现在单独的 /imports 页取消；导入来源的"自动同步"开关也从设置挪到这里，跟来源放在一起。
 */
function AddDialog({ onClose, initial, defaultLib }: { onClose: () => void; initial: 'add' | 'records'; defaultLib: string }) {
  const [tab, setTab] = useState(initial)
  const [target, setTarget] = useState(defaultLib)
  const [source, setSource] = useState<string | null>(null)
  const sources = [
    { id: 'browser', icon: <BookmarkSimpleIcon />, name: '浏览器收藏', hint: '导出的 HTML 书签文件' },
    { id: 'obsidian', icon: <FolderIcon />, name: 'Obsidian', hint: '文件夹或 ZIP，保留目录和双链' },
    { id: 'evernote', icon: <NoteIcon />, name: '印象笔记', hint: '导出的 HTML 笔记' },
    { id: 'markdown', icon: <FileTextIcon />, name: 'Markdown', hint: '一个或一批 .md 文件' },
    { id: 'bili', icon: <TelevisionSimpleIcon />, name: 'B 站公开收藏', hint: '输入 UID，先读字幕再转写' },
  ]
  return (
    <Dialog title="添加资料" onClose={onClose} wide>
      <div className="mk-import">
        <div className="mk-import__top">
          <div className="qx-segmented">
            <button aria-pressed={tab === 'add'} onClick={() => setTab('add')}>添加</button>
            <button aria-pressed={tab === 'records'} onClick={() => setTab('records')}>导入记录</button>
          </div>
          {tab === 'add' ? (
            <label className="mk-import__target">
              放进
              <select className="qx-input" value={target} onChange={(e) => setTarget(e.target.value)}>
                {libraries.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        {tab === 'add' ? (
          <>
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
                  <button key={s.id} className="mk-source" aria-pressed={source === s.id} onClick={() => setSource(source === s.id ? null : s.id)}>
                    <span className="mk-source__icon">{s.icon}</span>
                    <span className="mk-source__text">
                      <strong>{s.name}</strong>
                      <small>{s.hint}</small>
                    </span>
                  </button>
                ))}
              </div>
              {source === 'bili' ? (
                <div className="qx-search mk-import__link mk-import__uid">
                  <TelevisionSimpleIcon />
                  <input placeholder="公开账户 UID" autoFocus />
                  <button className="qx-btn qx-btn--primary">读取公开收藏</button>
                </div>
              ) : null}
            </div>
            <div className="mk-import__ext">
              <PuzzlePieceIcon />
              <span>装上浏览器插件，看到好文章点一下就收进来。</span>
              <button className="qx-btn qx-btn--ghost">安装</button>
            </div>
          </>
        ) : (
          <ul className="mk-batches">
            <li>
              <ArrowClockwiseIcon className="mk-spin" />
              <span>Chrome 书签 → 随手收藏</span>
              <span className="qx-meta">186 / 248</span>
            </li>
            <li>
              <CheckCircleIcon />
              <span>Obsidian · 读书笔记 → 读书笔记</span>
              <span className="qx-meta">63 条 · 昨天</span>
            </li>
            <li>
              <GlobeIcon />
              <span>aeon.co/essays/third-places</span>
              <span className="qx-meta">3 天前</span>
            </li>
            <li className="mk-batches__fail">
              <WarningCircleIcon />
              <span>2 个网页打不开：zhihu.com 需要登录，example.org 已失效</span>
              <button className="qx-btn qx-btn--ghost">重试</button>
            </li>
          </ul>
        )}
      </div>
    </Dialog>
  )
}

/*
 * 共享以库为单位。邀请链接是只读的；公开会出现在「发现」。
 * 关闭共享会撤销所有成员和旧链接——这一句要留着，它防的是用户以为"关掉只是不再新增"。
 */
function ShareDialog({ libId, onClose }: { libId: string; onClose: () => void }) {
  const l = libraryById[libId]
  const [linkOn, setLinkOn] = useState(!!l.shared)
  const [publicOn, setPublicOn] = useState(l.shared === 'public')
  return (
    <Dialog title={`共享「${l.name}」`} onClose={onClose}>
      <div className="mk-share">
        <div className="mk-share__row">
          <span>
            <strong>邀请链接</strong>
            <small>拿到链接并登录的人可以加入，只能阅读。</small>
          </span>
          <button className="qx-switch" role="switch" aria-checked={linkOn} aria-label="邀请链接" onClick={() => setLinkOn(!linkOn)} />
        </div>
        {linkOn ? (
          <div className="qx-search mk-import__link">
            <LinkIcon />
            <input readOnly value="everplain.app/join/7fK2-thesis" />
            <button className="qx-btn qx-btn--secondary">
              <CopyIcon /> 复制
            </button>
          </div>
        ) : null}
        {linkOn && l.members ? (
          <ul className="mk-share__members">
            <li>
              <span className="mk-account__avatar">林</span> 林舟 <span className="qx-meta">昨天加入</span>
              <button className="qx-btn qx-btn--ghost">移除</button>
            </li>
            <li>
              <span className="mk-account__avatar">周</span> 周白 <span className="qx-meta">9 月 21 日加入</span>
              <button className="qx-btn qx-btn--ghost">移除</button>
            </li>
          </ul>
        ) : null}
        <div className="mk-share__row">
          <span>
            <strong>公开到发现</strong>
            <small>任何人都能在「发现」里看到并阅读。</small>
          </span>
          <button className="qx-switch" role="switch" aria-checked={publicOn} aria-label="公开到发现" onClick={() => setPublicOn(!publicOn)} />
        </div>
        <p className="qx-meta">关闭共享会同时撤销所有成员和旧链接。</p>
      </div>
    </Dialog>
  )
}
