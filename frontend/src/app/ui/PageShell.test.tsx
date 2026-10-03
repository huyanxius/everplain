import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { Link, MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PageShell } from './PageShell'
import { ConversationLayout } from '../conversation-view/ConversationLayout'
import { setSidebarRecordsOpen, sidebarRecordsPreferenceStorageKey } from '../../styles/sidebarRecordsPreference'
import { setSidebarLayoutPreference, sidebarLayoutPreferenceStorageKey } from '../../styles/sidebarLayoutPreference'

vi.mock('../../modules/account', () => ({
  useAccount: () => ({
    sessionState: {
      status: 'authenticated' as const,
      session: { user: { displayName: '研究者' } },
    },
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    retrySession: vi.fn(),
  }),
}))

afterEach(() => {
  cleanup()
  setSidebarRecordsOpen(true)
  window.localStorage.removeItem(sidebarRecordsPreferenceStorageKey)
  setSidebarLayoutPreference(false)
  window.localStorage.removeItem(sidebarLayoutPreferenceStorageKey)
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
})

describe('PageShell global chrome', () => {
  it.each([
    ['/agent?conversation_id=conversation-b&task_id=task-1&knowledge_release_id=release-1', '研究画布', '/research/new?conversation_id=conversation-b&task_id=task-1&knowledge_release_id=release-1'],
    ['/research/new?conversation_id=conversation-b&task_id=task-1', '对话视图', '/agent?conversation_id=conversation-b&task_id=task-1'],
  ])('keeps the same conversation when switching views from %s', (path, label, destination) => {
    render(<MemoryRouter initialEntries={[path]}><PageShell><h1>研究</h1></PageShell></MemoryRouter>)
    const views = screen.getByRole('navigation', { name: '对话视图' })
    expect(within(views).getByRole('link', { name: label })).toHaveAttribute('href', destination)
    fireEvent.click(screen.getByText('更多功能', { selector: 'summary span' }))
    expect(within(screen.getByRole('navigation', { name: '更多功能' })).getByRole('link', { name: '新建研究' })).toHaveAttribute('href', '/research/new')
    expect(screen.queryByRole('link', { name: '研究 Agent' })).not.toBeInTheDocument()
    const sidebar = screen.getByRole('complementary', { name: 'Everplain 功能栏' })
    expect(within(sidebar).getAllByRole('link', { name: '新对话' })).toHaveLength(1)
    expect(within(sidebar).getByRole('link', { name: '新对话' })).toHaveAttribute('href', '/agent')
  })

  it('does not inject the retired help and boundary trigger', () => {
    render(
      <MemoryRouter>
        <PageShell immersive>
          <h1>登录</h1>
        </PageShell>
      </MemoryRouter>,
    )

    expect(screen.queryByRole('button', { name: '帮助与边界' })).not.toBeInTheDocument()
  })

  it('shows the research deep-dive update in the updates tab', () => {
    render(
      <MemoryRouter>
        <PageShell>
          <h1>工作台</h1>
        </PageShell>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: '通知' }))
    fireEvent.click(screen.getByRole('tab', { name: '更新日志' }))

    expect(screen.getByText('深度研究现已上线')).toBeInTheDocument()
    expect(screen.getByText(/自动让 Agent 规划任务/)).toBeInTheDocument()
  })
})

it.each([[1024, '桌面主导航'], [390, '移动主导航']])('opens the same private library at %spx', (width, name) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  render(<MemoryRouter><PageShell><h1>Library</h1></PageShell></MemoryRouter>)
  if (width === 390) {
    expect(screen.queryByRole('navigation', { name })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '打开菜单' }))
  }
  const navigation = screen.getByRole('navigation', { name })
  expect(within(navigation).getByRole('link', { name: '知识库' })).toHaveAttribute('href', '/library')
  expect(within(navigation).queryByRole('link', { name: '课程' })).not.toBeInTheDocument()
  expect(within(navigation).getByRole('link', { name: '图谱' })).toHaveAttribute('href', '/my/graph')
})

