import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ModelSelectionSettings } from './ModelSelectionSettings'
import type { AgentModelSelectionState } from './useAgentModelSelection'

afterEach(cleanup)
const state = (): AgentModelSelectionState => ({
  owner: 'owner', status: 'ready', runtimeMode: 'base',
  catalog: [{ id: 'gpt-6-luna', label: 'GPT 6 Luna', reasoningEfforts: ['low', 'medium', 'high'], defaultReasoningEffort: 'medium' }],
  selection: { modelId: 'gpt-6-luna', reasoningEffort: 'medium' },
  onChange: vi.fn(), retry: vi.fn(), requestFields: () => ({}),
})

it('shows the model and supported effort stops immediately without a menu toggle', () => {
  const selection = state()
  render(<ModelSelectionSettings state={selection} disabled={false} />)
  expect(screen.getByRole('combobox', { name: '模型' })).toBeVisible()
  const slider = screen.getByRole('slider', { name: '思考强度' })
  expect(slider).toBeVisible()
  expect(slider).toHaveAttribute('max', '2')
  fireEvent.change(slider, { target: { value: '2' } })
  expect(selection.onChange).toHaveBeenCalledExactlyOnceWith({ modelId: 'gpt-6-luna', reasoningEffort: 'high' })
})

it('shows a failed lookup and retry without inventing model controls', () => {
  const selection = { ...state(), status: 'error' as const, catalog: [], selection: null }
  render(<ModelSelectionSettings state={selection} disabled={false} />)
  expect(screen.getByRole('status')).toHaveTextContent('模型设置暂时无法读取')
  expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '重新读取模型' }))
  expect(selection.retry).toHaveBeenCalledOnce()
})

it('locks controls to the active request instead of displaying the next-turn preference', () => {
  render(<ModelSelectionSettings state={state()} disabled activeRequest={{ message: '继续', model_id: 'gpt-6-luna', reasoning_effort: 'low' }} />)
  expect(screen.getByRole('slider')).toHaveValue('0')
  expect(screen.getByRole('slider')).toBeDisabled()
  expect(screen.getByRole('combobox')).toBeDisabled()
})
