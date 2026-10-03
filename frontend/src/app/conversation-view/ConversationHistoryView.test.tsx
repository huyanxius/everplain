import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConversationHistoryView, type ConversationHistoryViewProps } from './ConversationHistoryView'
import { createMaterialFirstResearchProject } from '../../modules/socio-match-workspace'

vi.mock('../../modules/socio-match-workspace', () => ({ createMaterialFirstResearchProject: vi.fn() }))
afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

const project = { task_id: 'project-a', project_title: '社区研究', status: 'draft' }
const conversation = { conversation_id: 'conversation-a', task_id: 'project-a', title: '访谈提纲', updated_at: '', turn_count: 1 }
const independent = { conversation_id: 'independent', task_id: null, title: '临时讨论', updated_at: '', turn_count: 1 }
const unavailable = { conversation_id: 'unavailable', task_id: 'missing-project', title: '旧项目的问题', updated_at: '', turn_count: 1 }
function makeProps(overrides: Partial<ConversationHistoryViewProps> = {}): ConversationHistoryViewProps {
  return { projects: [project], setProjects: vi.fn(), conversations: [conversation, independent, unavailable], activeConversationId: 'conversation-a', loading: false, onOpen: vi.fn(), onRename: vi.fn(async () => {}), onDelete: vi.fn(async () => {}), onDeleteProject: vi.fn(async () => {}), onNewConversation: vi.fn(), ...overrides }
}
function mount(props: ConversationHistoryViewProps) {
  const view = render(<MemoryRouter><ConversationHistoryView {...props} /></MemoryRouter>)
  return { ...view, rerenderProps: (next: ConversationHistoryViewProps) => view.rerender(<MemoryRouter><ConversationHistoryView {...next} /></MemoryRouter>) }
}
function conversationMenu() {
  const group = screen.getByRole('group', { name: '社区研究' })
  fireEvent.click(within(group).getByRole('button', { name: '打开对话操作' }))
}

