import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ModelSelectionSettings } from './ModelSelectionSettings'
import type { AgentModelSelectionState } from './useAgentModelSelection'
import { AppLocaleProvider } from '../../i18n/AppLocaleProvider'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals() })
const state = (): AgentModelSelectionState => ({
  owner: 'owner', status: 'ready', runtimeMode: 'base',
  catalog: [{ id: 'gpt-6-luna', label: 'GPT 6 Luna', reasoningEfforts: ['low', 'medium', 'high'], defaultReasoningEffort: 'medium' }],
  selection: { modelId: 'gpt-6-luna', reasoningEffort: 'medium' },
  onChange: vi.fn(), retry: vi.fn(), requestFields: () => ({}),
})

it.each([
  ['enabled', '开启', 'On'],
  ['minimal', '极低', 'Minimal'],
] as const)('renders the legal %s effort consistently in both summary and control', (effort, zh, en) => {
  const selection: AgentModelSelectionState = {
    ...state(),
    catalog: [{ id: 'native', label: 'Native', reasoningEfforts: ['none', effort], defaultReasoningEffort: effort }],
    selection: { modelId: 'native', reasoningEffort: effort },
  }
  const oldLocale = window.localStorage.getItem('qunxue.interface-locale')
  try {
    for (const [locale, label, prefix, sliderName] of [
      ['zh-CN', zh, '模型与思考强度', '思考强度'],
      ['en-US', en, 'Model and reasoning effort', 'Reasoning effort'],
    ]) {
      window.localStorage.setItem('qunxue.interface-locale', locale)
      const view = render(<AppLocaleProvider><ModelSelectionSettings state={selection} disabled={false} /></AppLocaleProvider>)
      const summary = screen.getByRole('button', { name: `${prefix}：Native · ${label}` })
      expect(summary).toBeVisible()
      fireEvent.click(summary)
      expect(screen.getByRole('slider', { name: sliderName })).toHaveAttribute('aria-valuetext', label)
      view.rerender(<AppLocaleProvider><ModelSelectionSettings state={selection} disabled activeRequest={{ message: 'synthetic', model_id: 'native', reasoning_effort: effort }} /></AppLocaleProvider>)
      expect(summary).toHaveAccessibleName(`${prefix}：Native · ${label}`)
      expect(screen.getByRole('slider', { name: sliderName })).toHaveAttribute('aria-disabled', 'true')
      view.unmount()
    }
  } finally {
    if (oldLocale === null) window.localStorage.removeItem('qunxue.interface-locale')
    else window.localStorage.setItem('qunxue.interface-locale', oldLocale)
  }
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
  expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '选择模型：GPT 6 Luna · 中' })).toHaveFocus()
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
  expect(screen.getByRole('button', { name: '选择模型：GPT 6 Luna · 中' })).toHaveFocus()
  fireEvent.click(summary)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('keeps the model popover inside a narrow conversation pane on a wide viewport and follows resizing', () => {
  let paneWidth = 320
  const original = HTMLElement.prototype.getBoundingClientRect
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('cv-layout__main')) return { x: 700, y: 0, left: 700, right: 700 + paneWidth, top: 0, bottom: 768, width: paneWidth, height: 768, toJSON: () => ({}) }
    if (this.classList.contains('model-selection-settings__summary')) return { x: 800, y: 400, left: 800, right: 980, top: 400, bottom: 432, width: 180, height: 32, toJSON: () => ({}) }
    return original.call(this)
  })
  render(<div className="cv-layout__main"><ModelSelectionSettings state={state()} disabled={false} /></div>)
  fireEvent.click(screen.getByRole('button', { name: /GPT 6 Luna · 中/ }))
  expect(screen.getByRole('dialog')).toHaveStyle({ width: '296px', left: '712px' })
  paneWidth = 240
  fireEvent.resize(window)
  expect(screen.getByRole('dialog')).toHaveStyle({ width: '216px', left: '712px' })
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.getByRole('button', { name: /GPT 6 Luna · 中/ })).toHaveFocus()
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
  expect(screen.getByRole('radio', { hidden: true })).toBeDisabled()
  expect(screen.getByRole('button', { name: '选择模型：GPT 6 Luna · 低' })).toBeDisabled()
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

