import { useMemo, useState } from 'react'
import {
  ArrowClockwiseIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  CheckCircleIcon,
  CopyIcon,
  DotsThreeIcon,
  FileArrowUpIcon,
  FolderOpenIcon,
  GlobeIcon,
  ImageIcon,
  LinkIcon,
  MagnifyingGlassIcon,
  NotebookIcon,
  PencilSimpleIcon,
  PlayCircleIcon,
  PlusIcon,
  PuzzlePieceIcon,
  ShareNetworkIcon,
  SignOutIcon,
  TrashIcon,
  UploadSimpleIcon,
  UsersIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'

import { joinedLibraries, libraries, libraryById, materialById, materials, type Material, type MaterialKind } from '../data'
import { go } from '../state'
import { Dialog, MaterialCard, PageHead } from '../ui'
import { GraphView, LibraryMap } from './Graph'

type View = 'cards' | 'points' | 'graph'

/*
 * 知识库：所有资料的家。原来散在五处的东西收进这一页，功能一条不少，见 README「知识库功能清单」：
 *   /library（全部资料、管理知识库、进入某库三种状态）→ 左栏选库，三种状态变成同一个列表里的平级项；
 *   /library/knowledge（知识与关系）→「知识点」视图 + 选中库时的「图谱」视图（知识导图）；
 *   /my/graph（个人图谱）→ 全部资料下的「图谱」视图；
 *   /imports（导入资料）→「添加」弹窗，第二页是导入记录；
 *   /sharing 的管理部分 → 库上的「共享」。
 * 参数：lib 选中的库，view 视图，add 打开添加弹窗（add=records 直接到记录），share 共享，
 *       edit / new 编辑或新建库，remove 删除库。
 */
export function LibraryPage({ lib, view: viewParam }: { lib: string | null; view: string | null }) {
  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
  const view: View = viewParam === 'points' || viewParam === 'graph' ? viewParam : 'cards'
  const current = lib ? libraryById[lib] : null
  const readOnly = !!current?.owner
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<MaterialKind | null>(null)
  const [menu, setMenu] = useState(false)
  const [deleting, setDeleting] = useState<Material | null>(null)

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

  const inLib = useMemo(() => (lib ? materials.filter((m) => m.libraryId === lib) : materials), [lib])
  const kinds = [...new Set(inLib.map((m) => m.kind))]
  const search = query.trim()
  const shown = inLib.filter((m) => (!kind || m.kind === kind) && (!search || (m.title + m.summary + m.points.join('') + libraryById[m.libraryId].name).includes(search)))
  const pending = inLib.filter((m) => m.state && !m.state.startsWith('failed')).length
  const full = !!current && inLib.length >= 100

  return (
    <div className="mk-page mk-lib">
      <nav className="mk-lib__nav" aria-label="知识库目录">
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
        <a className="qx-item mk-muted-item" href={`#${link({ extra: 'new' })}`}>
          <PlusIcon /> 新建知识库
        </a>
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
        <p className="mk-lib__storage qx-meta">已用 1.7 GB / 5 GB · 3 / 10 个知识库 · 资料仅对你可见</p>
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
                full ? (
                  <button className="qx-btn qx-btn--primary" disabled title="每个知识库最多 100 份资料">
                    <PlusIcon /> 添加
                  </button>
                ) : (
                  <a className="qx-btn qx-btn--primary" href={`#${link({ extra: 'add' })}`}>
                    <PlusIcon /> 添加
                  </a>
                )
              ) : null}
              {current ? (
                <div className="mk-menu-anchor">
                  <button className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="知识库选项" aria-expanded={menu} onClick={() => setMenu(!menu)}>
                    <DotsThreeIcon weight="bold" />
                  </button>
                  {menu ? (
                    <div className="qx-menu mk-menu" role="menu">
                      {readOnly ? (
                        <button className="qx-item mk-danger" role="menuitem">
                          <SignOutIcon /> 退出这个知识库
                        </button>
                      ) : (
                        <>
                          <a className="qx-item" role="menuitem" href={`#${link({ extra: 'edit' })}`} onClick={() => setMenu(false)}>
                            <PencilSimpleIcon /> 编辑名称与说明
                          </a>
                          <div className="qx-menu__divider" />
                          <a className="qx-item mk-danger" role="menuitem" href={`#${link({ extra: 'remove' })}`} onClick={() => setMenu(false)}>
                            <TrashIcon /> 删除知识库
                          </a>
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          }
        >
          {current ? <p className="qx-meta">{readOnly ? `${current.owner} 分享给你 · 只读，Agent 可以引用` : current.description || '只有你可以访问这个知识库。'}</p> : null}
          <div className="mk-lib__bar">
            <div className="qx-segmented" role="tablist" aria-label="知识库视图">
              <button role="tab" aria-selected={view === 'cards'} onClick={() => go(link({ view: 'cards' }))}>资料</button>
              <button role="tab" aria-selected={view === 'points'} onClick={() => go(link({ view: 'points' }))}>知识点</button>
              <button role="tab" aria-selected={view === 'graph'} onClick={() => go(link({ view: 'graph' }))}>图谱</button>
            </div>
            {view !== 'graph' ? (
              <label className="qx-search mk-search">
                <MagnifyingGlassIcon />
                <input type="search" placeholder={view === 'points' ? '知识点、概念或方法' : '搜标题、摘要、知识点'} value={query} onChange={(e) => setQuery(e.target.value)} />
              </label>
            ) : null}
          </div>
          {view === 'cards' && !readOnly ? (
            <div className="mk-filters" aria-label="资料筛选">
              <button className="qx-tag" aria-pressed={!kind} onClick={() => setKind(null)}>
                全部 {inLib.length}
              </button>
              {kinds.map((k) => (
                <button key={k} className="qx-tag qx-tag--outline" aria-pressed={kind === k} onClick={() => setKind(kind === k ? null : k)}>
                  {k}
                </button>
              ))}
            </div>
          ) : null}
        </PageHead>

        {!readOnly && view === 'cards' && pending > 0 ? (
          <div className="qx-notice mk-import-status" role="status">
            <ArrowClockwiseIcon className="mk-spin" />
            <span>{pending} 份资料正在解析、整理知识或建立语义索引。</span>
            <a className="qx-btn qx-btn--ghost" href={`#${link({ extra: 'add=records' })}`}>
              导入记录
            </a>
          </div>
        ) : null}

        {readOnly ? (
          <ReadOnlyCards />
        ) : view === 'graph' ? (
          current ? <LibraryMap libId={current.id} /> : <GraphView />
        ) : view === 'points' ? (
          <PointsView libs={current ? [current.id] : libraries.map((l) => l.id)} query={search} />
        ) : shown.length ? (
          <div className="mk-grid mk-grid--cards" aria-label="资料卡片">
            {shown.map((m) => (
              <MaterialCard key={m.id} m={m} showLibrary={!lib} onDelete={setDeleting} />
            ))}
          </div>
        ) : (
          <div className="mk-empty">
            <p className="qx-heading">{search || kind ? '没有找到相关资料' : '把第一份资料，放进来。'}</p>
            <p className="qx-meta">{search || kind ? '换个关键词，或调整筛选条件。' : '收藏、笔记和文档会汇集在这里，保留原文与知识点。'}</p>
            {!search && !kind ? (
              <a className="qx-btn qx-btn--primary" href={`#${link({ extra: 'add' })}`}>
                <PlusIcon /> 添加资料
              </a>
            ) : null}
          </div>
        )}
      </div>

      {params.has('add') ? <AddDialog onClose={close} initial={params.get('add') === 'records' ? 'records' : 'add'} defaultLib={lib && !readOnly ? lib : 'inbox'} /> : null}
      {params.has('share') && current && !readOnly ? <ShareDialog libId={current.id} onClose={close} /> : null}
      {params.has('new') ? <LibraryForm onClose={close} /> : null}
      {params.has('edit') && current && !readOnly ? <LibraryForm libId={current.id} onClose={close} /> : null}
      {params.has('remove') && current && !readOnly ? <RemoveLibrary libId={current.id} onClose={() => go('/library')} /> : null}
      {deleting ? <RemoveMaterial m={deleting} onClose={() => setDeleting(null)} /> : null}
    </div>
  )
}

/*
 * 知识点视图：原来 /library/knowledge 的列表部分。同名知识点合成一条，下面列出各份资料里的说法和原文链接——
 * "同名不等于同义"这句提示要留着。选「全部资料」时按库分组，原来这页必须先选一个库。
 * 整理失败的资料在这里提示，重试在卡片上。
 */
function PointsView({ libs, query }: { libs: readonly string[]; query: string }) {
  return (
    <div className="mk-points-view">
      {libs.map((libId) => {
        const docs = materials.filter((m) => m.libraryId === libId && m.state !== 'parsing' && m.state !== 'failed-parse' && m.state !== 'organizing')
        const groups = new Map<string, Material[]>()
        docs.forEach((m) => m.points.forEach((p) => groups.set(p, [...(groups.get(p) ?? []), m])))
        const items = [...groups].filter(([p, ms]) => !query || (p + ms.map((m) => m.summary).join('')).includes(query))
        const failed = materials.filter((m) => m.libraryId === libId && m.state === 'failed-knowledge')
        const organizing = materials.filter((m) => m.libraryId === libId && m.state === 'organizing').length
        return (
          <section key={libId} className="mk-points-view__group">
            {libs.length > 1 ? (
              <h2 className="qx-heading">
                <a href={`#/library?lib=${libId}&view=points`}>{libraryById[libId].name}</a>
                <span className="qx-meta">
                  {groups.size} 个知识点 · {materials.filter((m) => m.libraryId === libId).length} 份资料
                </span>
              </h2>
            ) : (
              <p className="qx-meta">
                {groups.size} 个知识点 · {materials.filter((m) => m.libraryId === libId).length} 份资料
              </p>
            )}
            {organizing ? <p className="qx-meta">还有 {organizing} 份资料在整理，完成后会出现在这里。</p> : null}
            {failed.map((m) => (
              <p key={m.id} className="qx-notice qx-notice--danger">{m.title}：知识整理失败，可在资料卡片上重试。</p>
            ))}
            {items.length ? (
              <ul>
                {items.map(([p, ms]) => (
                  <li key={p} className="qx-card">
                    <strong className="mk-points-view__text">{p}</strong>
                    {ms.map((m) => (
                      <div key={m.id} className="mk-points-view__src">
                        <p className="qx-meta">{m.summary.slice(0, 42)}…</p>
                        <a className="qx-item" href={`#/library/${m.id}?seg=2`}>
                          阅读原文 · {m.title} <ArrowUpRightIcon />
                        </a>
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="qx-meta">{docs.length ? '没有找到相关知识点。' : '上传资料后，将在这里生成知识点和知识导图。'}</p>
            )}
          </section>
        )
      })}
      <p className="qx-meta mk-points-view__note">同名知识点集中展示，含义以各份原文为准。关系由资料整理产生，需结合原文核对。</p>
    </div>
  )
}

/* 共享给我的库：只读卡片，点开走只读阅读页。没有添加、共享、编辑、删除。 */
function ReadOnlyCards() {
  return (
    <div className="mk-grid mk-grid--cards">
      {['m1', 'm5', 'm2'].map((id) => {
        const m = materialById[id]
        return (
          <a key={id} className="qx-card qx-card--interactive mk-mcard" href="#/discover/p1">
            <span className="mk-mcard__kind">{m.kind}</span>
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
 * 添加资料。原来是两条路：进了某个库点「上传资料」（直接进这个库），或者去 /imports 选来源（后端自动放进「我的资料」）。
 * 这里合成一个弹窗、一个来源列表：第一个来源是「文件」，可以选放进哪个库；其余九个来源照原样，目的地固定是「我的资料」。
 * 两条路的格式和大小限制不同，各自写清楚。
 */
const importSources = [
  { id: 'chrome', icon: <GlobeIcon />, title: '浏览器收藏', hint: 'Chrome、Edge 等导出的书签 HTML' },
  { id: 'obsidian', icon: <FolderOpenIcon />, title: 'Obsidian / Markdown', hint: '笔记文件夹或 ZIP，保留目录和双链' },
  { id: 'apple_notes', icon: <NotebookIcon />, title: 'Apple 备忘录', hint: '上传导出的 Markdown 文件' },
  { id: 'enex', icon: <NotebookIcon />, title: '印象笔记', hint: 'Evernote / 印象笔记 ENEX 导出文件' },
  { id: 'notion', icon: <NotebookIcon />, title: 'Notion', hint: 'HTML 或 Markdown 导出包' },
  { id: 'flomo', icon: <NotebookIcon />, title: 'flomo', hint: '导出的 HTML 笔记文件' },
  { id: 'keep', icon: <NotebookIcon />, title: 'Google Keep', hint: 'Google Takeout ZIP 或 JSON' },
  { id: 'bilibili', icon: <PlayCircleIcon />, title: 'B 站公开收藏', hint: '输入 UID，先读字幕，再按配置转写' },
  { id: 'image', icon: <ImageIcon />, title: '图片与截图', hint: '保留图片，提取文字与内容描述' },
]

function AddDialog({ onClose, initial, defaultLib }: { onClose: () => void; initial: 'add' | 'records'; defaultLib: string }) {
  const [tab, setTab] = useState(initial)
  const [target, setTarget] = useState(defaultLib)
  const [source, setSource] = useState('file')
  const picked = importSources.find((s) => s.id === source)
  return (
    <Dialog title="添加资料" onClose={onClose} wide>
      <div className="mk-import">
        <div className="mk-import__top">
          <div className="qx-segmented">
            <button aria-pressed={tab === 'add'} onClick={() => setTab('add')}>添加</button>
            <button aria-pressed={tab === 'records'} onClick={() => setTab('records')}>导入记录</button>
          </div>
          {tab === 'records' ? (
            <button className="qx-btn qx-btn--ghost">
              <ArrowClockwiseIcon /> 刷新
            </button>
          ) : null}
        </div>

        {tab === 'add' ? (
          <>
            <div className="mk-import__sources" aria-label="来源">
              <button className="mk-source" aria-pressed={source === 'file'} onClick={() => setSource('file')}>
                <span className="mk-source__icon"><UploadSimpleIcon /></span>
                <span className="mk-source__text">
                  <strong>文件</strong>
                  <small>PDF、DOCX、PPTX、Markdown、TXT</small>
                </span>
              </button>
              {importSources.map((s) => (
                <button key={s.id} className="mk-source" aria-pressed={source === s.id} onClick={() => setSource(s.id)} title={s.hint}>
                  <span className="mk-source__icon">{s.icon}</span>
                  <span className="mk-source__text">
                    <strong>{s.title}</strong>
                    <small>{s.hint}</small>
                  </span>
                </button>
              ))}
            </div>

            <div className="mk-import__dest">
              {source === 'file' ? (
                <label className="mk-import__target">
                  放进
                  <select className="qx-input" value={target} onChange={(e) => setTarget(e.target.value)}>
                    {libraries.map((l) => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <span className="qx-meta">导入的资料会放进「我的资料」。重复导入会自动去重，失败的条目可以单独再试。</span>
              )}
            </div>

            {source === 'bilibili' ? (
              <form className="qx-panel mk-import__bili" onSubmit={(e) => e.preventDefault()}>
                <label>
                  公开账户 UID
                  <input className="qx-input" inputMode="numeric" placeholder="例如：123456" />
                </label>
                <button className="qx-btn qx-btn--primary">
                  读取公开收藏 <ArrowRightIcon />
                </button>
                <p className="qx-meta">只读取匿名可见的公开收藏，不需要 Cookie。无字幕的视频需要专用转写服务。</p>
              </form>
            ) : (
              <>
                <button className="mk-dropzone">
                  <FileArrowUpIcon />
                  <strong>拖文件到这里，或点击选择</strong>
                  <small>{picked ? `${picked.title} · ${picked.hint}` : `放进「${libraryById[target].name}」`}</small>
                </button>
                <div className="mk-import__note">
                  {source === 'obsidian' ? <button className="qx-btn qx-btn--secondary">或选择整个文件夹</button> : null}
                  <p className="qx-meta">
                    {source === 'file'
                      ? '单份不超过 20 MB，每个知识库最多 100 份。扫描图片需先转为可选取文字的文档。'
                      : source === 'image'
                        ? '图片识别需配置 Everplain 专用视觉模型；未配置的条目会显示原因并保留重试入口。'
                        : '单个文件最多 16 MB，每批最多 64 MB；资料默认仅你可见。'}
                  </p>
                </div>
                <p className="qx-notice mk-import__progress" role="status">
                  <ArrowClockwiseIcon className="mk-spin" /> 正在上传 2/3：访谈记录-B.docx
                </p>
              </>
            )}

            <div className="mk-import__ext">
              <PuzzlePieceIcon />
              <span>Chrome 扩展支持一键收藏当前页、导入书签，无需复制链接。</span>
              <a className="qx-btn qx-btn--ghost" href="#/library?add">
                下载扩展 <ArrowRightIcon />
              </a>
            </div>
          </>
        ) : (
          <ImportRecords />
        )}
      </div>
    </Dialog>
  )
}

/* 导入记录：原来 /imports 下半页，一项不少——进度、入库/重复/待重试计数、打开资料库、展开条目、单条重试。 */
function ImportRecords() {
  const batches = [
    { id: 'b1', source: '浏览器收藏', status: 'processing', finished: 186, total: 248, imported: 171, duplicates: 15, failed: 0 },
    { id: 'b2', source: 'Obsidian / Markdown', status: 'done', finished: 63, total: 63, imported: 63, duplicates: 0, failed: 0 },
    { id: 'b3', source: '浏览器收藏', status: 'done', finished: 12, total: 12, imported: 10, duplicates: 0, failed: 2 },
  ]
  return (
    <ul className="mk-records">
      {batches.map((b) => (
        <li key={b.id} className="qx-card">
          <header>
            {b.status === 'processing' ? <ArrowClockwiseIcon className="mk-spin" /> : b.failed ? <WarningCircleIcon className="mk-danger" /> : <CheckCircleIcon />}
            <strong>{b.source}</strong>
            <span className="qx-meta">{b.finished} / {b.total}</span>
            <a className="qx-btn qx-btn--ghost" href="#/library?lib=inbox">
              打开资料库 <ArrowRightIcon />
            </a>
          </header>
          <div className="mk-progress">
            <span style={{ width: `${(b.finished / b.total) * 100}%` }} />
          </div>
          <p className="qx-meta">
            {b.imported} 条已入库 · {b.duplicates} 条重复{b.failed ? ` · ${b.failed} 条待重试` : ''}
          </p>
          <details open={!!b.failed}>
            <summary className="qx-meta">查看条目</summary>
            <ul className="mk-records__items">
              <li>
                <span>为什么城市需要第三空间<small>已入库</small></span>
              </li>
              {b.failed ? (
                <>
                  <li data-failed="true">
                    <span>县城的消费与面子<small>需要登录才能读取</small></span>
                    <button className="qx-btn qx-btn--ghost">重试</button>
                  </li>
                  <li data-failed="true">
                    <span>example.org/old-post<small>链接已失效</small></span>
                    <button className="qx-btn qx-btn--ghost">重试</button>
                  </li>
                </>
              ) : null}
            </ul>
          </details>
        </li>
      ))}
    </ul>
  )
}

/* 新建 / 编辑知识库：名称必填（100 字内），说明选填（1000 字内）。原来是页面里展开的表单。 */
function LibraryForm({ libId, onClose }: { libId?: string; onClose: () => void }) {
  const l = libId ? libraryById[libId] : null
  return (
    <Dialog title={l ? '编辑知识库' : '新建知识库'} onClose={onClose}>
      <form className="mk-form" onSubmit={(e) => { e.preventDefault(); onClose() }}>
        <label>
          知识库名称
          <input className="qx-input" required maxLength={100} defaultValue={l?.name} autoFocus />
        </label>
        <label>
          说明（选填）
          <textarea className="qx-input" maxLength={1000} rows={3} defaultValue={l?.description} placeholder="按工作、兴趣或研究主题归集资料" />
        </label>
        <footer>
          <button type="button" className="qx-btn qx-btn--ghost" onClick={onClose}>取消</button>
          <button className="qx-btn qx-btn--primary">{l ? '保存' : '创建'}</button>
        </footer>
      </form>
    </Dialog>
  )
}

/* 删除确认的文案照原样保留：它说清了什么会被删、什么会留下。 */
function RemoveLibrary({ libId, onClose }: { libId: string; onClose: () => void }) {
  return (
    <Dialog title={`删除「${libraryById[libId].name}」？`} onClose={onClose}>
      <div className="mk-form">
        <p className="qx-card__body">此知识库内的资料、整理结果与索引将被删除，无法恢复。已生成的对话和文稿会保留，需要时可分别删除。</p>
        <footer>
          <button className="qx-btn qx-btn--ghost" onClick={onClose}>取消</button>
          <button className="qx-btn qx-btn--danger" onClick={onClose}>删除</button>
        </footer>
      </div>
    </Dialog>
  )
}

function RemoveMaterial({ m, onClose }: { m: Material; onClose: () => void }) {
  return (
    <Dialog title="删除资料？" onClose={onClose}>
      <div className="mk-form">
        <p className="qx-card__body">删除「{m.title}」及其知识与索引？此操作无法撤销。</p>
        <footer>
          <button className="qx-btn qx-btn--ghost" onClick={onClose}>取消</button>
          <button className="qx-btn qx-btn--danger" onClick={onClose}>删除</button>
        </footer>
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
            <small>持有此链接并登录的人可加入，只能阅读。</small>
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
        <p className="qx-meta">关闭共享会撤销成员访问和旧邀请。</p>
      </div>
    </Dialog>
  )
}
