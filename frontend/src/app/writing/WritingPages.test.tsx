import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { mapMarkdownSelection, type MarkdownSelection } from '../../modules/shared-editor'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WritingHomePage } from './WritingHomePage'
import { WritingDocumentEditor } from './WritingDocumentPage'
import { writingApi } from '../../modules/writing'
import { draftKey } from './writingState'
vi.mock('../../modules/writing', async importOriginal => ({ ...await importOriginal<typeof import('../../modules/writing')>(), writingApi: { summary: vi.fn(), samples: vi.fn(), document: vi.fn(), revisions: vi.fn(), create: vi.fn(), update: vi.fn(), propose: vi.fn(), resolve: vi.fn(), upload: vi.fn(), previewSamples: vi.fn(), createSample: vi.fn(), deleteSample: vi.fn() } }))
vi.mock('../../modules/agent-profile', () => ({ readAgentProfile: vi.fn(async () => ({ name: '澄', avatar_id: 'cheng', color: '#000' })) }))
vi.mock('../../modules/agent-avatar', () => ({ AgentAvatar: () => <span>头像</span> }))
vi.mock('../ui/PageShell', () => ({ PageShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('../ui/Select', () => ({ Select: ({ options, onChange, ...props }: { options: { value: string; label: string }[]; onChange(value: string): void }) => <select {...props} onChange={event => onChange(event.target.value)}>{options.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select> }))
const shared = vi.hoisted(() => ({ editor: null as Editor | null, selection: null as null | ((value: MarkdownSelection) => void) }))
vi.mock('../../modules/shared-editor', async importOriginal => ({
  ...await importOriginal<typeof import('../../modules/shared-editor')>(),
  SharedEditor: ({ markdown, onChange, onReady, onSelectionChange, readOnly }: { markdown: string; onChange(value: string): void; onReady?(editor: Editor): void; onSelectionChange?(value: MarkdownSelection): void; readOnly?: boolean }) => {
    const [editor] = useState(() => new Editor({ extensions: [StarterKit, Markdown], content: markdown, contentType: 'markdown' }))
    shared.editor = editor; shared.selection = onSelectionChange ?? null
    useEffect(() => { onReady?.(editor); return () => editor.destroy() }, [editor, onReady])
    useEffect(() => { editor.commands.setContent(markdown, { contentType: 'markdown', emitUpdate: false }) }, [editor, markdown])
    useEffect(() => { const select = () => onSelectionChange?.(mapMarkdownSelection(editor, markdown)); editor.on('selectionUpdate', select); return () => { editor.off('selectionUpdate', select) } }, [editor, markdown, onSelectionChange])
    return <textarea aria-label="Markdown 源码" value={markdown} onChange={event => onChange(event.target.value)} onSelect={event => { const input = event.currentTarget; onSelectionChange?.(input.selectionStart < input.selectionEnd ? { start: input.selectionStart, end: input.selectionEnd, text: input.value.slice(input.selectionStart, input.selectionEnd) } : null) }} readOnly={readOnly} />
  },
}))
const agent = vi.hoisted(() => ({ props: null as null | { prepareWritingContext: () => Promise<unknown>; onTurnCompleted: () => void; onConversationStarted: (identity: { conversation_id: string }) => void; conversationId: string | null; writingAction?: { id: string; text: string } | null; onWritingActionFinished?: (id: string) => void } }))
vi.mock('../agent/ResearchAgentConversationPage', () => ({ ResearchAgentConversationPage: (props: NonNullable<typeof agent.props>) => { agent.props = props; return <div>公共 Agent 面板<button>Agent 发送消息</button></div> } }))
const doc = { document_id: 'doc-1', title: '原题', genre: 'essay' as const, markdown: '原文内容', version: 1, created_at: '2026-10-04T00:00:00Z', updated_at: '2026-10-04T00:00:00Z' }
const revision = { revision_id: 'rev-1', document_id: 'doc-1', base_version: 1, action: 'rewrite' as const, before_markdown: '原文内容', after_markdown: '建议内容', status: 'pending' as const, warnings: [], created_at: doc.created_at }
function Location() { return <div data-testid="location">{useLocation().pathname}</div> }
function wrap(element: React.ReactNode) { const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/writing']}><Routes><Route path="*" element={<>{element}<Location /></>} /></Routes></MemoryRouter></QueryClientProvider>) }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
beforeEach(() => { vi.resetAllMocks(); shared.editor = null; shared.selection = null; sessionStorage.clear(); vi.mocked(writingApi.summary).mockResolvedValue({ sample_count: 0, genres: [], documents: [] }); vi.mocked(writingApi.samples).mockResolvedValue({ items: [] }); vi.mocked(writingApi.document).mockResolvedValue(doc); vi.mocked(writingApi.revisions).mockResolvedValue({ items: [] }); vi.mocked(writingApi.create).mockResolvedValue(doc); vi.mocked(writingApi.update).mockImplementation(async (_id, body) => ({ ...doc, ...body, version: 2 })); vi.mocked(writingApi.propose).mockResolvedValue(revision); vi.mocked(writingApi.resolve).mockResolvedValue({ document: { ...doc, markdown: '建议内容', version: 2 }, revision: { ...revision, status: 'accepted' } }); HTMLElement.prototype.scrollIntoView = vi.fn() })
afterEach(cleanup)
describe('real writing home integration', () => {
  it('renders zero real samples and no fake recent article', async () => { wrap(<WritingHomePage userId="u1" />); expect(await screen.findByText('还没有文稿。说说想写什么，或从下方新建。')).toBeInTheDocument(); expect(screen.queryByText('便利店与第三空间')).not.toBeInTheDocument(); expect(screen.getByText('0')).toBeInTheDocument() })
  it('creates a blank genre document and navigates to its returned identity', async () => { wrap(<WritingHomePage userId="u1" />); fireEvent.click(await screen.findByRole('button', { name: '空白文档' })); await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/writing/doc-1')); expect(writingApi.create).toHaveBeenCalledWith({ title: '未命名随笔', genre: 'essay', markdown: '' }, expect.any(String)); expect(writingApi.propose).not.toHaveBeenCalled() })
  it('locks repeated creation clicks and delegates generation to the existing Agent', async () => { const pending = deferred<typeof doc>(); vi.mocked(writingApi.create).mockReturnValue(pending.promise); wrap(<WritingHomePage userId="u1" />); fireEvent.change(screen.getByRole('textbox', { name: '写作要求' }), { target: { value: '写一个开头' } }); const send = screen.getByRole('button', { name: '发送给 Everplain' }); fireEvent.click(send); fireEvent.click(send); expect(writingApi.create).toHaveBeenCalledTimes(1); expect(writingApi.propose).not.toHaveBeenCalled(); await act(async () => pending.resolve(doc)); await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/writing/doc-1')) })
  it('keeps the prompt and idempotency key after create network failure', async () => { vi.mocked(writingApi.create).mockRejectedValue(new Error('网络不可用')); wrap(<WritingHomePage userId="u1" />); fireEvent.change(screen.getByRole('textbox', { name: '写作要求' }), { target: { value: '保留我的要求' } }); fireEvent.click(screen.getByRole('button', { name: '发送给 Everplain' })); await screen.findByText('网络不可用'); expect(screen.getByRole('textbox', { name: '写作要求' })).toHaveValue('保留我的要求'); fireEvent.click(screen.getByRole('button', { name: '发送给 Everplain' })); await waitFor(() => expect(writingApi.create).toHaveBeenCalledTimes(2)); expect(vi.mocked(writingApi.create).mock.calls[0][1]).toBe(vi.mocked(writingApi.create).mock.calls[1][1]) })
  it('does not fetch another owner data while unauthenticated', async () => { wrap(<WritingHomePage userId={null} />); await act(async () => {}); expect(writingApi.summary).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: '空白文档' })); expect(writingApi.create).not.toHaveBeenCalled() })
  it('shows fetch failure rather than substituting example content', async () => { vi.mocked(writingApi.summary).mockRejectedValue(new Error('读取失败')); wrap(<WritingHomePage userId="u1" />); expect(await screen.findByRole('alert')).toHaveTextContent('读取失败'); expect(screen.queryByText('28')).not.toBeInTheDocument() })
})
describe('sample import preview and confirmation', () => {
  const item = { title: '合成随笔', text: '雨停之后，我沿着河岸慢慢走回去。'.repeat(10), character_count: 180, excluded_reason: null }
  const saved = { sample_id: 's1', title: item.title, genre: 'essay' as const, character_count: 180, created_at: doc.created_at }
  function chooseFile() { fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(['synthetic'], '合集.txt', { type: 'text/plain' })] } }) }
  beforeEach(() => { vi.mocked(writingApi.previewSamples).mockResolvedValue({ items: [item, { ...item, title: '删去的', excluded_reason: '原文标记为删去或弃稿，默认不导入。' }], warnings: ['预览不会保存样文或调用模型。'] }); vi.mocked(writingApi.createSample).mockResolvedValue(saved) })
  it('previews without saving and requires a genre for each included piece', async () => { wrap(<WritingHomePage userId="u1" />); chooseFile(); await screen.findByRole('region', { name: '样文导入预览' }); expect(writingApi.upload).not.toHaveBeenCalled(); expect(writingApi.createSample).not.toHaveBeenCalled(); expect(screen.getByRole('checkbox', { name: '导入文章 2' })).not.toBeChecked(); fireEvent.click(screen.getByRole('button', { name: '确认导入选中文章' })); expect(await screen.findByRole('alert')).toHaveTextContent('确认文体'); expect(writingApi.createSample).not.toHaveBeenCalled(); fireEvent.change(screen.getByRole('combobox', { name: '样文文体 1' }), { target: { value: 'essay' } }); fireEvent.click(screen.getByRole('button', { name: '确认导入选中文章' })); await waitFor(() => expect(writingApi.createSample).toHaveBeenCalledTimes(1)); expect(writingApi.createSample).toHaveBeenCalledWith({ title: item.title, genre: 'essay', text: item.text }, expect.any(String)) })
  it('cancels a preview without persisting samples', async () => { wrap(<WritingHomePage userId="u1" />); chooseFile(); await screen.findByRole('region', { name: '样文导入预览' }); fireEvent.click(screen.getByRole('button', { name: '取消导入' })); expect(screen.queryByRole('region', { name: '样文导入预览' })).not.toBeInTheDocument(); expect(writingApi.createSample).not.toHaveBeenCalled() })
  it('cancels an in-flight parser and ignores its late result', async () => { const pending = deferred<Awaited<ReturnType<typeof writingApi.previewSamples>>>(); vi.mocked(writingApi.previewSamples).mockReturnValue(pending.promise); wrap(<WritingHomePage userId="u1" />); chooseFile(); fireEvent.click(await screen.findByRole('button', { name: '取消解析' })); await act(async () => pending.resolve({ items: [item], warnings: [] })); expect(screen.queryByRole('region', { name: '样文导入预览' })).not.toBeInTheDocument(); expect(writingApi.createSample).not.toHaveBeenCalled(); expect(vi.mocked(writingApi.previewSamples).mock.calls[0][1]?.aborted).toBe(true) })
  it('serializes confirmations and retries only unsaved pieces with stable keys', async () => { vi.mocked(writingApi.previewSamples).mockResolvedValue({ items: [item, { ...item, title: '第二篇' }], warnings: [] }); vi.mocked(writingApi.createSample).mockResolvedValueOnce(saved).mockRejectedValueOnce(new Error('网络中断')).mockResolvedValue(saved); wrap(<WritingHomePage userId="u1" />); chooseFile(); await screen.findByRole('region', { name: '样文导入预览' }); for (const index of [1, 2]) fireEvent.change(screen.getByRole('combobox', { name: `样文文体 ${index}` }), { target: { value: 'essay' } }); const confirm = screen.getByRole('button', { name: '确认导入选中文章' }); fireEvent.click(confirm); fireEvent.click(confirm); await screen.findByText(/网络中断/); expect(writingApi.createSample).toHaveBeenCalledTimes(2); fireEvent.click(confirm); await waitFor(() => expect(writingApi.createSample).toHaveBeenCalledTimes(3)); const calls = vi.mocked(writingApi.createSample).mock.calls; expect(calls[1][1]).toBe(calls[2][1]); expect(calls[2][0].title).toBe('第二篇') })
  it('splits only at an author-selected paragraph and asks the new piece genre', async () => { vi.mocked(writingApi.previewSamples).mockResolvedValue({ items: [{ ...item, text: `${item.text}\n\n${item.text}` }], warnings: [] }); wrap(<WritingHomePage userId="u1" />); chooseFile(); fireEvent.click(await screen.findByRole('button', { name: '拆成独立文章' })); expect(screen.getByRole('textbox', { name: '样文正文 2' })).toHaveValue(item.text); expect(screen.getByRole('combobox', { name: '样文文体 2' })).toHaveValue(''); expect(writingApi.createSample).not.toHaveBeenCalled() })
})
describe('writing draft and revision safety', () => {
  it('saves exact Markdown and requires current expected_version', async () => { wrap(<WritingDocumentEditor userId="u1" documentId="doc-1" />); const input = await screen.findByRole('textbox', { name: 'Markdown 源码' }); const markdown = '---\ntitle: old\n---\n\n[[双链|别名]]\n```js\nlet a=1\n```\n'; fireEvent.change(input, { target: { value: markdown } }); fireEvent.click(screen.getByRole('button', { name: '保存' })); await waitFor(() => expect(writingApi.update).toHaveBeenCalledWith('doc-1', expect.objectContaining({ markdown, expected_version: 1 }), expect.any(String))) })
  it('restores only the current owner’s draft after refresh', async () => { sessionStorage.setItem(draftKey('u1', 'doc-1'), JSON.stringify({ title: '恢复标题', genre: 'essay', markdown: '未保存全文', version: 1 })); sessionStorage.setItem(draftKey('u2', 'doc-1'), JSON.stringify({ title: '他人标题', genre: 'essay', markdown: '他人全文', version: 1 })); wrap(<WritingDocumentEditor userId="u1" documentId="doc-1" />); expect(await screen.findByRole('textbox', { name: 'Markdown 源码' })).toHaveValue('未保存全文'); expect(screen.getByRole('textbox', { name: '文稿标题' })).toHaveValue('恢复标题'); expect(screen.queryByText('他人全文')).not.toBeInTheDocument() })
  it('leaves unsaved body intact on failed save and reuses attempt key', async () => { vi.mocked(writingApi.update).mockRejectedValue(new Error('版本冲突')); wrap(<WritingDocumentEditor userId="u1" documentId="doc-1" />); fireEvent.change(await screen.findByRole('textbox', { name: 'Markdown 源码' }), { target: { value: '本地修改' } }); fireEvent.click(screen.getByRole('button', { name: '保存' })); await screen.findByText('版本冲突'); expect(screen.getByRole('textbox', { name: 'Markdown 源码' })).toHaveValue('本地修改'); fireEvent.click(screen.getByRole('button', { name: '保存' })); await waitFor(() => expect(writingApi.update).toHaveBeenCalledTimes(2)); expect(vi.mocked(writingApi.update).mock.calls[0][2]).toBe(vi.mocked(writingApi.update).mock.calls[1][2]) })
  it('never replaces original body just because Agent proposed a revision', async () => { wrap(<WritingDocumentEditor userId="u1" documentId="doc-1" />); await screen.findByText('公共 Agent 面板'); vi.mocked(writingApi.revisions).mockResolvedValue({ items: [revision] }); act(() => agent.props!.onTurnCompleted()); await screen.findByText('查看待定修订 · 对话仍可继续'); expect(screen.getByRole('textbox', { name: 'Markdown 源码' })).toHaveValue('原文内容'); expect(writingApi.resolve).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: '接受修订' })); await waitFor(() => expect(screen.getByRole('textbox', { name: 'Markdown 源码' })).toHaveValue('建议内容')); expect(writingApi.resolve).toHaveBeenCalledWith('doc-1', 'rev-1', { decision: 'accept', expected_version: 1 }, expect.any(String)) })
  it('blocks acceptance over an unsaved user edit', async () => { vi.mocked(writingApi.revisions).mockResolvedValue({ items: [revision] }); wrap(<WritingDocumentEditor userId="u1" documentId="doc-1" />); fireEvent.change(await screen.findByRole('textbox', { name: 'Markdown 源码' }), { target: { value: '新手写内容' } }); fireEvent.click(screen.getByRole('tab', { name: '修订 · 1' })); expect(screen.getByRole('button', { name: '接受' })).toBeDisabled(); expect(writingApi.resolve).not.toHaveBeenCalled() })
  it('keeps chat available with a pending revision and does not call a second writer', async () => { vi.mocked(writingApi.revisions).mockResolvedValue({ items: [revision] }); wrap(<WritingDocumentEditor userId="u1" documentId="doc-1" />); expect(await screen.findByRole('button', { name: 'Agent 发送消息' })).toBeEnabled(); expect(screen.queryByRole('tab', { name: '写作' })).not.toBeInTheDocument(); await act(async () => { expect(await agent.props!.prepareWritingContext()).toEqual({ document_id: 'doc-1', document_version: 1 }) }); expect(writingApi.propose).not.toHaveBeenCalled() })
  it('saves the latest article before making it available to the existing Agent', async () => { wrap(<WritingDocumentEditor userId="u1" documentId="doc-1" />); fireEvent.change(await screen.findByRole('textbox', { name: 'Markdown 源码' }), { target: { value: '最新原文' } }); await act(async () => { expect(await agent.props!.prepareWritingContext()).toEqual({ document_id: 'doc-1', document_version: 2 }) }); expect(writingApi.update).toHaveBeenCalledWith('doc-1', expect.objectContaining({ markdown: '最新原文', expected_version: 1 }), expect.any(String)); expect(writingApi.propose).not.toHaveBeenCalled() })
  it('preserves editing during a delayed save and blocks sending stale document context', async () => { const request = deferred<typeof doc>(); vi.mocked(writingApi.update).mockReturnValue(request.promise); wrap(<WritingDocumentEditor userId="u1" documentId="doc-1" />); const input = await screen.findByRole('textbox', { name: 'Markdown 源码' }); fireEvent.change(input, { target: { value: '提交中的版本' } }); let preparation!: Promise<unknown>; act(() => { preparation = agent.props!.prepareWritingContext() }); const rejected = expect(preparation).rejects.toThrow('保存期间正文有新修改'); fireEvent.change(input, { target: { value: '保存期间继续输入' } }); await act(async () => { request.resolve({ ...doc, markdown: '提交中的版本', version: 2 }); await rejected }); expect(input).toHaveValue('保存期间继续输入') })
  it('preserves edits made while an accepted revision response is pending', async () => { const response = deferred<Awaited<ReturnType<typeof writingApi.resolve>>>(); vi.mocked(writingApi.resolve).mockReturnValue(response.promise); vi.mocked(writingApi.revisions).mockResolvedValue({ items: [revision] }); wrap(<WritingDocumentEditor userId="u1" documentId="doc-1" />); fireEvent.click(await screen.findByRole('button', { name: '接受修订' })); fireEvent.change(screen.getByRole('textbox', { name: 'Markdown 源码' }), { target: { value: '接受期间继续输入' } }); await act(async () => response.resolve({ document: { ...doc, markdown: '建议内容', version: 2 }, revision: { ...revision, status: 'accepted' } })); expect(screen.getByRole('textbox', { name: 'Markdown 源码' })).toHaveValue('接受期间继续输入') })
  it('keeps one conversation mounted across panels and restores its identity on refresh', async () => { const view = wrap(<WritingDocumentEditor userId="u1" documentId="doc-1" />); await screen.findByText('公共 Agent 面板'); act(() => agent.props!.onConversationStarted({ conversation_id: 'conversation-1' })); fireEvent.click(screen.getByRole('tab', { name: '大纲' })); expect(screen.getByText('公共 Agent 面板')).toBeInTheDocument(); fireEvent.click(screen.getByRole('tab', { name: 'Agent' })); expect(agent.props!.conversationId).toBe('conversation-1'); view.unmount(); wrap(<WritingDocumentEditor userId="u1" documentId="doc-1" />); await screen.findByText('公共 Agent 面板'); expect(agent.props!.conversationId).toBe('conversation-1') })
  it('can undo an accepted revision using the current expected version', async () => { vi.mocked(writingApi.document).mockResolvedValue({ ...doc, markdown: '建议内容', version: 2 }); vi.mocked(writingApi.revisions).mockResolvedValue({ items: [{ ...revision, status: 'accepted' }] }); wrap(<WritingDocumentEditor userId="u1" documentId="doc-1" />); await screen.findByText('公共 Agent 面板'); fireEvent.click(screen.getByRole('tab', { name: '修订' })); fireEvent.click(screen.getByRole('button', { name: '撤销这次修订' })); await waitFor(() => expect(writingApi.update).toHaveBeenCalledWith('doc-1', expect.objectContaining({ expected_version: 2, markdown: '原文内容' }), expect.any(String))) })
  it('makes no automatic model call during document open or Agent-tab open', async () => { wrap(<WritingDocumentEditor userId="u1" documentId="doc-1" />); await screen.findByRole('textbox', { name: 'Markdown 源码' }); fireEvent.click(screen.getByRole('tab', { name: 'Agent' })); expect(screen.getByText('公共 Agent 面板')).toBeInTheDocument(); expect(writingApi.propose).not.toHaveBeenCalled() })
  it('serializes duplicate save clicks', async () => { const pending = deferred<typeof doc>(); vi.mocked(writingApi.update).mockReturnValue(pending.promise); wrap(<WritingDocumentEditor userId="u1" documentId="doc-1" />); fireEvent.change(await screen.findByRole('textbox', { name: '文稿标题' }), { target: { value: '新题' } }); const save = screen.getByRole('button', { name: '保存' }); fireEvent.click(save); fireEvent.click(save); expect(writingApi.update).toHaveBeenCalledTimes(1); await act(async () => pending.resolve({ ...doc, title: '新题' })) })
  it('refreshes server version while preserving conflicted local edits', async () => { vi.mocked(writingApi.update).mockRejectedValue(new Error('版本冲突')); wrap(<WritingDocumentEditor userId="u1" documentId="doc-1" />); fireEvent.change(await screen.findByRole('textbox', { name: 'Markdown 源码' }), { target: { value: '本地内容' } }); fireEvent.click(screen.getByRole('button', { name: '保存' })); await screen.findByText('版本冲突'); vi.mocked(writingApi.document).mockResolvedValue({ ...doc, version: 5, markdown: '服务器新正文' }); fireEvent.click(screen.getByRole('button', { name: '刷新版本并保留修改' })); await screen.findByText('服务器版本已刷新，本地修改仍保留。请对照最新正文后再保存。'); expect(screen.getByRole('textbox', { name: 'Markdown 源码' })).toHaveValue('本地内容') })
})


