import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConversationThread } from './ConversationThread'
import { ConversationSourcePanel } from './ConversationSourcePanel'
import { ConversationResearchFlow } from './ConversationResearchFlow'
import type { ConversationToolStep, ConversationTurnView } from './types'
import type { AgentCitation } from '../../modules/research-agent'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const citation: AgentCitation = {
  citation_id: 'web:https://example.invalid/qa-source-36', label: '网页资料', kind: 'source',
  source_kind: 'web', source_id: 'https://example.invalid/qa-source-36', excerpt: '真实来源片段。',
}
const step: ConversationToolStep = {
  id: 'step-1', tool: 'search_web', label: '搜索网页', status: 'completed',
  purpose: '核对来源。', input: { query: '第三空间' }, output: { count: 1 }, detail: '完整返回正文。',
  resultItems: [{ id: 'result-1', title: '研究资料', excerpt: '工具返回片段。' }],
}
const turn: ConversationTurnView = {
  id: 'turn-old', question: '哪些材料支持这一观点？', answer: '结论【web:https://example.invalid/qa-source-36】。',
  citations: [citation], knowledgeReleaseId: 'release-old',
}

describe('ConversationThread', () => {
  it('renders the mock-style content with no legacy layout dependency and returns turn-scoped citation context', () => {
    const select = vi.fn()
    const { container } = render(<ConversationThread turns={[turn]} agent={{ name: '澄', avatar: 'cheng' }} onSelectCitation={select} />)
    expect(container.querySelector('.cv-thread')).toBeInTheDocument()
    expect(container.querySelector('.cv-turn__question .qx-bubble')).toHaveTextContent(turn.question)
    expect(container.querySelector('.cv-turn__answer .cv-turn__avatar svg')).toHaveAttribute('data-avatar', 'cheng')
    expect(container.querySelector('.research-agent-conversation, .new-research__transcript')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '查看来源 1：网页资料' }))
    expect(select).toHaveBeenLastCalledWith(citation, 'release-old', 'turn-old')
    fireEvent.click(screen.getByRole('button', { name: '查看证据：网页资料' }))
    expect(select).toHaveBeenLastCalledWith(citation, 'release-old', 'turn-old')
    expect(screen.getByRole('status', { name: '本轮证据来源' })).toHaveTextContent('公开网页 1')
    expect(screen.queryByRole('button', { name: '复制回答' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '存为笔记' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '放进研究' })).not.toBeInTheDocument()
  })

  it('uses only supplied action handlers and passes sanitized text to copy', async () => {
    const copy = vi.fn(async () => {})
    const regenerate = vi.fn(), note = vi.fn(), research = vi.fn()
    render(<ConversationThread turns={[{ ...turn, onCopy: copy, onRegenerate: regenerate, onSaveNote: note, onContinueResearch: research }]} onSelectCitation={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '复制回答' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '已复制' })).toBeVisible())
    expect(copy).toHaveBeenCalledWith('结论。')
    fireEvent.click(screen.getByRole('button', { name: '重新生成' }))
    fireEvent.click(screen.getByRole('button', { name: '存为笔记' }))
    fireEvent.click(screen.getByRole('button', { name: '放进研究' }))
    expect(regenerate).toHaveBeenCalledOnce(); expect(note).toHaveBeenCalledOnce(); expect(research).toHaveBeenCalledOnce()
  })

  it('reports real copy failure and suppresses mutation controls during streaming', async () => {
    const copy = vi.fn(async () => { throw new Error('clipboard denied') })
    const { rerender } = render(<ConversationThread turns={[{ ...turn, onCopy: copy }]} onSelectCitation={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '复制回答' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '复制失败' })).toBeVisible())
    rerender(<ConversationThread turns={[{ ...turn, streaming: true, statusText: '正在核对证据', onCopy: copy, onRegenerate: vi.fn() }]} onSelectCitation={vi.fn()} />)
    expect(screen.queryByRole('status', { name: '正在核对证据' })).not.toBeInTheDocument() // First answer has already arrived.
    expect(screen.getByRole('button', { name: '查看来源 1：网页资料' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '重新生成' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '复制失败' })).not.toBeInTheDocument()
  })

  it('keeps partial content, interruption and recovery distinct from failed retries', () => {
    const resume = vi.fn(), retry = vi.fn()
    const { rerender } = render(<ConversationThread turns={[{ ...turn, toolSteps: [step], interrupted: true, onResume: resume }]} onSelectCitation={vi.fn()} />)
    expect(screen.getByText(/本轮已停止，已保留生成内容和 1 个已完成步骤/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '继续研究' }))
    expect(resume).toHaveBeenCalledOnce()
    rerender(<ConversationThread turns={[{ ...turn, failure: '工具暂时不可用。', onRegenerate: retry }]} onSelectCitation={vi.fn()} />)
    expect(screen.getByText('工具暂时不可用。')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '重试本轮' }))
    expect(retry).toHaveBeenCalledOnce()
  })

  it('preserves complete tool input, output, results and activity callbacks', () => {
    const open = vi.fn()
    render(<ConversationThread turns={[{ ...turn, toolSteps: [step] }]} onSelectCitation={vi.fn()} onOpenActivity={open} />)
    const activity = screen.getByRole('region', { name: 'Agent 工作过程' })
    fireEvent.click(within(activity).getByRole('button', { name: /Agent 已完成工具调用/ }))
    expect(within(activity).getByText('核对来源。')).toBeVisible()
    expect(within(activity).getByText('工具返回片段。')).toBeVisible()
    const full = within(activity).getByText('查看完整工具返回').closest('details')!
    fireEvent.click(within(activity).getByText('查看完整工具返回'))
    expect(full).toHaveAttribute('open')
    expect(within(activity).getByText('完整返回正文。')).toBeVisible()
    expect(activity).toHaveTextContent('第三空间')
    expect(activity).toHaveTextContent('"count": 1')
    fireEvent.click(within(activity).getByRole('button', { name: '查看这一步' }))
    expect(open).toHaveBeenCalledWith('turn-old', step)
  })

  it('renders supplied research and knowledge handoffs without inventing destinations', () => {
    const begin = vi.fn()
    render(<ConversationThread turns={[{ ...turn, handoffs: [{ id: 'handoff', title: '社区公共空间', eyebrow: '研究起点', fields: [{ label: '研究问题', value: '关系如何形成？' }], actions: [{ id: 'begin', label: '进入研究', onClick: begin }, { id: 'entry', label: '打开知识条目', href: '/knowledge/owned?knowledge_release_id=release-old' }] }] }]} onSelectCitation={vi.fn()} />)
    expect(screen.getByRole('region', { name: '研究起点' })).toHaveTextContent('关系如何形成？')
    expect(screen.getByRole('link', { name: '打开知识条目' })).toHaveAttribute('href', '/knowledge/owned?knowledge_release_id=release-old')
    fireEvent.click(screen.getByRole('button', { name: '进入研究' }))
    expect(begin).toHaveBeenCalledOnce()
  })
})

