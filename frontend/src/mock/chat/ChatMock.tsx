import { useState } from 'react'
import {
  ArrowClockwiseIcon,
  ArrowUpIcon,
  BooksIcon,
  CaretDownIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  GlobeHemisphereWestIcon,
  PlusIcon,
  StopIcon,
  XIcon,
} from '@phosphor-icons/react'

import { AgentAvatar } from '../../modules/agent-avatar'

/*
 * 两个输入框的视觉参照，只看样子。功能以 conversation-view/ConversationComposer 和
 * ResearchAgentConversationPage 为准，这里只决定控件放在哪。
 *   简单版：/agent 普通对话。
 *   详细版：研究界面（新建研究工作区里的 Agent 栏，以及 /agent 的研究模式）。
 * 共同的骨架：上方是本轮附件，中间是输入，底栏左边是"这条消息怎么答"，右边是模型和发送。
 */
export function ChatMock() {
  return (
    <main className="ch-page">
      <section className="ch-block">
        <h2 className="ch-block__title">Agent 页面</h2>
        <ModeSwitch initial="standard" />
        <SimpleComposer />
      </section>
      <section className="ch-block">
        <h2 className="ch-block__title">研究界面</h2>
        <ModeSwitch initial="deep-research" />
        <ResearchComposer />
      </section>
    </main>
  )
}

/*
 * 简单版：附件 + 输入 + 模型 + 发送。知识来源和联网也放在底栏，现在它们藏在顶栏「⋯」里，
 * 用户发消息时看不见它会不会查资料、会不会上网。
 */
function SimpleComposer() {
  const [text, setText] = useState('')
  const [web, setWeb] = useState(false)
  return (
    <form className="ch-composer" onSubmit={(e) => e.preventDefault()}>
      <textarea rows={1} aria-label="问 Everplain" placeholder="问一个问题" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="ch-bar">
        <PlusMenu />
        <button type="button" className="qx-btn qx-btn--ghost ch-chip"><BooksIcon /> 不使用知识库 <CaretDownIcon /></button>
        <button type="button" className="qx-btn qx-btn--ghost ch-chip" aria-pressed={web} onClick={() => setWeb(!web)}><GlobeHemisphereWestIcon /> 联网</button>
        <span className="ch-spacer" />
        <ModelChip />
        <button type="submit" className="qx-btn qx-btn--primary qx-btn--icon" aria-label="发送给 Everplain" disabled={!text.trim()}><ArrowUpIcon /></button>
      </div>
    </form>
  )
}

/*
 * 详细版，从上到下：
 *   正在讨论（研究地图里选中的节点，可继续研究或结束）；
 *   材料来源（从材料开始研究时的导入状态，失败可重试）；
 *   本轮附件（带解析状态：已添加 / 等待解析 / 解析失败 / 需要 OCR / 未配置转写 / 等待转写 / 处理中）；
 *   输入；
 *   底栏：附件、知识来源、联网 ｜ 所属项目、材料库 ｜ 模型、发送（生成中变停止）；
 *   框外下方：问题示例，一次四条，可换一组。
 */