it('retains the native popover through exit and cancels removal when reopened', () => {
  vi.useFakeTimers()
  const hide = vi.spyOn(HTMLElement.prototype, 'hidePopover')
  render(<ModelSelectionSettings state={state()} disabled={false} />)
  const trigger = screen.getByRole('button', { name: /GPT 6 Luna · 中/ })
  fireEvent.click(trigger)
  const panel = screen.getByRole('dialog')
  panel.style.transitionProperty = 'opacity, transform'
  panel.style.transitionDuration = '0.14s'
  panel.style.transitionDelay = '0s'
  fireEvent.click(trigger)
  expect(panel).toBeInTheDocument()
  expect(panel).toHaveAttribute('data-presence', 'closing')
  expect(panel).toHaveAttribute('inert')
  expect(panel).toHaveAttribute('aria-hidden', 'true')
  expect(hide).not.toHaveBeenCalled()
  fireEvent.click(trigger)
  expect(screen.getByRole('dialog')).toBe(panel)
  expect(panel).toHaveAttribute('data-presence', 'open')
  expect(panel).not.toHaveAttribute('inert')
  act(() => vi.advanceTimersByTime(500))
  expect(panel).toBeInTheDocument()
  expect(hide).not.toHaveBeenCalled()
  fireEvent.keyDown(document, { key: 'Escape' })
  act(() => vi.advanceTimersByTime(200))
  expect(panel).not.toBeInTheDocument()
  expect(hide).toHaveBeenCalledOnce()
  expect(trigger).toHaveFocus()
})


it.each([null, undefined])('locks a resumed no-effort model with %s effort to the original turn', reasoning_effort => {
  const selection = state()
  selection.catalog = [...selection.catalog, { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', reasoningEfforts: [], defaultReasoningEffort: null }]
  const view = render(<ModelSelectionSettings state={selection} disabled activeRequest={{ message: '继续', model_id: 'gemini-3.5-flash', reasoning_effort }} />)
  const summary = screen.getByRole('button', { name: '模型与思考强度：Gemini 3.5 Flash' })
  expect(summary.querySelector('.model-selection-settings__summary-effort')).toBeNull()
  fireEvent.click(summary)
  expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  const radios = screen.getAllByRole('radio', { hidden: true })
  expect(radios.find(element => element.textContent?.trim() === 'Gemini 3.5 Flash')).toHaveAttribute('aria-checked', 'true')
  expect(radios.find(element => element.textContent?.trim() === 'Gemini 3.5 Flash')).toBeDisabled()
  fireEvent.click(radios.find(element => element.textContent?.trim() === 'GPT 6 Luna')!)
  expect(selection.onChange).not.toHaveBeenCalled()
  view.rerender(<ModelSelectionSettings state={selection} disabled={false} />)
  expect(screen.getByRole('button', { name: '模型与思考强度：GPT 6 Luna · 中' })).toBeVisible()
})


it('handles Escape one layer at a time and keeps focus on the active controls', () => {
  render(<ModelSelectionSettings state={state()} disabled={false} />)
  const trigger = screen.getByRole('button', { name: '模型与思考强度：GPT 6 Luna · 中' })
  fireEvent.click(trigger)
  const top = screen.getByRole('button', { name: '选择模型：GPT 6 Luna · 中' })
  expect(top).toHaveFocus()
  fireEvent.click(top)
  const current = screen.getByRole('radio', { name: 'GPT 6 Luna' })
  expect(current).toHaveFocus()
  fireEvent.keyDown(current, { key: 'Escape' })
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  expect(top).toHaveFocus()
  fireEvent.keyDown(top, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
})

it('returns model selection to the summary on reopening during retained exit', () => {
  vi.useFakeTimers()
  render(<ModelSelectionSettings state={state()} disabled={false} />)
  const trigger = screen.getByRole('button', { name: '模型与思考强度：GPT 6 Luna · 中' })
  fireEvent.click(trigger)
  const panel = screen.getByRole('dialog')
  panel.style.transitionProperty = 'opacity, transform'
  panel.style.transitionDuration = '0.14s'
  panel.style.transitionDelay = '0s'
  fireEvent.click(screen.getByRole('button', { name: '选择模型：GPT 6 Luna · 中' }))
  expect(screen.getByRole('radio')).toHaveFocus()
  fireEvent.pointerDown(document.body)
  expect(panel).toHaveAttribute('data-presence', 'closing')
  fireEvent.click(trigger)
  expect(screen.getByRole('dialog')).toBe(panel)
  expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '选择模型：GPT 6 Luna · 中' })).toHaveFocus()
  act(() => vi.advanceTimersByTime(500))
  expect(panel).toBeInTheDocument()
})

it('focuses the dialog instead of an inactive back button when the running controls are disabled', () => {
  render(<ModelSelectionSettings state={state()} disabled activeRequest={{ message: '继续', model_id: 'gpt-6-luna', reasoning_effort: 'low' }} />)
  fireEvent.click(screen.getByRole('button', { name: '模型与思考强度：GPT 6 Luna · 低' }))
  expect(screen.getByRole('dialog')).toHaveFocus()
  expect(screen.queryByRole('radio')).not.toBeInTheDocument()
})