describe('ConversationSourcePanel', () => {
  it('uses the source excerpt, location and host navigation and returns to its source row', () => {
    const back = vi.fn(), close = vi.fn(), select = vi.fn()
    const { rerender } = render(<ConversationSourcePanel detail={{ citation, kindLabel: '网页', topicLabel: '城市生活', locatorLabel: '第 3 段', actions: [{ id: 'open', label: '打开网页', href: citation.source_id!, external: true }] }} onClose={close} onBack={back} />)
    const panel = screen.getByRole('complementary', { name: '引用来源' })
    expect(within(panel).getByRole('region', { name: '依据' })).toHaveFocus()
    expect(panel).toHaveTextContent('真实来源片段。')
    expect(panel).toHaveTextContent('引用位置：第 3 段')
    expect(within(panel).getByRole('link', { name: '打开网页' })).toHaveAttribute('rel', 'noreferrer')
    fireEvent.click(within(panel).getByRole('button', { name: '依据' }))
    expect(back).toHaveBeenCalledOnce()
    rerender(<ConversationSourcePanel citations={[citation]} onSelectCitation={select} onClose={close} />)
    const row = screen.getByRole('button', { name: '1 网页资料' })
    expect(row).toHaveFocus()
    fireEvent.click(row)
    expect(select).toHaveBeenCalledWith(citation)
    fireEvent.keyDown(row, { key: 'Escape' })
    expect(close).toHaveBeenCalledOnce()
  })

  it('uses a modal source sheet on mobile and restores its triggering focus', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    const previousShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
    const previousClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close')
    const show = vi.fn(function (this: HTMLDialogElement) { this.open = true })
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: show })
    const close = vi.fn(function (this: HTMLDialogElement) { this.open = false })
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: close })
    const trigger = document.createElement('button')
    document.body.append(trigger); trigger.focus()
    const dismiss = vi.fn()
    const view = render(<ConversationSourcePanel detail={{ citation }} onClose={dismiss} />)
    const sheet = screen.getByRole('dialog', { name: '引用来源' })
    expect(show).toHaveBeenCalledOnce()
    expect(within(sheet).getByRole('region', { name: '依据' })).toHaveFocus()
    fireEvent(sheet, new Event('cancel', { cancelable: true }))
    expect(dismiss).toHaveBeenCalledOnce()
    view.unmount()
    expect(trigger).toHaveFocus()
    trigger.remove()
    if (previousShow) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', previousShow)
    else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
    if (previousClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', previousClose)
    else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
  })

  it('does not expose deleted content or a stale host navigation action', () => {
    render(<ConversationSourcePanel detail={{ citation: { ...citation, deleted: true }, actions: [{ id: 'open', label: '打开网页', href: citation.source_id! }] }} onClose={vi.fn()} />)
    expect(screen.getByRole('region', { name: '依据' })).toHaveTextContent('这份研究材料已删除，原文不再可访问。')
    expect(screen.queryByText('真实来源片段。')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})

describe('ConversationResearchFlow', () => {
  it('requires real callbacks for plan approval and edit actions', () => {
    const confirm = vi.fn(), edit = vi.fn()
    const { rerender } = render(<ConversationResearchFlow stage="planning" question="第三空间" options={['检索', '核对']} onConfirmPlan={confirm} onEdit={edit} />)
    fireEvent.click(screen.getByRole('button', { name: '开始深入研究' })); expect(confirm).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '返回修改' })); expect(edit).toHaveBeenCalledOnce()
    rerender(<ConversationResearchFlow stage="planning" question="第三空间" options={['检索']} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('supports custom intent and prevents duplicate selections while awaiting the host', () => {
    const choose = vi.fn()
    render(<ConversationResearchFlow stage="clarifying" question="需要哪个角度？" options={['生活空间']} onChooseIntent={choose} onSkip={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '更多自定义' }))
    fireEvent.change(screen.getByRole('textbox', { name: '补充方向' }), { target: { value: '基层社区' } })
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    expect(choose).toHaveBeenCalledWith('基层社区')
    expect(screen.getByRole('radio', { name: '生活空间' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '跳过' })).not.toBeInTheDocument()
  })

  it('exports only through supplied handlers and never invents progress', () => {
    const exportReport = vi.fn(), research = vi.fn()
    const { rerender } = render(<ConversationResearchFlow stage="researching" question="第三空间" toolSteps={[step]} />)
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    rerender(<ConversationResearchFlow stage="completed" question="第三空间" conclusion="研究结论。" knowledgeCount={2} webCount={1} onExport={exportReport} onContinueResearch={research} />)
    fireEvent.click(screen.getByRole('button', { name: '下载 Word' })); expect(exportReport).toHaveBeenCalledWith('docx')
    fireEvent.click(screen.getByRole('button', { name: '下载 PDF' })); expect(exportReport).toHaveBeenCalledWith('pdf')
    fireEvent.click(screen.getByRole('button', { name: '继续形成研究' })); expect(research).toHaveBeenCalledOnce()
    expect(screen.getByRole('region', { name: '研究结论' })).toHaveTextContent('知识库 2 条 · 网页资料 1 条')
  })
})
