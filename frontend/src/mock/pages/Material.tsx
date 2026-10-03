import { useEffect, useState } from 'react'
import {
  ArrowLeftIcon,
  ChatCircleIcon,
  CopyIcon,
  FileTextIcon,
  InfoIcon,
  ListBulletsIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  PlusIcon,
  XIcon,
} from '@phosphor-icons/react'

import { AgentAvatar } from '../../modules/agent-avatar'
import { libraryById, materialById, materials } from '../data'
import { go, useAgent } from '../state'
import { Composer } from '../ui'

/*
 * 资料阅读页，对应真实的 ReadOnlyMaterialReader。原页面的功能逐条保留：
 *   顶栏：返回所在库、切换同库资料、结合本库提问、章节、原文查找（⌘⇧F）、收起/展开侧栏；
 *   正文：原文 · 库 · 大小 · 段数、缩放 90–125%、摘要、解析警告、逐段带定位、每页 24 段分页；
 *   右栏：结合本库提问（嵌入对话，引用点了跳到原文段落）、知识点（每条带「原文 n」）、
 *         编辑知识（摘要 / 知识点 / 关系，每项绑定原文段落）、知识关系、原文依据 + 复制原文与定位。
 * 和原来的差别只有一处：「结合本库提问」从默认收起改成右栏的一个标签，打开就能看到。
 */
const segments = [
  { id: 's1', loc: '第 1 段', kind: 'heading', text: '我们为什么需要第三个地方' },
  { id: 's2', loc: '第 2 段', kind: 'p', text: '我们每个人都需要三个地方。第一个是家，第二个是工作的地方，第三个是那些让我们在家和工作之外，能够自在地和别人待在一起的地方——咖啡馆、书店、街角的小酒馆、理发店。' },
  { id: 's3', loc: '第 3 段', kind: 'p', text: '这些地方有几个共同点。它们是中立的：没有人是主人，也没有人是客人，你可以随时来随时走。它们让身份变得不重要：在这里，经理和学生坐在同一张桌子前。' },
  { id: 's4', loc: '第 4 段', kind: 'heading', text: '常客' },
  { id: 's5', loc: '第 5 段', kind: 'p', text: '最重要的是常客。一个第三空间之所以成立，不是因为它的装修或者咖啡，而是因为每次去都能遇见几张熟悉的脸。新来的人正是通过这些常客，才慢慢变成这里的一部分。' },
  { id: 's6', loc: '第 6 段', kind: 'p', text: '城市规划的变化让这类空间越来越少。郊区化把人分散到彼此隔绝的住宅里，连锁店则把"停留"设计成了"消费之后离开"。' },
]