it('keeps extra destinations and notifications reachable from the mobile drawer', () => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
  render(<MemoryRouter><PageShell><h1>应用</h1></PageShell></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: '打开菜单' }))
  const drawer = screen.getByRole('dialog', { name: 'Everplain 功能栏' })
  const more = drawer.querySelector('details')!
  fireEvent.click(more.querySelector('summary')!)
  expect(more.open).toBe(true)
  for (const href of ['/library/knowledge', '/imports', '/sharing', '/discover', '/connections', '/subscription']) {
    expect(drawer.querySelector(`a[href="${href}"]`)).toBeInTheDocument()
  }
  fireEvent.click(within(drawer).getByRole('button', { name: '通知' }))
  for (const name of ['全部', '更新日志', '消息']) expect(screen.getByRole('tab', { name })).toBeVisible()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog', { name: 'Everplain 功能栏' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '打开菜单' })).toHaveFocus()
})


it('places conversation controls in one mobile header and restores the desktop header on resize', () => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
  const { container } = render(<MemoryRouter><PageShell workspace wide><ConversationLayout
    embedded={false} empty={false} research={false} runtimeMode="standard" sourceOpen={false}
    title="我的对话" label="当前对话" prompt="开始对话" pet={null}
    modes={<button role="tab">Chat</button>} actions={<button>更多对话操作</button>}
    history={<button>打开研究记录</button>} thread={<p>已有消息</p>} composer={<textarea aria-label="消息" />}
  /></PageShell></MemoryRouter>)
  const host = container.querySelector('.application-frame__mobile-context')!
  expect(within(host as HTMLElement).getByRole('tab', { name: 'Chat' })).toBeInTheDocument()
  expect(within(host as HTMLElement).getByRole('button', { name: '打开研究记录' })).toBeInTheDocument()
  expect(container.querySelector('.cv-layout__top')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '打开菜单' }))
  expect(container.querySelector('.application-frame__body')).toHaveAttribute('inert')
  expect(container.querySelector('.application-sidebar__scroll .application-sidebar__history')).toBeInTheDocument()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(container.querySelector('.application-frame__body')).not.toHaveAttribute('inert')
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
  fireEvent(window, new Event('resize'))
  expect(container.querySelector('.cv-layout__top')).toBeInTheDocument()
  expect(host).toBeEmptyDOMElement()
  expect(screen.getAllByRole('tab', { name: 'Chat' })).toHaveLength(1)
})

function DraftContent() {
  const [draft, setDraft] = useState('')
  return <textarea aria-label="未发送草稿" value={draft} onChange={event => setDraft(event.target.value)} />
}

function renderLayout() {
  return render(<MemoryRouter initialEntries={['/app']}><PageShell railContent={<a href="/agent?conversation_id=saved">已有对话记录</a>}><DraftContent /></PageShell></MemoryRouter>)
}

