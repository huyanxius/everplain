import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseMultipartRequest } from '../../test/multipart'

import { ExistingResearchEntryPage } from './ExistingResearchEntryPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function LocationProbe() {
  const location = useLocation()
  return <output aria-label="当前路径">{location.pathname}{location.search}</output>
}

describe('ExistingResearchEntryPage', () => {
  it('creates one project and uploads every selected initial material into it', async () => {
    const taskId = 'existing-research-task'
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const url = new URL(request.url)
      if (url.pathname === '/api/research-tasks') {
        return Response.json({
          task_id: taskId,
          entry_type: 'material_input',
          entry_mode: 'existing_research',
          lifecycle_status: 'in_progress',
          project_title: '社区照护田野研究',
          project_stage: '材料整理',
          method_orientation: '质性访谈',
          last_central_tool: 'materials',
          status: 'draft',
          version: 1,
          allowed_actions: ['submit_phenomenon'],
          seed_theory_id: null,
          seed_theory_name: null,
          created_at: '2026-08-31T00:00:00Z',
          updated_at: '2026-08-31T00:00:00Z',
        }, { status: 201 })
      }
      if (url.pathname === `/api/research-tasks/${taskId}/materials`) {
        const form = await parseMultipartRequest(request)
        const file = form.get('file') as File
        return Response.json({
          material_id: `material-${file.name}`,
          task_id: taskId,
          filename: file.name,
          media_type: file.type,
          material_kind: 'other',
          size_bytes: file.size,
          status: 'ready',
          version: 1,
          parse_version: 1,
          segment_count: 1,
          created_at: '2026-08-31T00:00:00Z',
          updated_at: '2026-08-31T00:00:00Z',
        }, { status: 201 })
      }
      return Response.json({}, { status: 404 })
    })
    vi.stubGlobal('fetch', fetch)

    render(
      <MemoryRouter initialEntries={['/research/existing']}>
        <ExistingResearchEntryPage />
        <LocationProbe />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByRole('textbox', { name: '项目名称' }), {
      target: { value: '社区照护田野研究' },
    })
    fireEvent.click(screen.getByRole('combobox', { name: '当前阶段' }))
    fireEvent.click(screen.getByRole('option', { name: '材料整理' }))
    fireEvent.change(screen.getByLabelText('选择初始材料'), {
      target: {
        files: [
          new File(['访谈 A'], '访谈-A.txt', { type: 'text/plain' }),
          new File(['访谈 B'], '访谈-B.md', { type: 'text/markdown' }),
        ],
      },
    })
    fireEvent.click(screen.getByRole('button', { name: '建立项目并导入材料' }))

    await waitFor(
      () => expect(screen.getByLabelText('当前路径')).toHaveTextContent(
        `/research/${taskId}/workspace/materials`,
      ),
      { timeout: 10_000 },
    )
    const taskRequests = fetch.mock.calls.filter(([input, init]) => {
      const request = input instanceof Request ? input : new Request(input, init)
      return new URL(request.url).pathname === '/api/research-tasks'
    })
    const materialRequests = fetch.mock.calls.filter(([input, init]) => {
      const request = input instanceof Request ? input : new Request(input, init)
      return new URL(request.url).pathname.endsWith('/materials')
    })
    expect(taskRequests).toHaveLength(1)
    expect(materialRequests).toHaveLength(2)
    const taskRequest = taskRequests[0]
    if (!taskRequest) throw new Error('Expected one research-task request.')
    const request = taskRequest[0] instanceof Request
      ? taskRequest[0]
      : new Request(taskRequest[0], taskRequest[1])
    await expect(request.json()).resolves.not.toHaveProperty('method_orientation')
  })

  it('keeps the selected files editable before submitting and rejects unsupported files', async () => {
    const fetch = vi.fn(async () => Response.json({ items: [] }))
    vi.stubGlobal('fetch', fetch)
    render(<MemoryRouter><ExistingResearchEntryPage /></MemoryRouter>)
    fireEvent.change(screen.getByRole('textbox', { name: '项目名称' }), { target: { value: '研究草稿' } })
    fireEvent.change(screen.getByLabelText('选择初始材料'), {
      target: { files: [new File(['note'], '笔记.txt', { type: 'text/plain' }), new File(['data'], '数据.xlsx')] },
    })
    fireEvent.click(screen.getByRole('button', { name: '移除 笔记.txt' }))
    expect(screen.queryByText('笔记.txt')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '建立项目并导入材料' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('数据.xlsx 不是可导入')
    expect(fetch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '移除 数据.xlsx' }))
    expect(screen.getByRole('button', { name: '建立项目并导入材料' })).toBeDisabled()
  })

  it('retries a partial import in the same project without uploading completed files again', async () => {
    let projectCount = 0
    const uploadedNames: string[] = []
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const pathname = new URL(request.url).pathname
      if (pathname === '/api/research-tasks') {
        projectCount += 1
        return Response.json({ task_id: 'existing-retry', entry_type: 'material_input', entry_mode: 'existing_research', lifecycle_status: 'in_progress', status: 'draft', version: 1, allowed_actions: ['submit_phenomenon'], created_at: '2026-08-31T00:00:00Z', updated_at: '2026-08-31T00:00:00Z' }, { status: 201 })
      }
      if (pathname === '/api/research-tasks/existing-retry/materials') {
        const file = (await parseMultipartRequest(request)).get('file') as File
        uploadedNames.push(file.name)
        if (uploadedNames.length === 2) return Response.json({ detail: '暂时无法导入第二份材料' }, { status: 503 })
        return Response.json({ material_id: `material-${file.name}`, task_id: 'existing-retry', filename: file.name, media_type: file.type, material_kind: 'other', size_bytes: file.size, status: 'ready', version: 1, parse_version: 1, segment_count: 1, created_at: '2026-08-31T00:00:00Z', updated_at: '2026-08-31T00:00:00Z' }, { status: 201 })
      }
      return Response.json({}, { status: 404 })
    })
    vi.stubGlobal('fetch', fetch)
    render(<MemoryRouter initialEntries={['/research/existing']}><ExistingResearchEntryPage /><LocationProbe /></MemoryRouter>)
    fireEvent.change(screen.getByRole('textbox', { name: '项目名称' }), { target: { value: '已有研究' } })
    fireEvent.change(screen.getByLabelText('选择初始材料'), { target: { files: [new File(['one'], 'one.txt', { type: 'text/plain' }), new File(['two'], 'two.txt', { type: 'text/plain' })] } })
    fireEvent.click(screen.getByRole('button', { name: '建立项目并导入材料' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法导入第二份材料')
    expect(screen.getByRole('textbox', { name: '项目名称' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '重试导入材料' }))
    await waitFor(() => expect(screen.getByLabelText('当前路径')).toHaveTextContent('/research/existing-retry/workspace/materials'))
    expect(projectCount).toBe(1)
    expect(uploadedNames).toEqual(['one.txt', 'two.txt', 'two.txt'])
  })

})
