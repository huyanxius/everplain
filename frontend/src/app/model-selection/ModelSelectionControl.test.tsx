import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelSelectionControl } from './ModelSelectionControl'
import { DEFAULT_MODEL_SELECTION, MODEL_CATALOG, type ModelSelection } from './modelSelection'

afterEach(cleanup)

function ControlledSelection() {
  const [value, setValue] = useState(DEFAULT_MODEL_SELECTION)
  return <ModelSelectionControl value={value} onChange={setValue} />
}

describe('ModelSelectionControl', () => {
  it('shows only GPT 6 Luna in the shared custom model menu', () => {
    render(<ControlledSelection />)
    const model = screen.getByRole('combobox', { name: '模型' })
    expect(model.tagName).toBe('BUTTON')
    expect(model).toHaveTextContent('GPT 6 Luna')
    fireEvent.click(model)
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('option')).toHaveTextContent('GPT 6 Luna')
  })

  it('uses a labeled native range with discrete legal stops and spoken value', () => {
    render(<ControlledSelection />)
    const slider = screen.getByRole('slider', { name: '思考强度' })
    expect(slider).toHaveAttribute('min', '0')
    expect(slider).toHaveAttribute('max', '5')
    expect(slider).toHaveAttribute('step', '1')
    expect(slider).toHaveValue('2')
    expect(slider).toHaveAttribute('aria-valuetext', '中')
    fireEvent.change(slider, { target: { value: '4' } })
    expect(slider).toHaveValue('4')
    expect(slider).toHaveAttribute('aria-valuetext', '很高')
    fireEvent.change(slider, { target: { value: '0' } })
    expect(slider).toHaveAttribute('aria-valuetext', '无')
    fireEvent.change(slider, { target: { value: '5' } })
    expect(slider).toHaveAttribute('aria-valuetext', '最高')
  })

  it('does not mutate selection while a turn is busy', () => {
    const onChange = vi.fn()
    render(<ModelSelectionControl value={DEFAULT_MODEL_SELECTION} onChange={onChange} disabled />)
    expect(screen.getByRole('combobox')).toBeDisabled()
    expect(screen.getByRole('slider')).toBeDisabled()
    fireEvent.change(screen.getByRole('slider'), { target: { value: '5' } })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('fails closed for unknown persisted models or unsupported efforts', () => {
    const onChange = vi.fn()
    const { rerender } = render(<ModelSelectionControl value={{ ...DEFAULT_MODEL_SELECTION, modelId: 'unknown' }} onChange={onChange} />)
    expect(screen.getByRole('slider')).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('请选择可用的模型和强度')
    rerender(<ModelSelectionControl value={{ ...DEFAULT_MODEL_SELECTION, reasoningEffort: 'minimal' } as unknown as ModelSelection} onChange={onChange} />)
    expect(screen.getByRole('slider')).toBeDisabled()
    fireEvent.change(screen.getByRole('slider'), { target: { value: '3' } })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('option', { name: 'GPT 6 Luna' }))
    expect(onChange).toHaveBeenCalledWith(DEFAULT_MODEL_SELECTION)
  })

  it('adapts legal stops to an injected future catalog, rather than a global effort range', () => {
    render(<ModelSelectionControl value={DEFAULT_MODEL_SELECTION} catalog={[{ ...MODEL_CATALOG[0], reasoningEfforts: ['low', 'medium', 'high'] }]} onChange={vi.fn()} />)
    expect(screen.getByRole('slider')).toHaveAttribute('max', '2')
    expect(screen.getByRole('slider')).toHaveValue('1')
  })

  it('does not submit an enclosing composer when opening the model menu', () => {
    const submit = vi.fn(event => event.preventDefault())
    render(<form onSubmit={submit}><ControlledSelection /></form>)
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('option'))
    expect(submit).not.toHaveBeenCalled()
  })
})