describe('ConversationHistoryView', () => {
  it('groups real projects, independent and unavailable records with working navigation', () => {
    const props = makeProps()
    mount(props)
    const group = screen.getByRole('group', { name: '社区研究' })
    expect(within(group).getByRole('button', { name: '访谈提纲' })).toHaveAttribute('aria-current', 'true')
    expect(within(group).getByRole('link', { name: '项目材料' })).toHaveAttribute('href', '/research/project-a/workspace/materials')
    expect(within(group).getByRole('link', { name: '研究上下文' })).toHaveAttribute('href', '/research/project-a/workspace/map')
    expect(screen.getByRole('group', { name: '项目暂不可用' })).toHaveTextContent('旧项目的问题')
    fireEvent.click(within(group).getByRole('button', { name: '访谈提纲' })); expect(props.onOpen).toHaveBeenCalledWith(conversation)
    fireEvent.click(within(group).getByRole('button', { name: '在社区研究中新建对话' })); expect(props.onNewConversation).toHaveBeenCalledWith('project-a')
    fireEvent.click(screen.getByRole('button', { name: '开始新对话' })); expect(props.onNewConversation).toHaveBeenLastCalledWith(undefined)
    fireEvent.click(within(group).getByRole('button', { name: '社区研究' }))
    expect(within(group).queryByRole('button', { name: '访谈提纲' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '临时讨论' })).toBeVisible()
  })

  it('keeps archived projects readable without offering new project conversations', () => {
    mount(makeProps({ projects: [{ ...project, status: 'archived' }] }))
    const group = screen.getByRole('group', { name: '社区研究' })
    expect(within(group).getByRole('link', { name: '项目材料' })).toBeVisible()
    expect(within(group).queryByRole('button', { name: '在社区研究中新建对话' })).not.toBeInTheDocument()
  })

  it('renames through the host, retains failed input and prevents duplicate submissions', async () => {
    let resolve!: () => void
    const onRename = vi.fn(() => new Promise<void>(done => { resolve = done }))
    const props = makeProps({ onRename })
    const view = mount(props)
    conversationMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: '修改名称' }))
    fireEvent.change(screen.getByRole('textbox', { name: '修改对话名称' }), { target: { value: '新的访谈提纲' } })
    const save = screen.getByRole('button', { name: '保存对话名称' })
    fireEvent.click(save); fireEvent.click(save)
    expect(onRename).toHaveBeenCalledTimes(1)
    expect(onRename).toHaveBeenCalledWith(conversation, '新的访谈提纲')
    expect(save).toBeDisabled()
    resolve()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '修改对话名称' })).not.toBeInTheDocument())
    view.rerenderProps({ ...props, conversations: [{ ...conversation, title: '新的访谈提纲' }, independent] })
    expect(screen.getByRole('button', { name: '新的访谈提纲' })).toBeVisible()
  })

  it('confirms conversation deletion and allows an explicit retry after failure', async () => {
    const onDelete = vi.fn().mockRejectedValueOnce(new Error('删除失败，请重试')).mockResolvedValueOnce(undefined)
    mount(makeProps({ onDelete }))
    conversationMenu(); fireEvent.click(screen.getByRole('menuitem', { name: '删除对话' }))
    expect(onDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog', { name: '删除对话' })).not.toBeInTheDocument()
    conversationMenu(); fireEvent.click(screen.getByRole('menuitem', { name: '删除对话' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除对话' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('删除失败，请重试')
    expect(screen.getByRole('dialog', { name: '删除对话' })).toHaveTextContent('访谈提纲')
    fireEvent.click(screen.getByRole('button', { name: '确认删除对话' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '删除对话' })).not.toBeInTheDocument())
    expect(onDelete).toHaveBeenCalledTimes(2)
    expect(onDelete).toHaveBeenLastCalledWith(conversation)
  })

  it('states project-deletion consequences and locks its pending confirmation', async () => {
    let resolve!: () => void
    const remove = vi.fn(() => new Promise<void>(done => { resolve = done }))
    mount(makeProps({ onDeleteProject: remove }))
    fireEvent.click(screen.getByRole('button', { name: '社区研究的项目操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '删除项目' }))
    expect(screen.getByRole('dialog', { name: '删除项目' })).toHaveTextContent('所属对话会保留为独立对话')
    expect(remove).not.toHaveBeenCalled()
    const confirm = screen.getByRole('button', { name: '确认删除项目' })
    fireEvent.click(confirm); fireEvent.click(confirm); fireEvent.keyDown(confirm, { key: 'Escape' })
    expect(remove).toHaveBeenCalledOnce(); expect(remove).toHaveBeenCalledWith('project-a')
    expect(screen.getByRole('dialog', { name: '删除项目' })).toBeVisible()
    resolve()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '删除项目' })).not.toBeInTheDocument())
  })

  it('creates a project through the existing API with a stable retry key', async () => {
    const create = vi.mocked(createMaterialFirstResearchProject)
    create.mockRejectedValueOnce(new Error('创建请求暂未成功')).mockResolvedValueOnce({ taskId: 'project-new', status: 'draft' } as Awaited<ReturnType<typeof createMaterialFirstResearchProject>>)
    const props = makeProps()
    mount(props)
    fireEvent.click(screen.getByRole('button', { name: '新建项目' }))
    fireEvent.change(screen.getByRole('textbox', { name: '项目名称' }), { target: { value: '  新研究  ' } })
    const submit = screen.getByRole('button', { name: '创建项目' })
    fireEvent.click(submit); fireEvent.click(submit)
    expect(await screen.findByRole('alert')).toHaveTextContent('创建请求暂未成功')
    expect(create).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('textbox', { name: '项目名称' })).toHaveValue('  新研究  ')
    fireEvent.click(screen.getByRole('button', { name: '创建项目' }))
    await waitFor(() => expect(props.onNewConversation).toHaveBeenCalledWith('project-new'))
    expect(create).toHaveBeenNthCalledWith(1, expect.any(String), '新研究')
    expect(create.mock.calls[1][0]).toBe(create.mock.calls[0][0])
    expect(props.setProjects).toHaveBeenCalledWith([{ task_id: 'project-new', project_title: '新研究', status: 'draft' }, project])
    expect(props.onNewConversation).toHaveBeenCalledOnce()
  })

  it('keeps newer project data received while a create request is pending', async () => {
    let resolve!: (value: typeof project) => void
    const create = vi.fn(() => new Promise<typeof project>(done => { resolve = done }))
    const props = makeProps({ onCreateProject: create })
    const view = mount(props)
    fireEvent.click(screen.getByRole('button', { name: '新建项目' }))
    fireEvent.change(screen.getByRole('textbox', { name: '项目名称' }), { target: { value: '新研究' } })
    fireEvent.click(screen.getByRole('button', { name: '创建项目' }))
    const concurrent = { task_id: 'concurrent', project_title: '同时加载的项目', status: 'draft' }
    view.rerenderProps({ ...props, projects: [project, concurrent] })
    const created = { task_id: 'created', project_title: '新研究', status: 'draft' }
    resolve(created)
    await waitFor(() => expect(props.setProjects).toHaveBeenCalledWith([created, project, concurrent]))
  })

  it('searches a mobile modal and restores its opening control on close', () => {
    const openingControl = document.createElement('button'); document.body.append(openingControl); openingControl.focus()
    const onClose = vi.fn()
    const view = mount(makeProps({ modal: true, onClose }))
    const dialog = screen.getByRole('dialog', { name: '研究记录' })
    const search = within(dialog).getByRole('textbox', { name: '搜索研究记录' })
    expect(search).toHaveFocus()
    fireEvent.change(search, { target: { value: '临时' } })
    expect(within(dialog).getByRole('button', { name: '临时讨论' })).toBeVisible()
    expect(within(dialog).queryByRole('group', { name: '社区研究' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: '旧项目的问题' })).not.toBeInTheDocument()
    fireEvent.change(search, { target: { value: '不存在的记录' } })
    expect(within(dialog).getByRole('status')).toHaveTextContent('没有找到匹配的记录。')
    fireEvent.keyDown(search, { key: 'Escape' }); expect(onClose).toHaveBeenCalledOnce()
    view.unmount(); expect(openingControl).toHaveFocus(); openingControl.remove()
  })

  it('closes the action menu before the containing modal when Escape is pressed', () => {
    const close = vi.fn()
    mount(makeProps({ modal: true, onClose: close }))
    conversationMenu()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(close).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByRole('dialog', { name: '研究记录' }), { key: 'Escape' })
    expect(close).toHaveBeenCalledOnce()
  })

  it('opens matching projects for search while keeping their collapse control functional', () => {
    mount(makeProps({ activeConversationId: null, searchable: true }))
    fireEvent.change(screen.getByRole('textbox', { name: '搜索研究记录' }), { target: { value: '访谈' } })
    const group = screen.getByRole('group', { name: '社区研究' })
    expect(within(group).getByRole('button', { name: '访谈提纲' })).toBeVisible()
    fireEvent.click(within(group).getByRole('button', { name: '社区研究' }))
    expect(within(group).queryByRole('button', { name: '访谈提纲' })).not.toBeInTheDocument()
  })

})


it('keeps a drawer action inside its focus boundary and does not dismiss edits on viewport resize', () => {
  const escapedOutside = vi.fn()
  document.addEventListener('keydown', escapedOutside)
  const view = mount(makeProps())
  conversationMenu()
  const menu = screen.getByRole('menu', { name: '对话操作' })
  expect(screen.getByRole('region', { name: 'Agent 对话记录' })).toContainElement(menu)
  fireEvent.click(screen.getByRole('menuitem', { name: '修改名称' }))
  const input = screen.getByRole('textbox', { name: '修改对话名称' })
  fireEvent.change(input, { target: { value: '保留手机编辑' } })
  fireEvent(window, new Event('resize'))
  expect(input).toHaveValue('保留手机编辑')
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(screen.queryByRole('dialog', { name: '修改对话名称' })).not.toBeInTheDocument()
  expect(escapedOutside).not.toHaveBeenCalled()
  document.removeEventListener('keydown', escapedOutside)
  view.unmount()
})