export function MaterialPage({ id }: { id: string }) {
  const m = materialById[id] ?? materialById.m1
  const { agent } = useAgent()
  const seg = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('seg')
  const [selected, setSelected] = useState<string | null>(seg ? `s${seg}` : null)
  const [rail, setRail] = useState(true)
  const [tab, setTab] = useState<'knowledge' | 'ask'>('knowledge')
  const [outline, setOutline] = useState(false)
  const [finding, setFinding] = useState(false)
  const [find, setFind] = useState('')
  const [zoom, setZoom] = useState(100)
  const [editing, setEditing] = useState(false)
  const [copied, setCopied] = useState(false)
  const sameLib = materials.filter((x) => x.libraryId === m.libraryId && x.state !== 'parsing' && x.state !== 'failed-parse')
  const visible = segments.filter((s) => !find || s.text.includes(find))
  const picked = segments.find((s) => s.id === selected)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); setFinding((v) => !v) }
      if (e.key === 'Escape') { setFinding(false); setFind('') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const pick = (sid: string) => { setSelected(sid); setRail(true); setCopied(false) }

  return (
    <div className="mk-page mk-material">
      <div className="mk-material__bar">
        <div className="mk-material__nav">
          <a className="qx-btn qx-btn--ghost" href={`#/library?lib=${m.libraryId}`}>
            <ArrowLeftIcon /> {libraryById[m.libraryId].name}
          </a>
          <select className="qx-input mk-select" aria-label="切换资料" value={m.id} onChange={(e) => go(`/library/${e.target.value}`)}>
            {sameLib.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
          </select>
        </div>
        <div className="mk-material__actions">
          <button className="qx-btn qx-btn--secondary" aria-pressed={rail && tab === 'ask'} onClick={() => { setTab('ask'); setRail(true) }}>
            <ChatCircleIcon /> 结合本库提问
          </button>
          <button className="qx-btn qx-btn--ghost qx-btn--icon" aria-label={outline ? '收起章节' : '展开章节'} aria-pressed={outline} onClick={() => setOutline(!outline)}><ListBulletsIcon /></button>
          <button className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="在材料中查找" title="查找（⌘⇧F）" aria-pressed={finding} onClick={() => setFinding(!finding)}><MagnifyingGlassIcon /></button>
          <button className="qx-btn qx-btn--ghost qx-btn--icon" aria-label={rail ? '收起侧栏' : '展开侧栏'} aria-pressed={rail} onClick={() => setRail(!rail)}><InfoIcon /></button>
        </div>
      </div>

      <div className="mk-material__layout" data-rail={rail}>
        <article className="mk-reader">
          <div className="mk-reader__meta">
            <span className="qx-tag"><FileTextIcon /> 原文</span>
            <span className="qx-meta">{libraryById[m.libraryId].name} · {m.size} · {segments.length} 段{m.host ? ` · ${m.host}` : ''}</span>
            <label className="mk-reader__zoom qx-meta">
              缩放
              <select className="qx-input" value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
                {[90, 100, 110, 125].map((z) => <option key={z} value={z}>{z}%</option>)}
              </select>
            </label>
          </div>
          <h1 className="mk-reader__title">{m.title}</h1>
          <p className="mk-reader__summary">{m.summary}</p>
          {outline ? (
            <nav className="mk-reader__outline" aria-label="材料导航">
              <h2 className="qx-heading">章节</h2>
              {segments.filter((s) => s.kind === 'heading').map((s) => (
                <button key={s.id} className="qx-item" aria-current={selected === s.id ? 'location' : undefined} onClick={() => pick(s.id)}>{s.text}</button>
              ))}
            </nav>
          ) : null}
          {finding ? (
            <div className="mk-reader__find">
              <label className="qx-search">
                <MagnifyingGlassIcon />
                <input autoFocus type="search" aria-label="搜索原文" placeholder="在原文中查找" value={find} onChange={(e) => setFind(e.target.value)} />
              </label>
              <span className="qx-meta">{visible.length} / {segments.length} 段</span>
              <button className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="关闭查找" onClick={() => { setFinding(false); setFind('') }}><XIcon /></button>
            </div>
          ) : null}
          {m.kind === 'PDF' ? <p className="qx-notice">第 12–14 页是扫描图片，未能提取文字。</p> : null}
          <div className="qx-prose mk-reader__prose" style={{ fontSize: `${zoom}%` }}>
            {visible.map((s) => (
              <section key={s.id} className="mk-seg" data-selected={selected === s.id}>
                <button className="mk-seg__loc" aria-label={`定位原文 ${s.loc}`} onClick={() => pick(s.id)}>{s.loc}</button>
                {s.kind === 'heading' ? <h2 onClick={() => pick(s.id)}>{s.text}</h2> : <p onClick={() => pick(s.id)}>{s.text}</p>}
              </section>
            ))}
            {!visible.length ? <p className="qx-meta">没有找到相关原文，换个关键词试试。</p> : null}
          </div>
          <nav className="mk-reader__pages" aria-label="原文分页">
            <button className="qx-btn qx-btn--secondary" disabled>上一页</button>
            <span className="qx-meta">第 1 / 3 页</span>
            <button className="qx-btn qx-btn--secondary">下一页</button>
          </nav>
        </article>

        {rail ? (
          <aside className="mk-rail" aria-label="资料侧栏">
            <div className="qx-segmented mk-rail__tabs" role="tablist">
              <button role="tab" aria-selected={tab === 'knowledge'} onClick={() => setTab('knowledge')}>知识点</button>
              <button role="tab" aria-selected={tab === 'ask'} onClick={() => setTab('ask')}>结合本库提问</button>
            </div>

            {picked ? (
              <section className="qx-card mk-rail__block" aria-label="原文依据">
                <header className="mk-rail__head">
                  <h2 className="qx-heading">原文依据</h2>
                  <button className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="关闭原文依据" onClick={() => setSelected(null)}><XIcon /></button>
                </header>
                <span className="qx-meta">{picked.loc}</span>
                <blockquote className="mk-quote"><p>{picked.text}</p></blockquote>
                <button className="qx-btn qx-btn--secondary" onClick={() => setCopied(true)}>
                  <CopyIcon /> {copied ? '已复制' : '复制原文与定位'}
                </button>
              </section>
            ) : null}

            {tab === 'ask' ? (
              <section className="qx-card mk-rail__block mk-rail__ask">
                <p className="qx-meta">在「{libraryById[m.libraryId].name}」里回答，引用会跳到原文段落。</p>
                <div className="mk-turn">
                  <AgentAvatar avatar={agent.avatar} color={agent.color} size={28} />
                  <div className="qx-prose mk-ws__agent-text">
                    <p>
                      这篇把常客当作第三空间成立的关键
                      <button className="qx-cite" onClick={() => pick('s5')}>1</button>
                      ，和你库里《街道眼》讲的"持续有人看着"是同一个机制
                      <button className="qx-cite" onClick={() => go('/library/m5?seg=2')}>2</button>。
                    </p>
                  </div>
                </div>
                <Composer placeholder="结合本库资料提问" />
              </section>
            ) : editing ? (
              <KnowledgeEditor points={m.points} onDone={() => setEditing(false)} />
            ) : (
              <>
                <section className="qx-card mk-rail__block">
                  <header className="mk-rail__head">
                    <h2 className="qx-heading">知识点</h2>
                    {m.state !== 'organizing' ? (
                      <button className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="编辑知识" onClick={() => setEditing(true)}><PencilSimpleIcon /></button>
                    ) : null}
                  </header>
                  {m.state === 'organizing' ? (
                    <p className="qx-meta">正在整理知识点，完成后会显示在这里。</p>
                  ) : m.state === 'failed-knowledge' ? (
                    <p className="qx-meta">知识整理暂未完成，可在资料卡片上重试。</p>
                  ) : (
                    <ul className="mk-points">
                      {m.points.map((p, i) => (
                        <li key={p}>
                          <button className="qx-item" onClick={() => pick(segments[(i % 4) + 1].id)}>{p}</button>
                          <p className="qx-meta">原文里对"{p}"的概括，一两句话。</p>
                          <div className="mk-points__cites">
                            <button className="qx-tag qx-tag--outline" onClick={() => pick(segments[(i % 4) + 1].id)}>原文 1</button>
                            {i === 0 ? <button className="qx-tag qx-tag--outline" onClick={() => pick('s5')}>原文 2</button> : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                {m.points.length > 1 && m.state !== 'organizing' ? (
                  <section className="qx-card mk-rail__block">
                    <h2 className="qx-heading">知识关系</h2>
                    <article className="mk-relation">
                      <strong>{m.points[0]} → {m.points[1]}</strong>
                      <p className="qx-meta">支撑</p>
                      <button className="qx-tag qx-tag--outline" onClick={() => pick('s3')}>原文 1</button>
                    </article>
                  </section>
                ) : null}
              </>
            )}
          </aside>
        ) : null}
      </div>
    </div>
  )
}

/* 编辑知识：摘要、知识点（名称 / 说明 / 原文段落）、关系（起点 / 终点 / 说明 / 原文段落）。改的是整理结果，原文不动。 */
function KnowledgeEditor({ points, onDone }: { points: readonly string[]; onDone: () => void }) {
  const [list, setList] = useState([...points])
  return (
    <form className="qx-card mk-rail__block mk-kedit" onSubmit={(e) => { e.preventDefault(); onDone() }}>
      <p className="qx-meta">修改整理结果，保留每个知识点与关系的原文依据。</p>
      <label>资料摘要<textarea className="qx-input" rows={3} defaultValue="奥尔登堡把家和单位之外的公共场所称为第三空间。" /></label>
      <header className="mk-rail__head">
        <h3 className="qx-heading">知识点</h3>
        <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="添加知识点" onClick={() => setList([...list, ''])}><PlusIcon /></button>
      </header>
      {list.map((p, i) => (
        <fieldset key={i} className="mk-kedit__item">
          <legend className="qx-meta">知识点 {i + 1}</legend>
          <input className="qx-input" required maxLength={100} defaultValue={p} placeholder="名称" />
          <input className="qx-input" defaultValue="" placeholder="说明" />
          <select className="qx-input" aria-label="原文依据" defaultValue="s2">
            {segments.map((s) => <option key={s.id} value={s.id}>{s.loc} · {s.text.slice(0, 14)}</option>)}
          </select>
        </fieldset>
      ))}
      <header className="mk-rail__head">
        <h3 className="qx-heading">关系</h3>
        <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="添加关系" disabled={list.length < 2}><PlusIcon /></button>
      </header>
      <fieldset className="mk-kedit__item">
        <legend className="qx-meta">关系 1</legend>
        <div className="mk-kedit__ends">
          <select className="qx-input" aria-label="起点" defaultValue={list[0]}>{list.map((p) => <option key={p}>{p}</option>)}</select>
          <select className="qx-input" aria-label="终点" defaultValue={list[1]}>{list.map((p) => <option key={p}>{p}</option>)}</select>
        </div>
        <input className="qx-input" defaultValue="支撑" placeholder="关系说明" />
      </fieldset>
      <footer>
        <button className="qx-btn qx-btn--primary">保存知识</button>
        <button type="button" className="qx-btn qx-btn--ghost" onClick={onDone}>取消</button>
      </footer>
    </form>
  )
}
