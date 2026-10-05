import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it } from 'vitest'
import type { SharedCourse, SharedDocument } from '../../modules/shared-knowledge'
import { LibraryMaterialCard } from './LibraryMaterialCard'

afterEach(cleanup)
const document = { id: 'document', filename: 'bookmark-59.md', status: 'ready', mediaType: 'text/markdown', sizeBytes: 100, knowledgeStatus: 'ready', indexStatus: 'ready', knowledge: null, warnings: [] } as SharedDocument
const course = { id: 'library', name: '我的资料' } as SharedCourse
it('shows a webpage title and site logo, then falls back after a failed logo', () => {
  render(<MemoryRouter><LibraryMaterialCard course={course} document={document} source={{ url: 'https://example.com/page', title: '真实网页标题' }} showLibrary busy={false} onRetry={() => {}} onDelete={() => {}} onReupload={() => {}} /></MemoryRouter>)
  expect(screen.getByText('网页')).toBeVisible()
  expect(screen.getByRole('link', { name: '真实网页标题' })).toHaveAttribute('href', '/library?kb_id=library&document_id=document')
  const icon = screen.getByRole('img', { name: '站点图标' })
  expect(icon).toHaveAttribute('src', 'https://example.com/favicon.ico')
  expect(icon).toHaveAttribute('referrerpolicy', 'no-referrer')
  fireEvent.error(icon)
  expect(screen.queryByRole('img', { name: '站点图标' })).not.toBeInTheDocument()
  expect(screen.getByText('网页')).toBeVisible()
})