function ResearchComposer() {
  const [busy, setBusy] = useState(false)
  const [web, setWeb] = useState(true)
  const [page, setPage] = useState(0)
  const examples = [
    ['从这些访谈中整理用户需求', '这份报告的结论有哪些依据', '分析材料中相互矛盾的观点', '找出这组材料中的证据缺口'],
    ['把阅读笔记整理成知识框架', '围绕这个问题继续查找资料', '将研究发现组织成报告提纲', '沿着上次的研究继续推进'],
  ]
  return (
    <div className="ch-research">
      <div className="ch-discussion" role="status">
        <span>正在讨论：<strong>第三空间的定义</strong></span>
        <button type="button" className="qx-btn qx-btn--ghost">继续研究</button>
        <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="结束当前讨论"><XIcon /></button>
      </div>

      <form className="ch-composer ch-composer--research" onSubmit={(e) => { e.preventDefault(); setBusy(!busy) }}>
        <div className="ch-extras">
          <div className="ch-import" role="status" aria-label="材料来源">
            <FileTextIcon /> 材料来源 <strong>访谈记录-B.docx</strong> <small>另 3 份</small>
            <span className="ch-import__state">导入失败</span>
            <button type="button" className="qx-btn qx-btn--ghost ch-chip"><ArrowClockwiseIcon /> 重试导入</button>
          </div>
          <div className="ch-attachments" aria-label="本轮附件">
            <Attachment title="访谈记录-B.docx" status="已添加" />
            <Attachment title="田野笔记.pdf" status="等待解析" />
            <Attachment title="街角照片.png" status="需要 OCR" />
          </div>
        </div>
        <textarea rows={2} aria-label="和 Agent 讨论你的研究" placeholder="描述你想弄清楚的问题" />
        <div className="ch-bar">
          <PlusMenu />
          <button type="button" className="qx-btn qx-btn--ghost ch-chip"><BooksIcon /> 毕业论文 <CaretDownIcon /></button>
          <button type="button" className="qx-btn qx-btn--ghost ch-chip" aria-pressed={web} onClick={() => setWeb(!web)}><GlobeHemisphereWestIcon /> 联网</button>
          <span className="ch-sep" />
          <button type="button" className="qx-btn qx-btn--ghost ch-chip" aria-label="对话所属项目"><FolderIcon /> 城市第三空间 <CaretDownIcon /></button>
          <button type="button" className="qx-btn qx-btn--ghost ch-chip"><FolderOpenIcon /> 材料库</button>
          <span className="ch-spacer" />
          <ModelChip />
          {busy ? (
            <button type="button" className="qx-btn qx-btn--primary qx-btn--icon" aria-label="停止生成" onClick={() => setBusy(false)}><StopIcon weight="fill" /></button>
          ) : (
            <button type="submit" className="qx-btn qx-btn--primary qx-btn--icon" aria-label="发送给 Everplain"><ArrowUpIcon /></button>
          )}
        </div>
      </form>

      <div className="ch-examples" aria-label="问题示例">
        {examples[page].map((e) => <button key={e} type="button" className="qx-btn qx-btn--ghost ch-example">{e}</button>)}
        <button type="button" className="qx-btn qx-btn--ghost ch-example ch-example--more" onClick={() => setPage((page + 1) % examples.length)}>换一组</button>
      </div>
    </div>
  )
}

function Attachment({ title, status }: { title: string; status: string }) {
  return (
    <span className="qx-tag ch-attachment">
      <FileTextIcon /> <span className="ch-attachment__name">{title}</span> <span className="qx-meta">{status}</span>
      <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" aria-label={`移除附件 ${title}`}><XIcon /></button>
    </span>
  )
}

/* 「+」：上传文件 / 从研究材料添加，两项都保留。 */
function PlusMenu() {
  const [open, setOpen] = useState(false)
  return (
    <div className="ch-anchor">
      <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="添加附件" aria-expanded={open} onClick={() => setOpen(!open)}><PlusIcon /></button>
      {open ? (
        <div className="qx-menu ch-menu" role="menu">
          <button type="button" className="qx-item" role="menuitem" onClick={() => setOpen(false)}><FilePlusIcon /> 上传文件</button>
          <button type="button" className="qx-item" role="menuitem" onClick={() => setOpen(false)}><FolderOpenIcon /> 从研究材料添加</button>
        </div>
      ) : null}
    </div>
  )
}

function ModelChip() {
  return <button type="button" className="qx-btn qx-btn--ghost ch-chip" aria-label="模型与思考强度：GPT 6 Luna · 中">GPT 6 Luna · 中 <CaretDownIcon /></button>
}

/* 模式栏照现有 AgentModeSwitch：左边是 Agent 头像（Chat），右边是「研究」。不改成文字。 */
function ModeSwitch({ initial }: { initial: 'standard' | 'deep-research' }) {
  const [mode, setMode] = useState(initial)
  return (
    <div className="qx-segmented ch-modes" role="tablist" aria-label="Chat / Research">
      <button type="button" role="tab" aria-label="Chat" aria-selected={mode === 'standard'} onClick={() => setMode('standard')}>
        <AgentAvatar avatar="cheng" color="#5d8fe6" size={24} playing={false} />
      </button>
      <button type="button" role="tab" aria-label="Research" aria-selected={mode === 'deep-research'} onClick={() => setMode('deep-research')}>研究</button>
    </div>
  )
}
