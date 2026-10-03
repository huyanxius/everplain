import { useCallback, useEffect, useState } from 'react'
import type { Editor } from '@tiptap/react'
import {
  CaretDownIcon,
  CaretRightIcon,
  ChatCircleIcon,
  FeatherIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  MagicWandIcon,
  MagnifyingGlassIcon,
  NotePencilIcon,
  PlusIcon,
  QuotesIcon,
  SidebarSimpleIcon,
  XIcon,
} from '@phosphor-icons/react'

import { AgentAvatar } from '../../modules/agent-avatar'
import { ResearchComposer } from '../shared/Composer'
import { SharedEditor, type Property, type SelectionAction } from './SharedEditor'

/*
 * 共享编辑器的展示页：同一个 SharedEditor 挂在三种宿主里，右下角切换。
 *   笔记     —— Obsidian 式：笔记库文件树 + 标签页，用户把 Obsidian 的库直接搬进来；
 *   写作     —— 文档按文体分组（公文 / 报告 / 随笔 / 小说），文风按文体分别学；
 *   研究文稿 —— 左侧是文稿章节。
 * 三种宿主只换左栏和选区动作；编辑器、右栏都是同一个：
 *   右栏 = 公共 Agent 面板（真实实现嵌 ResearchAgentConversationPage embedded，和研究工作区一样），
 *   旁边并列「大纲」「反链」两个标签，由宿主用编辑器实例算出来。
 */

type Host = 'notes' | 'writing' | 'research'
type Tab = 'agent' | 'outline' | 'backlinks'

const notesMd: Record<string, { props: Property[]; md: string }> = {
  第三空间: {
    props: [{ key: 'tags', value: '城市, 公共空间' }, { key: 'created', value: '2026-09-28' }, { key: 'source', value: 'aeon.co' }],
    md: `# 第三空间

奥尔登堡把家和单位之外、供人非正式聚集的地方叫作**第三空间**。它的核心不是装修，而是==常客==。参见 [[街道眼]] 和 [[乡土中国|差序格局]]。#城市 #读书笔记

## 八个特征

1. 中立地带，没有人是主人
2. 身份被拉平
3. 谈话是主要活动

> [!note] 和我的研究有关
> 访谈里受访者更多提到便利店门口和自习室，而不是咖啡馆。

## 待办

- [x] 读完第二章
- [ ] 把八个特征和 [[访谈提纲]] 对一遍
- [ ] 找三个中国城市的反例

## 对照

| 概念 | 提出者 | 关键词 |
| --- | --- | --- |
| 第三空间 | 奥尔登堡 | 常客 |
| 街道眼 | 雅各布斯 | 混合功能 |

> 我们每个人都需要三个地方。

\`\`\`text
第三空间 = 中立 + 常客 + 低成本照面
\`\`\`
`,
  },
  街道眼: { props: [{ key: 'tags', value: '城市' }], md: '# 街道眼\n\n雅各布斯认为，人行道上持续有人看着，是街道安全的来源。和 [[第三空间]] 讲的是同一件事在街道尺度上的版本。\n' },
  访谈提纲: { props: [{ key: 'tags', value: '研究方法' }], md: '# 访谈提纲\n\n- 先问日常动线\n- 再问"你上一次和陌生人聊天是在哪里"\n- 最后留十分钟给对方补充\n\n相关：[[第三空间]]\n' },
}

const vault = [
  { folder: '读书笔记', notes: ['第三空间', '街道眼', '乡土中国'] },
  { folder: '研究', notes: ['访谈提纲', '开题报告'] },
  { folder: '日记', notes: ['2026-10-03'] },
]
const allNotes = vault.flatMap((f) => f.notes)

const writingDocs = [
  { genre: '公文', docs: ['关于开展读书月活动的通知'] },
  { genre: '报告', docs: ['城市第三空间调研报告'] },
  { genre: '随笔', docs: ['便利店与第三空间'] },
  { genre: '小说', docs: ['第三个冬天 · 第一章'] },
]

