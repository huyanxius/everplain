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

it('shows the real model and effort summary and opens the reference radio list and legal stops only on demand', () => {
  const selection = state()
  const view = render(<ModelSelectionSettings state={selection} disabled={false} />)
  const summary = screen.getByRole('button', { name: /GPT 6 Luna · 中/ })
  expect(summary).toBeVisible()
  expect(summary.querySelector('.model-selection-settings__summary-effort')).toHaveTextContent('中')
  expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  fireEvent.click(summary)
  expect(screen.getByRole('dialog')).toHaveStyle({ width: '300px' })
  expect(screen.getByRole('radiogroup', { name: '模型' })).toBeVisible()
  expect(screen.getByRole('radio', { name: 'GPT 6 Luna' })).toHaveFocus()
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  const slider = screen.getByRole('slider', { name: '思考强度' })
  expect(slider).toBeVisible()
  expect(slider).toHaveAttribute('aria-valuemax', '2')
  fireEvent.keyDown(slider, { key: 'End' })
  expect(selection.onChange).toHaveBeenCalledExactlyOnceWith({ modelId: 'gpt-6-luna', reasoningEffort: 'high' })
  view.rerender(<ModelSelectionSettings state={{ ...selection, selection: { modelId: 'gpt-6-luna', reasoningEffort: 'high' } }} disabled={false} />)
  expect(summary).toHaveAccessibleName('模型与思考强度：GPT 6 Luna · 高')
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  expect(summary).toHaveFocus()
})

it('dismisses on an outside pointer and can be reopened and toggled repeatedly', () => {
  render(<ModelSelectionSettings state={state()} disabled={false} />)
  const summary = screen.getByRole('button', { name: /GPT 6 Luna · 中/ })
  fireEvent.click(summary)
  fireEvent.pointerDown(document.body)
  expect(summary).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  fireEvent.click(summary)
  expect(screen.getByRole('radio')).toHaveAttribute('aria-checked', 'true')
  fireEvent.click(summary)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('shows a failed lookup and retry without inventing model controls', () => {
  const selection = { ...state(), status: 'error' as const, catalog: [], selection: null }
  render(<ModelSelectionSettings state={selection} disabled={false} />)
  fireEvent.click(screen.getByRole('button', { name: /模型暂不可用/ }))
  expect(screen.getByRole('status')).toHaveTextContent('模型设置暂时无法读取')
  expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '重新读取模型' }))
  expect(selection.retry).toHaveBeenCalledOnce()
})

it('shows loading and an empty catalog as real unavailable states', () => {
  const view = render(<ModelSelectionSettings state={{ ...state(), status: 'loading', catalog: [], selection: null }} disabled={false} />)
  fireEvent.click(screen.getByRole('button', { name: /正在读取模型/ }))
  expect(screen.getByRole('status')).toHaveTextContent('正在读取可用模型')
  expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  view.rerender(<ModelSelectionSettings state={{ ...state(), catalog: [], selection: null }} disabled={false} />)
  expect(screen.getByRole('status')).toHaveTextContent('模型选择尚未启用')
  expect(screen.queryByRole('radio')).not.toBeInTheDocument()
})

it('locks controls to the active request instead of displaying the next-turn preference', () => {
  const selection = state()
  render(<ModelSelectionSettings state={selection} disabled activeRequest={{ message: '继续', model_id: 'gpt-6-luna', reasoning_effort: 'low' }} />)
  fireEvent.click(screen.getByRole('button', { name: /GPT 6 Luna · 低/ }))
  expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '0')
  expect(screen.getByRole('slider')).toHaveAttribute('aria-disabled', 'true')
  expect(screen.getByRole('radio')).toBeDisabled()
  fireEvent.keyDown(screen.getByRole('slider'), { key: 'End' })
  fireEvent.click(screen.getByRole('button', { name: '高' }))
  expect(selection.onChange).not.toHaveBeenCalled()
  expect(screen.getByText('当前回合进行中，结束后可调整。')).toBeVisible()
})

it('preserves active server defaults instead of showing the next-turn catalog preference', () => {
  render(<ModelSelectionSettings state={state()} disabled activeRequest={{ message: '继续' }} />)
  fireEvent.click(screen.getByRole('button', { name: /本轮沿用原设置/ }))
  expect(screen.getByRole('status')).toHaveTextContent('本轮沿用服务端默认设置')
  expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  expect(screen.queryByRole('slider')).not.toBeInTheDocument()
})

it('does not substitute a catalog model when a resumed request uses an unavailable model', () => {
  render(<ModelSelectionSettings state={state()} disabled activeRequest={{ message: '继续', model_id: 'retired-model', reasoning_effort: 'high' }} />)
  fireEvent.click(screen.getByRole('button', { name: /本轮沿用原设置/ }))
  expect(screen.getByRole('status')).toHaveTextContent('恢复中的回合沿用原模型和强度')
  expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  expect(screen.queryByRole('slider')).not.toBeInTheDocument()
})