describe('direct writing controls', () => {
  it('submits optimization to the existing Agent once without prefilling or a second send', async () => {
    wrap(<WritingDocumentEditor userId="u1" documentId="doc-1" />)
    const button = await screen.findByRole('button', { name: '优化全文' })
    fireEvent.click(button); fireEvent.click(button)
    await waitFor(() => expect(agent.props!.writingAction?.text).toContain('优化当前全文'))
    const id = agent.props!.writingAction!.id
    expect(button).toBeDisabled()
    expect(writingApi.propose).not.toHaveBeenCalled()
    act(() => agent.props!.onWritingActionFinished?.(id))
    expect(button).toBeEnabled()
  })
  it('does not pretend to personalize without same-genre samples', async () => {
    wrap(<WritingDocumentEditor userId="u1" documentId="doc-1" />)
    fireEvent.click(await screen.findByRole('button', { name: '更像我' }))
    await screen.findByText(/当前随笔还没有可用样文/)
    expect(agent.props!.writingAction).toBeNull()
    expect(screen.getByRole('link', { name: '管理同文体样文' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Agent 发送消息' })).toBeEnabled()
  })
  it('personalizes directly after checking real sample readiness', async () => {
    vi.mocked(writingApi.summary).mockResolvedValue({ sample_count: 3, genres: [{ genre: 'essay', sample_count: 3, character_count: 9000, readiness: 'ready' }], documents: [] })
    wrap(<WritingDocumentEditor userId="u1" documentId="doc-1" />)
    fireEvent.click(await screen.findByRole('button', { name: '更像我' }))
    await waitFor(() => expect(agent.props!.writingAction?.text).toContain('真实同文体样文'))
    expect(writingApi.summary).toHaveBeenCalledTimes(1)
    expect(writingApi.propose).not.toHaveBeenCalled()
  })
  it('uses global segmented tabs and leaves a dirty pending diff reviewable but unappliable', async () => {
    vi.mocked(writingApi.revisions).mockResolvedValue({ items: [revision] })
    wrap(<WritingDocumentEditor userId="u1" documentId="doc-1" />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Markdown 源码' }), { target: { value: '我正在写的新内容' } })
    expect(screen.getByRole('tablist', { name: '写作侧栏' })).toHaveClass('qx-segmented')
    expect(screen.getByRole('region', { name: '待定修订预览' })).toHaveTextContent('建议内容')
    expect(screen.getByRole('button', { name: '接受修订' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'Markdown 源码' })).toHaveValue('我正在写的新内容')
  })
})

describe('precise selection and rich revision acceptance', () => {
  it('passes the same repeated rich-text UTF-16 range to chat and direct optimization', async () => {
    const markdown = '😀前 **重复**\n\n重复'
    vi.mocked(writingApi.document).mockResolvedValue({ ...doc, markdown })
    wrap(<WritingDocumentEditor userId="u1" documentId="doc-1" />)
    await screen.findByText('公共 Agent 面板')
    await waitFor(() => expect(shared.editor?.isInitialized).toBe(true))
    let pos = 0; shared.editor!.state.doc.descendants((node, at) => { if (node.text === '重复') pos = at })
    act(() => { shared.editor!.commands.setTextSelection({ from: pos, to: pos + 2 }) })
    const context = { document_id: 'doc-1', document_version: 1, selection_start: markdown.lastIndexOf('重复'), selection_end: markdown.length }
    await act(async () => { expect(await agent.props!.prepareWritingContext()).toEqual(context) })
    fireEvent.click(screen.getByRole('button', { name: '优化选区' }))
    await waitFor(() => expect(agent.props!.writingAction?.text).toContain('优化当前选区'))
    await act(async () => { expect(await agent.props!.prepareWritingContext()).toEqual(context) })
    expect(writingApi.propose).not.toHaveBeenCalled()
  })

  it('blocks chat and optimization for an unmappable selection until explicitly cleared', async () => {
    wrap(<WritingDocumentEditor userId="u1" documentId="doc-1" />); await screen.findByText('公共 Agent 面板')
    act(() => shared.selection!({ error: '选区无法准确定位，请重新选择。' }))
    await act(async () => { await expect(agent.props!.prepareWritingContext()).rejects.toThrow('选区无法准确定位') })
    fireEvent.click(screen.getByRole('button', { name: '优化选区' }))
    await screen.findByText('选区无法准确定位，请重新选择。')
    expect(agent.props!.writingAction).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '清除选区' }))
    await act(async () => { expect(await agent.props!.prepareWritingContext()).toEqual({ document_id: 'doc-1', document_version: 1 }) })
  })

  it('rejects stale source coordinates rather than silently sending the whole article', async () => {
    wrap(<WritingDocumentEditor userId="u1" documentId="doc-1" />)
    const input = await screen.findByRole('textbox', { name: 'Markdown 源码' }) as HTMLTextAreaElement
    input.setSelectionRange(0, 2); fireEvent.select(input)
    fireEvent.change(input, { target: { value: '改稿内容' } })
    await act(async () => { await expect(agent.props!.prepareWritingContext()).rejects.toThrow('选区已变化') })
    expect(agent.props!.writingAction).toBeNull()
  })

  it('accepts correctly closed partial-bold revisions after clearing selection, and can undo them', async () => {
    const before = '**前半后半** 外面', after = '**前半优化** 外面新版'
    const partial = { ...revision, before_markdown: before, after_markdown: after, selection_start: 4, selection_end: before.length }
    vi.mocked(writingApi.document).mockResolvedValue({ ...doc, markdown: before })
    vi.mocked(writingApi.resolve).mockResolvedValue({ document: { ...doc, markdown: after, version: 2 }, revision: { ...partial, status: 'accepted' } })
    wrap(<WritingDocumentEditor userId="u1" documentId="doc-1" />); await screen.findByText('公共 Agent 面板')
    await waitFor(() => expect(shared.editor?.isInitialized).toBe(true))
    act(() => { shared.editor!.commands.setTextSelection({ from: 3, to: 8 }) })
    await act(async () => { expect(await agent.props!.prepareWritingContext()).toEqual({ document_id: 'doc-1', document_version: 1, selection_start: 4, selection_end: 11 }) })
    fireEvent.click(screen.getByRole('button', { name: '清除选区' }))
    vi.mocked(writingApi.revisions).mockResolvedValue({ items: [partial] }); act(() => agent.props!.onTurnCompleted())
    const accept = await screen.findByRole('button', { name: '接受修订' })
    await waitFor(() => expect(accept).toBeEnabled()); fireEvent.click(accept)
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Markdown 源码' })).toHaveValue(after))
    vi.mocked(writingApi.update).mockImplementation(async (_id, body) => ({ ...doc, ...body, version: 3 }))
    fireEvent.click(screen.getByRole('button', { name: '撤销最近优化' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Markdown 源码' })).toHaveValue(before))
    expect(writingApi.update).toHaveBeenCalledWith('doc-1', expect.objectContaining({ markdown: before, expected_version: 2 }), expect.any(String))
  })

  it.each([
    { before: '**前半后半** 外面', after: '**前半优化 外面新版', start: 4, problem: 'formatting' },
    { before: '[保留前缀选择](https://old.test) 后文', after: '[保留前缀改写](https://new.test) 后文新', start: 5, problem: 'link attributes' },
  ])('blocks unsafe restored pending revisions that change outside $problem', async ({ before, after, start }) => {
    vi.mocked(writingApi.document).mockResolvedValue({ ...doc, markdown: before })
    const restored = { ...revision, before_markdown: before, after_markdown: after, selection_start: start, selection_end: before.length }
    vi.mocked(writingApi.revisions).mockResolvedValue({ items: [restored] })
    wrap(<WritingDocumentEditor userId="u1" documentId="doc-1" />)
    const accept = await screen.findByRole('button', { name: '接受修订' })
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('选区外'))
    expect(accept).toBeDisabled(); fireEvent.click(accept)
    fireEvent.click(screen.getByRole('tab', { name: '修订 · 1' }))
    expect(screen.getByRole('button', { name: '接受' })).toBeDisabled()
    expect(writingApi.resolve).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Markdown 源码' })).toHaveValue(before)
  })

  it.each(['whole', 'selected-link', 'source-url', 'legacy'] as const)('allows legitimate URL changes for $0 scope', async scope => {
    const before = '前 [文](https://old.test) 后', after = '前 [文](https://new.test) 后'
    const metadata = scope === 'legacy' ? {} : { selection_start: scope === 'whole' ? 0 : scope === 'source-url' ? before.indexOf('https://') : 2, selection_end: scope === 'whole' ? before.length : scope === 'source-url' ? before.indexOf(')') : before.length - 2 }
    const change = { ...revision, before_markdown: before, after_markdown: after, ...metadata }
    vi.mocked(writingApi.document).mockResolvedValue({ ...doc, markdown: before })
    vi.mocked(writingApi.revisions).mockResolvedValue({ items: [change] })
    vi.mocked(writingApi.resolve).mockResolvedValue({ document: { ...doc, markdown: after, version: 2 }, revision: { ...change, status: 'accepted' } })
    wrap(<WritingDocumentEditor userId="u1" documentId="doc-1" />)
    const accept = await screen.findByRole('button', { name: '接受修订' })
    await waitFor(() => expect(accept).toBeEnabled()); fireEvent.click(accept)
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Markdown 源码' })).toHaveValue(after))
  })

  it('sends a partial hard-break selection and accepts a source-preserving cross-line revision', async () => {
    const before = '保留第一行  \n第二行尾巴', after = '保留优化一行  \n优化二行尾巴'
    const scoped = { ...revision, before_markdown: before, after_markdown: after, selection_start: 2, selection_end: before.length - 2 }
    vi.mocked(writingApi.document).mockResolvedValue({ ...doc, markdown: before })
    vi.mocked(writingApi.resolve).mockResolvedValue({ document: { ...doc, markdown: after, version: 2 }, revision: { ...scoped, status: 'accepted' } })
    wrap(<WritingDocumentEditor userId="u1" documentId="doc-1" />); await screen.findByText('公共 Agent 面板')
    await waitFor(() => expect(shared.editor?.isInitialized).toBe(true))
    act(() => { shared.editor!.commands.setTextSelection({ from: 3, to: 10 }) })
    await act(async () => { expect(await agent.props!.prepareWritingContext()).toEqual({ document_id: 'doc-1', document_version: 1, selection_start: 2, selection_end: before.length - 2 }) })
    vi.mocked(writingApi.revisions).mockResolvedValue({ items: [scoped] }); act(() => agent.props!.onTurnCompleted())
    const accept = await screen.findByRole('button', { name: '接受修订' })
    await waitFor(() => expect(accept).toBeEnabled()); fireEvent.click(accept)
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Markdown 源码' })).toHaveValue(after))
  })
})
