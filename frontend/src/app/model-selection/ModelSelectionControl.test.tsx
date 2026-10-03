import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelSelectionControl } from './ModelSelectionControl'
import { DEFAULT_MODEL_SELECTION, MODEL_CATALOG, type ModelDefinition, type ModelSelection } from './modelSelection'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function ControlledSelection({ catalog = MODEL_CATALOG, initial = DEFAULT_MODEL_SELECTION, onChange }: {
  catalog?: readonly ModelDefinition[]
  initial?: ModelSelection
  onChange?: (value: ModelSelection) => void
}) {
  const [value, setValue] = useState(initial)
  return <ModelSelectionControl value={value} catalog={catalog} onChange={next => { setValue(next); onChange?.(next) }} />
}

function pointer(target: HTMLElement, type: string, clientX: number, pointerId = 1, button = 0) {
  const event = new MouseEvent(type, { bubbles: true, clientX, button })
  Object.defineProperties(event, { pointerId: { value: pointerId }, isPrimary: { value: true } })
  fireEvent(target, event)
}
function measureTrack(slider: HTMLElement) {
  vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({ left: 100, right: 300, width: 200 } as DOMRect)
}

describe('ModelSelectionControl', () => {
  it('shows catalog models directly as radio rows without a nested dropdown or invented description', () => {
    render(<ControlledSelection />)
    const group = screen.getByRole('radiogroup', { name: '模型' })
    expect(within(group).getAllByRole('radio')).toHaveLength(1)
    expect(within(group).getByRole('radio', { name: 'GPT 6 Luna' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(group.querySelector('small')).toBeNull()
  })

  it('uses a labeled custom slider with discrete legal stops, keyboard controls, and stable focus', () => {
    render(<ControlledSelection />)
    const slider = screen.getByRole('slider', { name: '思考强度' })
    expect(slider.tagName).toBe('DIV')
    expect(slider).toHaveAttribute('aria-valuemin', '0')
    expect(slider).toHaveAttribute('aria-valuemax', '5')
    expect(slider).toHaveAttribute('aria-valuenow', '2')
    expect(slider).toHaveAttribute('aria-valuetext', '中')
    slider.focus()
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    fireEvent.keyDown(slider, { key: 'ArrowUp' })
    expect(slider).toHaveAttribute('aria-valuenow', '4')
    expect(slider).toHaveAttribute('aria-valuetext', '很高')
    expect(slider).toHaveFocus()
    fireEvent.keyDown(slider, { key: 'ArrowLeft' })
    fireEvent.keyDown(slider, { key: 'ArrowDown' })
    expect(slider).toHaveAttribute('aria-valuetext', '中')
    fireEvent.keyDown(slider, { key: 'Home' })
    fireEvent.keyDown(slider, { key: 'ArrowLeft' })
    expect(slider).toHaveAttribute('aria-valuenow', '0')
    expect(slider).toHaveAttribute('aria-valuetext', '无')
    fireEvent.keyDown(slider, { key: 'End' })
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(slider).toHaveAttribute('aria-valuenow', '5')
    expect(slider).toHaveAttribute('aria-valuetext', '最高')
    expect(slider).toHaveFocus()
  })

  it('lets each tick label choose its exact supported effort', () => {
    render(<ControlledSelection />)
    fireEvent.click(screen.getByRole('button', { name: '很高' }))
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', '很高')
    expect(screen.getByRole('button', { name: '很高' })).toHaveAttribute('data-on', 'true')
    fireEvent.click(screen.getByRole('button', { name: '低' }))
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '1')
  })

  it('previews pointer movement and commits only the nearest legal stop on release', () => {
    const onChange = vi.fn()
    render(<ControlledSelection onChange={onChange} />)
    const slider = screen.getByRole('slider')
    measureTrack(slider)
    pointer(slider, 'pointerdown', 140)
    expect(slider).toHaveAttribute('aria-valuenow', '1')
    expect(onChange).not.toHaveBeenCalled()
    pointer(slider, 'pointermove', 262)
    expect(slider).toHaveAttribute('aria-valuenow', '4')
    expect(slider.style.getPropertyValue('--model-effort-ratio')).toBe('0.81')
    expect(onChange).not.toHaveBeenCalled()
    pointer(slider, 'pointerup', 262)
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ modelId: 'gpt-6-luna', reasoningEffort: 'xhigh' })
    expect(slider.style.getPropertyValue('--model-effort-ratio')).toBe('0.8')
  })

  it('clamps pointer drags to endpoints and ignores another pointer or secondary mouse button', () => {
    const onChange = vi.fn()
    render(<ControlledSelection onChange={onChange} />)
    const slider = screen.getByRole('slider')
    measureTrack(slider)
    pointer(slider, 'pointerdown', 300, 1, 2)
    pointer(slider, 'pointerup', 300)
    expect(onChange).not.toHaveBeenCalled()
    pointer(slider, 'pointerdown', 80)
    pointer(slider, 'pointermove', 350, 2)
    pointer(slider, 'pointerup', 350, 2)
    expect(slider).toHaveAttribute('aria-valuenow', '0')
    expect(onChange).not.toHaveBeenCalled()
    pointer(slider, 'pointerup', 80)
    expect(onChange).toHaveBeenLastCalledWith({ modelId: 'gpt-6-luna', reasoningEffort: 'none' })
    pointer(slider, 'pointerdown', 350)
    pointer(slider, 'pointerup', 350)
    expect(onChange).toHaveBeenLastCalledWith({ modelId: 'gpt-6-luna', reasoningEffort: 'max' })
  })

  it.each(['pointercancel', 'lostpointercapture'])('abandons a drag after %s without changing the controlled selection', type => {
    const onChange = vi.fn()
    render(<ControlledSelection onChange={onChange} />)
    const slider = screen.getByRole('slider')
    measureTrack(slider)
    pointer(slider, 'pointerdown', 300)
    expect(slider).toHaveAttribute('aria-valuetext', '最高')
    pointer(slider, type, 300)
    expect(slider).toHaveAttribute('aria-valuetext', '中')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not mutate model or effort while a turn is busy', () => {
    const onChange = vi.fn()
    render(<ModelSelectionControl value={DEFAULT_MODEL_SELECTION} onChange={onChange} disabled />)
    const slider = screen.getByRole('slider')
    expect(screen.getByRole('radio')).toBeDisabled()
    expect(slider).toHaveAttribute('aria-disabled', 'true')
    expect(slider).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('button', { name: '最高' })).toBeDisabled()
    fireEvent.click(screen.getByRole('radio'))
    fireEvent.click(screen.getByRole('button', { name: '最高' }))
    fireEvent.keyDown(slider, { key: 'End' })
    measureTrack(slider)
    pointer(slider, 'pointerdown', 300)
    pointer(slider, 'pointerup', 300)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('discards an unfinished pointer drag when a turn becomes busy', () => {
    const onChange = vi.fn()
    const view = render(<ModelSelectionControl value={DEFAULT_MODEL_SELECTION} onChange={onChange} />)
    const slider = screen.getByRole('slider')
    measureTrack(slider)
    pointer(slider, 'pointerdown', 300)
    view.rerender(<ModelSelectionControl value={DEFAULT_MODEL_SELECTION} onChange={onChange} disabled />)
    pointer(screen.getByRole('slider'), 'pointerup', 300)
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', '中')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('fails closed for unknown persisted models or unsupported efforts and can recover through a real model row', () => {
    const onChange = vi.fn()
    const { rerender } = render(<ModelSelectionControl value={{ ...DEFAULT_MODEL_SELECTION, modelId: 'unknown' }} onChange={onChange} />)
    expect(screen.getByRole('slider')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('请选择可用的模型和强度')
    rerender(<ModelSelectionControl value={{ ...DEFAULT_MODEL_SELECTION, reasoningEffort: 'minimal' } as unknown as ModelSelection} onChange={onChange} />)
    expect(screen.getByRole('slider')).toHaveAttribute('aria-disabled', 'true')
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'End' })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('radio', { name: 'GPT 6 Luna' }))
    expect(onChange).toHaveBeenCalledWith(DEFAULT_MODEL_SELECTION)
  })

  it('uses catalog-specific stops and keyboard model navigation with a supported fallback', () => {
    const catalog: readonly ModelDefinition[] = [MODEL_CATALOG[0], { id: 'server-model', label: 'Server model', reasoningEfforts: ['low', 'high'], defaultReasoningEffort: 'low' }]
    render(<ControlledSelection catalog={catalog} />)
    const first = screen.getByRole('radio', { name: 'GPT 6 Luna' })
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    const second = screen.getByRole('radio', { name: 'Server model' })
    expect(second).toHaveFocus()
    expect(second).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuemax', '1')
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', '低')
    expect(screen.queryByRole('button', { name: '最高' })).not.toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'End' })
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', '高')
    fireEvent.keyDown(second, { key: 'Home' })
    expect(first).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', '高')
  })

  it('keeps an empty catalog and a single-stop catalog noninteractive', () => {
    const { rerender } = render(<ModelSelectionControl value={DEFAULT_MODEL_SELECTION} catalog={[]} onChange={vi.fn()} />)
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuemax', '0')
    expect(screen.getByRole('slider')).toHaveAttribute('aria-disabled', 'true')
    rerender(<ModelSelectionControl value={DEFAULT_MODEL_SELECTION} catalog={[{ ...MODEL_CATALOG[0], reasoningEfforts: ['medium'] }]} onChange={vi.fn()} />)
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', '中')
    expect(screen.getByRole('slider')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not submit an enclosing composer when selecting a model or effort', () => {
    const submit = vi.fn(event => event.preventDefault())
    render(<form onSubmit={submit}><ControlledSelection /></form>)
    fireEvent.click(screen.getByRole('radio'))
    fireEvent.click(screen.getByRole('button', { name: '高' }))
    expect(submit).not.toHaveBeenCalled()
  })
})
