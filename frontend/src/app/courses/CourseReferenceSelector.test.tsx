import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CourseReferenceSelector } from './CourseReferenceSelector'
import { listCourses, type SharedCourse } from '../../modules/shared-knowledge'

vi.mock('../../modules/shared-knowledge', () => ({ listCourses: vi.fn() }))
afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())
const library = (id: string, name: string, access: SharedCourse['access'] = 'owner'): SharedCourse => ({ id, name, access, description: null, sharingEnabled: false, shareToken: null, readyDocumentCount: 2, documents: [] })

it('lists owned real libraries and returns the selected library ID with the custom menu', async () => {
  vi.mocked(listCourses).mockResolvedValue([library('mine-1', 'QA 合成资料库'), library('mine-2', '访谈笔记'), library('other', '共享资料', 'reader')])
  const onChange = vi.fn()
  const { container } = render(<MemoryRouter><CourseReferenceSelector value="mine-1" hasConversation={false} disabled={false} onChange={onChange} /></MemoryRouter>)
  await waitFor(() => expect(screen.getByRole('combobox', { name: '选择个人知识库' })).toHaveTextContent('QA 合成资料库'))
  expect(container.querySelector('select')).toBeNull()
  fireEvent.click(screen.getByRole('combobox'))
  expect(screen.queryByRole('option', { name: '共享资料' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('option', { name: '访谈笔记' }))
  expect(onChange).toHaveBeenCalledExactlyOnceWith('mine-2')
  expect(screen.getByText('本次对话将使用所选知识库')).toBeInTheDocument()
})

it('preserves the current library during failure and allows removing it', async () => {
  vi.mocked(listCourses).mockRejectedValue(new Error('offline'))
  const onChange = vi.fn()
  render(<MemoryRouter><CourseReferenceSelector value="mine-1" hasConversation disabled={false} onChange={onChange} /></MemoryRouter>)
  await screen.findByRole('link', { name: '查看知识库' })
  expect(screen.getByRole('combobox')).toHaveTextContent('当前知识库暂不可用')
  expect(screen.getByText('切换将开启新对话')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('combobox'))
  fireEvent.click(screen.getByRole('option', { name: '不使用个人知识库' }))
  expect(onChange).toHaveBeenCalledExactlyOnceWith('')
})

it('keeps the selected source disabled during a busy conversation', async () => {
  vi.mocked(listCourses).mockResolvedValue([library('mine-1', 'QA 合成资料库')])
  render(<MemoryRouter><CourseReferenceSelector value="mine-1" hasConversation disabled onChange={vi.fn()} /></MemoryRouter>)
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveTextContent('QA 合成资料库'))
  expect(screen.getByRole('combobox')).toBeDisabled()
  fireEvent.click(screen.getByRole('combobox'))
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
})
