import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as archiveApi from './professionalMaterialsApi'
import { ProfessionalMaterialArchivePanel } from './ProfessionalMaterialArchive'
import type { ResearchMaterial } from './researchMaterialsModel'

vi.mock('./professionalMaterialsApi', () => ({
  createLiteratureEntry: vi.fn(),
  createMaterialBatch: vi.fn(),
  createMaterialCollection: vi.fn(),
  createMaterialRelation: vi.fn(),
  createResearchCase: vi.fn(),
  exportLiteratureEntries: vi.fn(),
  getProfessionalMaterialArchive: vi.fn(),
  importLiteratureEntries: vi.fn(),
  resolveDoiMetadata: vi.fn(),
  updateProfessionalMaterialProfile: vi.fn(),
  uploadMaterialBatch: vi.fn(),
}))

const selectedMaterial: ResearchMaterial = {
  materialId: 'material-1', taskId: 'task-1', filename: '家庭 A 访谈.txt',
  mediaType: 'text/plain', sizeBytes: 120, status: 'ready', version: 1,
  parseVersion: 1, segmentCount: 2, updatedAt: '2026-08-31T00:00:00Z',
  errorCode: null, materialKind: 'interview_transcript',
}

const archive = {
  task_id: 'task-1',
  profiles: [{
    material_id: 'material-1', research_role: 'empirical_material' as const,
    specific_type: 'interview_transcript', stage: 'collection' as const,
    batch_id: null, tags: ['照护'], collection_ids: [],
    sensitivity: 'sensitive' as const, consent_scope: 'project_only' as const,
    deidentification_status: 'pending' as const,
    model_processing_scope: 'external_allowed' as const,
    allows_manual_reading: true, allows_external_model_processing: true,
    updated_at: '2026-08-31T00:00:00Z',
  }],
  batches: [], collections: [], literature: [], cases: [], relations: [],
  duplicate_hints: [],
  inventory: {
    catalog_pending_material_ids: [], parse_failed_material_ids: [],
    suspected_duplicate_literature_ids: [],
    pending_deidentification_material_ids: ['material-1'],
    restricted_material_ids: ['material-1'],
  },
}

afterEach(cleanup)

describe('professional material archive panel', () => {
  beforeEach(() => {
    vi.mocked(archiveApi.getProfessionalMaterialArchive).mockResolvedValue(archive)
    vi.mocked(archiveApi.updateProfessionalMaterialProfile).mockResolvedValue({
      ...archive.profiles[0], deidentification_status: 'complete',
      model_processing_scope: 'external_allowed',
      allows_external_model_processing: true,
    })
  })

  it('makes restrictions visible without blocking manual reading and saves explicit policy', async () => {
    render(<ProfessionalMaterialArchivePanel
      taskId="task-1"
      selectedMaterial={selectedMaterial}
      materials={[selectedMaterial]}
      onMaterialsChanged={vi.fn()}
    />)

    expect(await screen.findByText('当前材料仍可人工阅读。')).toBeInTheDocument()
    expect(screen.getByText('限制模型处理').nextSibling).toHaveTextContent('1')

    fireEvent.click(screen.getByLabelText('去标识化'))
    fireEvent.click(screen.getByRole('option', { name: '已完成' }))
    fireEvent.click(screen.getByLabelText('模型处理'))
    fireEvent.click(screen.getByRole('option', { name: '允许外部模型' }))
    fireEvent.click(screen.getByRole('button', { name: '保存材料档案' }))

    await waitFor(() => expect(archiveApi.updateProfessionalMaterialProfile).toHaveBeenCalledWith(
      'task-1',
      'material-1',
      expect.objectContaining({
        deidentification_status: 'complete',
        model_processing_scope: 'external_allowed',
      }),
    ))
    expect(await screen.findByText('材料档案已保存。')).toBeInTheDocument()
  })

  it('keeps profile edits while opening the new organization and literature views', async () => {
    render(<ProfessionalMaterialArchivePanel taskId="task-1" selectedMaterial={selectedMaterial} materials={[selectedMaterial]} onMaterialsChanged={vi.fn()} />)
    await screen.findByRole('tab', { name: '材料信息' })
    fireEvent.change(screen.getByLabelText('专业类型'), { target: { value: '补充访谈' } })
    fireEvent.click(screen.getByRole('tab', { name: '组织材料' }))
    expect(screen.getByRole('textbox', { name: '新批次名称' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: '集合名称' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: '个案名称' })).toBeVisible()
    expect(screen.getByRole('combobox', { name: '关联材料' })).toBeVisible()
    fireEvent.click(screen.getByRole('tab', { name: '文献交换' }))
    expect(screen.getByRole('textbox', { name: 'DOI' })).toBeVisible()
    expect(screen.getByRole('combobox', { name: '文献交换格式' })).toBeVisible()
    expect(screen.getByRole('button', { name: '导入条目' })).toBeVisible()
    expect(screen.getByRole('button', { name: '导出' })).toBeVisible()
    fireEvent.click(screen.getByRole('tab', { name: '材料信息' }))
    expect(screen.getByLabelText('专业类型')).toHaveValue('补充访谈')
  })
})