const researchSections = ['研究问题', '文献综述', '理论框架', '研究方法', '预期发现']

export function EditorPage() {
  const [host, setHost] = useState<Host>('notes')
  const [tab, setTab] = useState<Tab>('agent')
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [open, setOpen] = useState<string[]>(['第三空间', '街道眼'])
  const [current, setCurrent] = useState('第三空间')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [outline, setOutline] = useState<{ level: number; text: string; pos: number }[]>([])
  const [messages, setMessages] = useState<{ role: 'user' | 'agent'; text: string }[]>([
    { role: 'user', text: '这篇笔记和我研究的关系是什么？' },
    { role: 'agent', text: '你的访谈里，受访者很少提到咖啡馆，更多是便利店和自习室。这篇讲的"常客"正好可以拿来解释这种差别，我在提示块里已经标出来了。' },
  ])

  const openNote = (n: string) => {
    if (!notesMd[n]) return
    setOpen((o) => (o.includes(n) ? o : [...o, n]))
    setCurrent(n)
  }
  const closeTab = (n: string) => {
    const next = open.filter((x) => x !== n)
    setOpen(next)
    if (n === current && next.length) setCurrent(next[next.length - 1])
  }

  /* 大纲：宿主从编辑器实例里读标题 */
  const onReady = useCallback((ed: Editor) => setEditor(ed), [])
  useEffect(() => {
    if (!editor) return
    const read = () => {
      const out: { level: number; text: string; pos: number }[] = []
      editor.state.doc.descendants((node, pos) => { if (node.type.name === 'heading') out.push({ level: node.attrs.level, text: node.textContent, pos }) })
      setOutline(out)
    }
    read()
    editor.on('update', read)
    return () => { editor.off('update', read) }
  }, [editor])
  const jump = (pos: number) => {
    if (!editor) return
    editor.chain().focus().setTextSelection(pos + 1).run()
    ;(editor.view.nodeDOM(pos) as HTMLElement | null)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const backlinks = Object.entries(notesMd).filter(([name, n]) => name !== current && n.md.includes(`[[${current}`)).map(([name, n]) => {
    const line = n.md.split('\n').find((l) => l.includes(`[[${current}`)) ?? ''
    return { name, line: line.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, (_m, a, b) => (b ? b.slice(1) : a)) }
  })

  const selectionActions: SelectionAction[] = host === 'writing'
    ? [
        { id: 'rewrite', label: '改写', icon: <MagicWandIcon />, run: (_e, t) => ask(`把这句改写一下：「${t}」`) },
        { id: 'mine', label: '更像我', icon: <FeatherIcon />, run: (_e, t) => ask(`按我的文风改：「${t}」`) },
      ]
    : host === 'research'
      ? [
          { id: 'discuss', label: '讨论', icon: <ChatCircleIcon />, run: (_e, t) => ask(`讨论这段：「${t}」`) },
          { id: 'cite', label: '找依据', icon: <QuotesIcon />, run: (_e, t) => ask(`给这句找资料依据：「${t}」`) },
        ]
      : [{ id: 'ask', label: '问 Agent', icon: <ChatCircleIcon />, run: (_e, t) => ask(`关于「${t}」`) }]

  const ask = (text: string) => {
    setTab('agent')
    setMessages((m) => [...m, { role: 'user', text }])
    window.setTimeout(() => setMessages((m) => [...m, { role: 'agent', text: '好的。我先读一下这篇笔记和它链接到的两篇，再回答你。' }]), 600)
  }

  const doc = notesMd[current] ?? notesMd['第三空间']

  return (
    <div className="ep" data-left={leftOpen} data-right={rightOpen}>
      <aside className="ep-shellgap" aria-label="应用侧栏位置说明">
        <strong>应用侧栏</strong>
        <p>全局导航由应用外壳提供，本页常驻在它右侧，这里只占位。</p>
        <p className="qx-group-label ep-shellgap__label">预览：同一个编辑器在不同页面</p>
        {([['notes', '笔记'], ['writing', '写作'], ['research', '研究文稿']] as const).map(([id, label]) => (
          <button key={id} type="button" className="qx-item" aria-current={host === id ? 'true' : undefined} onClick={() => { setHost(id); if (id !== 'notes') setCurrent('第三空间') }}>{label}</button>
        ))}
      </aside>

      <nav className="ep-left" aria-label={host === 'notes' ? '笔记库' : host === 'writing' ? '文档' : '章节'}>
        {host === 'notes' ? <Vault current={current} onOpen={openNote} /> : null}
        {host === 'writing' ? <Docs /> : null}
        {host === 'research' ? <Sections /> : null}
      </nav>

      <main className="ep-main">
        {host === 'notes' ? (
          <div className="ep-tabs" role="tablist">
            <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon ep-toggle" aria-label={leftOpen ? '收起左栏' : '展开左栏'} aria-pressed={!leftOpen} onClick={() => setLeftOpen(!leftOpen)}><SidebarSimpleIcon /></button>
            {open.map((n) => (
              <div key={n} className="ep-tab" role="tab" aria-selected={n === current} onClick={() => setCurrent(n)}>
                <FileTextIcon /><span>{n}</span>
                <button type="button" aria-label={`关闭 ${n}`} onClick={(e) => { e.stopPropagation(); closeTab(n) }}><XIcon /></button>
              </div>
            ))}
            <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon ep-tab__new" aria-label="新建笔记"><PlusIcon /></button>
            <span className="ep-spacer" />
            <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon ep-toggle ep-toggle--right" aria-label={rightOpen ? '收起右栏' : '展开右栏'} aria-pressed={!rightOpen} onClick={() => setRightOpen(!rightOpen)}><SidebarSimpleIcon /></button>
          </div>
        ) : (
          <div className="ep-crumb"><button type="button" className="qx-btn qx-btn--ghost qx-btn--icon ep-toggle" aria-label={leftOpen ? '收起左栏' : '展开左栏'} aria-pressed={!leftOpen} onClick={() => setLeftOpen(!leftOpen)}><SidebarSimpleIcon /></button><span>{host === 'writing' ? '写作 / 随笔 / 便利店与第三空间' : '研究 / 城市第三空间 / 研究问题'}</span><span className="ep-spacer" /><button type="button" className="qx-btn qx-btn--ghost qx-btn--icon ep-toggle ep-toggle--right" aria-label={rightOpen ? '收起右栏' : '展开右栏'} aria-pressed={!rightOpen} onClick={() => setRightOpen(!rightOpen)}><SidebarSimpleIcon /></button></div>
        )}
        <SharedEditor
          key={host + current}
          markdown={doc.md}
          properties={doc.props}
          notes={allNotes}
          selectionActions={selectionActions}
          onOpenLink={openNote}
          onReady={onReady}
        />
      </main>

      <aside className="ep-right">
        <div className="ep-righttabs"><div className="qx-segmented" role="tablist">
          {([['agent', 'Agent'], ['outline', '大纲'], ['backlinks', '反链']] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
              {label}{id === 'backlinks' && backlinks.length ? <span>{backlinks.length}</span> : null}
            </button>
          ))}
        </div></div>
        {tab === 'agent' ? (
          <div className="ep-agent">
            <div className="ep-agent__log">
              {messages.map((m, i) => m.role === 'user'
                ? <div key={i} className="ep-msg ep-msg--user">{m.text}</div>
                : <div key={i} className="ep-msg ep-msg--agent"><AgentAvatar avatar="cheng" color="#5d8fe6" size={24} playing={false} /><p>{m.text}</p></div>)}
            </div>
            <div className="ep-agent__compose">
              <ResearchComposer tray={false} initialFiles={[{ name: `${current}.md`, status: '当前笔记' }]} placeholder="问这篇笔记，或让它改" onSend={ask} />
            </div>
          </div>
        ) : null}
        {tab === 'outline' ? (
          <div className="ep-outline">
            {outline.length ? outline.map((h, i) => (
              <button key={i} type="button" className="qx-item ep-outline__item" style={{ paddingLeft: 12 + (h.level - 1) * 14 }} onClick={() => jump(h.pos)}>{h.text || '（无标题）'}</button>
            )) : <p className="ep-empty">这篇还没有标题</p>}
          </div>
        ) : null}
        {tab === 'backlinks' ? (
          <div className="ep-backlinks">
            <p className="ep-backlinks__head">{backlinks.length} 篇笔记链接到「{current}」</p>
            {backlinks.map((b) => (
              <button key={b.name} type="button" className="ep-backlink" onClick={() => openNote(b.name)}>
                <strong><FileTextIcon /> {b.name}</strong>
                <span>{b.line}</span>
              </button>
            ))}
          </div>
        ) : null}
      </aside>

    </div>
  )
}