describe('opt-in split sidebar layout', () => {
  it('defaults to the classic sidebar with history below its navigation', () => {
    window.localStorage.removeItem(sidebarLayoutPreferenceStorageKey)
    const { container } = renderLayout()
    expect(container.querySelector('.application-frame')).toHaveAttribute('data-split-rail', 'false')
    expect(container.querySelector('.application-icon-rail')).not.toBeInTheDocument()
    expect(container.querySelector('.application-sidebar__scroll .application-sidebar__history')).toContainElement(screen.getByRole('link', { name: '已有对话记录' }))
    expect(screen.getByRole('button', { name: '收起侧栏' })).toBeVisible()
  })

  it('separates desktop navigation and history, and toggles records without losing the draft', () => {
    setSidebarLayoutPreference(true)
    const { container } = renderLayout()
    const frame = container.querySelector('.application-frame')!
    const icons = container.querySelector('.application-icon-rail')!
    const records = screen.getByRole('region', { name: '对话与研究' })
    const input = screen.getByRole('textbox', { name: '未发送草稿' })
    fireEvent.change(input, { target: { value: '保留未发送的问题' } })
    expect(frame).toHaveAttribute('data-split-rail', 'true')
    expect(icons).toContainElement(screen.getByRole('navigation', { name: '桌面主导航' }))
    expect(icons).not.toContainElement(records)
    expect(records).toContainElement(screen.getByRole('link', { name: '已有对话记录' }))
    const toggle = screen.getByRole('button', { name: '收起对话与研究' })
    expect(icons).not.toContainElement(toggle)
    expect(container.querySelector('.application-frame__body')).toContainElement(toggle)
    expect(toggle).toHaveAttribute('aria-controls', records.id)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(toggle)
    expect(records).not.toBeVisible()
    expect(screen.getByRole('button', { name: '展开对话与研究' })).toBeVisible()
    expect(frame).toHaveAttribute('data-records-open', 'false')
    expect(screen.getByRole('navigation', { name: '桌面主导航' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '展开对话与研究' }))
    expect(records).toBeVisible()
    expect(frame).toHaveAttribute('data-records-open', 'true')
    expect(screen.getByRole('textbox', { name: '未发送草稿' })).toBe(input)
    expect(input).toHaveValue('保留未发送的问题')
  })

  it('applies preference changes live without remounting main content', () => {
    const { container } = renderLayout()
    const input = screen.getByRole('textbox', { name: '未发送草稿' })
    fireEvent.change(input, { target: { value: '正在编辑的草稿' } })
    act(() => setSidebarLayoutPreference(true))
    expect(container.querySelector('.application-frame')).toHaveAttribute('data-split-rail', 'true')
    expect(screen.getByRole('region', { name: '对话与研究' })).toBeVisible()
    act(() => setSidebarLayoutPreference(false))
    expect(container.querySelector('.application-frame')).toHaveAttribute('data-split-rail', 'false')
    expect(screen.queryByRole('region', { name: '对话与研究' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '收起侧栏' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: '未发送草稿' })).toBe(input)
    expect(input).toHaveValue('正在编辑的草稿')
  })

  it('uses a mobile drawer after resize and restores split desktop history without changing the draft', () => {
    setSidebarLayoutPreference(true)
    const { container } = renderLayout()
    const input = screen.getByRole('textbox', { name: '未发送草稿' })
    fireEvent.change(input, { target: { value: '跨尺寸保留的草稿' } })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    fireEvent(window, new Event('resize'))
    expect(container.querySelector('.application-frame')).toHaveAttribute('data-split-rail', 'false')
    expect(screen.queryByRole('navigation', { name: '移动主导航' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '打开菜单' }))
    const drawer = screen.getByRole('dialog', { name: 'Everplain 功能栏' })
    expect(within(drawer).getByRole('navigation', { name: '移动主导航' })).toBeVisible()
    expect(within(drawer).getByRole('link', { name: '已有对话记录' })).toBeVisible()
    expect(container.querySelector('.application-frame__body')).toHaveAttribute('inert')
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
    fireEvent(window, new Event('resize'))
    expect(container.querySelector('.application-frame')).toHaveAttribute('data-split-rail', 'true')
    expect(container.querySelector('.application-frame__body')).not.toHaveAttribute('inert')
    expect(screen.queryByRole('dialog', { name: 'Everplain 功能栏' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: '对话与研究' })).toContainElement(screen.getByRole('link', { name: '已有对话记录' }))
    expect(screen.getByRole('textbox', { name: '未发送草稿' })).toBe(input)
    expect(input).toHaveValue('跨尺寸保留的草稿')
    expect(document.body.style.overflow).not.toBe('hidden')
  })
})


it('keeps the records pane closed across a route remount and page reload', () => {
  setSidebarLayoutPreference(true)
  function App() { return <MemoryRouter initialEntries={['/app']}><Routes>
    <Route path="/app" element={<PageShell key="home" railContent={<p>首页记录</p>}><Link to="/library">进入资料页</Link></PageShell>} />
    <Route path="/library" element={<PageShell key="library" railContent={<p>资料页记录</p>}><p>资料页</p></PageShell>} />
  </Routes></MemoryRouter> }
  const first = render(<App />)
  fireEvent.click(screen.getByRole('button', { name: '收起对话与研究' }))
  expect(window.localStorage.getItem(sidebarRecordsPreferenceStorageKey)).toBe('closed')
  fireEvent.click(screen.getByRole('link', { name: '进入资料页' }))
  expect(screen.getByText('资料页')).toBeVisible()
  expect(screen.getByRole('button', { name: '展开对话与研究' })).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('region', { name: '对话与研究' })).not.toBeInTheDocument()
  first.unmount()
  render(<App />)
  expect(screen.getByRole('button', { name: '展开对话与研究' })).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(screen.getByRole('button', { name: '展开对话与研究' }))
  expect(window.localStorage.getItem(sidebarRecordsPreferenceStorageKey)).toBe('open')
  expect(screen.getByRole('region', { name: '对话与研究' })).toBeVisible()
})
