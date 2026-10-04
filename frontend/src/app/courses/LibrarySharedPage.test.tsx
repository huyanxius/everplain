import type { PropsWithChildren } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getCourse, listCourses, readCourseDocument, readKnowledgeStorage, type SharedCourse } from '../../modules/shared-knowledge'
import { leave } from '../../modules/product-integrations'
import { LibrarySharedPage } from './LibrarySharedPage'
vi.mock('../ui/PageShell', () => ({ PageShell: ({ children }: PropsWithChildren) => children, PageContent: ({ children }: PropsWithChildren) => children }))
vi.mock('../../modules/account', () => ({ useAccount: () => ({ sessionState: { status: 'authenticated', session: { user: { userId: 'reader1' } } } }) }))
vi.mock('../../modules/shared-knowledge', () => ({ getCourse: vi.fn(), listCourses: vi.fn(), readCourseDocument: vi.fn(), readKnowledgeStorage: vi.fn() }))
vi.mock('../../modules/product-integrations', () => ({ leave: vi.fn() }))
const library: SharedCourse = { id: 'shared1', name: '共享主题', description: '', access: 'reader', sharingEnabled: true, shareToken: null, readyDocumentCount: 1, documents: [{ id: 'd1', filename: '共享.txt', mediaType: 'text/plain', sizeBytes: 10, parseId: 'p1', status: 'ready', knowledgeStatus: 'ready', indexStatus: 'ready', knowledge: null, knowledgeError: null, indexError: null, errorMessage: null, warnings: [], createdAt: '' }] }
const original = Object.getOwnPropertyDescriptors(HTMLDialogElement.prototype)
beforeEach(() => {
  vi.mocked(getCourse).mockResolvedValue(library); vi.mocked(listCourses).mockResolvedValue([library]); vi.mocked(readKnowledgeStorage).mockRejectedValue(new Error('offline'))
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.setAttribute('open', '') } }); Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() {} })
})
afterEach(() => { cleanup(); vi.resetAllMocks(); for (const key of ['showModal', 'close']) { if (original[key]) Object.defineProperty(HTMLDialogElement.prototype, key, original[key]); else Reflect.deleteProperty(HTMLDialogElement.prototype, key) } })
function mount(path='/shared/shared1') { render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/shared/:libraryId" element={<LibrarySharedPage />} /><Route path="/library" element={<p>自己的资料库</p>} /></Routes></MemoryRouter>) }
it('opens shared cards read-only without owner write controls', async () => {
  mount(); expect(await screen.findByRole('link', { name: '共享.txt' })).toHaveAttribute('href', '/shared/shared1?document_id=d1')
  expect(screen.queryByRole('button', { name: /管理资料|上传资料|添加资料|删除/ })).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索共享资料' }), { target: { value: '不存在' } }); expect(screen.getByText('没有找到相关资料')).toBeVisible()
})
it('does not request or reveal source after access is revoked', async () => {
  vi.mocked(getCourse).mockResolvedValue({ ...library, access: 'unavailable' }); mount('/shared/shared1?document_id=d1')
  expect(await screen.findByText('此知识库不可访问。')).toBeVisible(); expect(readCourseDocument).not.toHaveBeenCalled(); expect(screen.queryByText('共享.txt')).not.toBeInTheDocument()
})
it('requires explicit exit and preserves membership on cancel', async () => {
  vi.mocked(leave).mockResolvedValue(undefined); mount(); fireEvent.click(await screen.findByRole('button', { name: '退出这个知识库' })); fireEvent.click(screen.getByRole('button', { name: '保留访问' })); expect(leave).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '退出这个知识库' })); fireEvent.click(screen.getByRole('button', { name: '确认退出' })); await waitFor(() => expect(leave).toHaveBeenCalledWith('shared1')); expect(await screen.findByText('自己的资料库')).toBeVisible()
})