function Vault({ current, onOpen }: { current: string; onOpen: (n: string) => void }) {
  const [closed, setClosed] = useState<string[]>(['日记'])
  const [q, setQ] = useState('')
  return (
    <>
      <div className="ep-left__head">
        <strong>我的笔记库</strong>
        <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="新建笔记"><NotePencilIcon /></button>
        <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="新建文件夹"><FolderIcon /></button>
      </div>
      <label className="qx-search ep-search"><MagnifyingGlassIcon /><input placeholder="搜索笔记" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      <div className="ep-tree">
        {vault.map((f) => {
          const isOpen = !closed.includes(f.folder) || !!q
          const list = f.notes.filter((n) => !q || n.includes(q))
          if (q && !list.length) return null
          return (
            <div key={f.folder}>
              <button type="button" className="qx-item ep-tree__folder" onClick={() => setClosed(isOpen ? [...closed, f.folder] : closed.filter((x) => x !== f.folder))}>
                {isOpen ? <CaretDownIcon /> : <CaretRightIcon />}{isOpen ? <FolderOpenIcon /> : <FolderIcon />}<span>{f.folder}</span><small>{f.notes.length}</small>
              </button>
              {isOpen ? list.map((n) => (
                <button key={n} type="button" className="qx-item ep-tree__note" aria-current={n === current ? 'true' : undefined} onClick={() => onOpen(n)}>
                  <FileTextIcon /><span>{n}</span>
                </button>
              )) : null}
            </div>
          )
        })}
      </div>
      <p className="ep-left__foot">从 Obsidian 导入：选择库文件夹，保留目录、双链与属性</p>
    </>
  )
}

/* 写作：按文体分组。每种文体各学一套文风（公文学公文的写法，小说学小说的），不混在一起。 */
function Docs() {
  return (
    <>
      <div className="ep-left__head"><strong>写作</strong><button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="新建文档"><NotePencilIcon /></button></div>
      <div className="ep-tree">
        {writingDocs.map((g) => (
          <div key={g.genre}>
            <p className="ep-tree__group">{g.genre}<small>文风已学 {g.genre === '小说' ? '3' : g.genre === '公文' ? '8' : '12'} 篇</small></p>
            {g.docs.map((d) => (
              <button key={d} type="button" className="qx-item ep-tree__note" aria-current={d === '便利店与第三空间' ? 'true' : undefined}><FileTextIcon /><span>{d}</span></button>
            ))}
          </div>
        ))}
      </div>
    </>
  )
}

function Sections() {
  return (
    <>
      <div className="ep-left__head"><strong>城市第三空间</strong></div>
      <div className="ep-tree">
        {researchSections.map((s, i) => (
          <button key={s} type="button" className="qx-item ep-tree__note" aria-current={i === 0 ? 'true' : undefined}><span className="ep-tree__num">{i + 1}</span><span>{s}</span></button>
        ))}
      </div>
    </>
  )
}
