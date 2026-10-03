import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Select } from './Select'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const options = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta', disabled: true }, { value: 'g', label: 'Gamma' }, { value: 'd', label: 'Delta' }]

function Example({ multiple = false }: { multiple?: boolean }) {
  const [single, setSingle] = useState('a')
  const [several, setSeveral] = useState<string[]>(['a'])
  return multiple
    ? <Select aria-label="Example" options={options} multiple value={several} onChange={setSeveral} />
    : <Select aria-label="Example" options={options} value={single} onChange={setSingle} />
}

describe('Select', () => {
  it('uses a custom, labelled combobox with selected state and no native select', () => {
    const { container } = render(<Example />)
    const trigger = screen.getByRole('combobox', { name: 'Example' })
    expect(container.querySelector('select')).toBeNull()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(trigger).toHaveAttribute('aria-controls', screen.getByRole('listbox').id)
    expect(screen.getByRole('option', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('option', { name: 'Beta' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('selects the real value, closes, and restores trigger focus', () => {
    render(<Example />)
    const trigger = screen.getByRole('combobox')
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('option', { name: 'Gamma' }))
    expect(trigger).toHaveTextContent('Gamma')
    expect(trigger).toHaveValue('g')
    expect(trigger).toHaveFocus()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('does not emit changes for disabled or already selected options', () => {
    const onChange = vi.fn()
    render(<Select aria-label="Example" options={options} value="a" onChange={onChange} />)
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('option', { name: 'Beta' }))
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('option', { name: 'Alpha' }))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('navigates enabled options with arrows and Home/End, then commits with Enter', () => {
    render(<Example />)
    const trigger = screen.getByRole('combobox')
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(trigger).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'Alpha' }).id)
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(trigger).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'Gamma' }).id)
    fireEvent.keyDown(trigger, { key: 'End' })
    expect(trigger).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'Delta' }).id)
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(trigger).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'Alpha' }).id)
    fireEvent.keyDown(trigger, { key: 'End' })
    fireEvent.keyDown(trigger, { key: 'Home' })
    fireEvent.keyDown(trigger, { key: 'ArrowUp' })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(trigger).toHaveTextContent('Delta')
    expect(trigger).toHaveFocus()
  })

  it('dismisses Escape without committing and keeps focus on the trigger', () => {
    render(<Example />)
    const trigger = screen.getByRole('combobox')
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(trigger).toHaveTextContent('Alpha')
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('dismisses outside interaction and Tab without trapping focus', () => {
    render(<><Example /><button>Outside</button></>)
    const trigger = screen.getByRole('combobox')
    fireEvent.click(trigger)
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }))
    screen.getByRole('button', { name: 'Outside' }).focus()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Outside' })).toHaveFocus()
    fireEvent.click(trigger)
    expect(fireEvent.keyDown(trigger, { key: 'Tab' })).toBe(true)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('supports typeahead without changing the controlled value before confirmation', () => {
    render(<Example />)
    const trigger = screen.getByRole('combobox')
    fireEvent.keyDown(trigger, { key: 'g' })
    fireEvent.keyDown(trigger, { key: 'a' })
    expect(trigger).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'Gamma' }).id)
    expect(trigger).toHaveTextContent('Alpha')
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(trigger).toHaveTextContent('Gamma')
  })

  it('closes when disabled and cannot reopen until enabled', () => {
    const { rerender } = render(<Select options={options} value="a" onChange={() => {}} />)
    fireEvent.click(screen.getByRole('combobox'))
    rerender(<Select options={options} value="a" onChange={() => {}} disabled />)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox')).toBeDisabled()
    fireEvent.click(screen.getByRole('combobox'))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('toggles multiple selections without requiring modifier keys or closing', () => {
    render(<Example multiple />)
    const trigger = screen.getByRole('combobox')
    fireEvent.click(trigger)
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-multiselectable', 'true')
    fireEvent.click(screen.getByRole('option', { name: 'Gamma' }))
    expect(screen.getByRole('option', { name: 'Gamma' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('option', { name: 'Alpha' }))
    expect(screen.getByRole('option', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'false')
    fireEvent.keyDown(trigger, { key: 'Home' })
    fireEvent.keyDown(trigger, { key: ' ' })
    expect(screen.getByRole('option', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'true')
    expect(trigger).toHaveTextContent('Alpha、Gamma')
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(trigger).toHaveFocus()
  })

  it('preserves numeric values and native form validation/submission', () => {
    const { container, rerender } = render(<form><Select name="zoom" aria-label="Zoom" required value="" options={[{ value: '', label: 'Choose' }, { value: 125, label: '125%' }]} onChange={() => {}} /></form>)
    const form = container.querySelector('form')!
    expect(form.checkValidity()).toBe(false)
    fireEvent.invalid(container.querySelector('input')!)
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('combobox')).toHaveFocus()
    expect(screen.getByRole('alert')).toHaveTextContent('请选择一项')
    rerender(<form><Select name="zoom" aria-label="Zoom" required value={125} options={[{ value: 125, label: '125%' }]} onChange={() => {}} /></form>)
    expect(form.checkValidity()).toBe(true)
    expect(new FormData(form).get('zoom')).toBe('125')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('submits multiple selected values as repeated form entries', () => {
    const { container } = render(<form><Select name="sources" multiple required value={['a', 'g']} options={options} onChange={() => {}} /></form>)
    const form = container.querySelector('form')!
    expect(form.checkValidity()).toBe(true)
    expect(new FormData(form).getAll('sources')).toEqual(['a', 'g'])
  })


  it('emits multiple selections in option order and validates empty required selections', () => {
    const onChange = vi.fn()
    const { container, rerender } = render(<form><Select multiple required options={options} value={['g']} onChange={onChange} /></form>)
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('option', { name: 'Alpha' }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith(['a', 'g'])
    rerender(<form><Select multiple required options={options} value={[]} onChange={onChange} /></form>)
    expect(container.querySelector('form')!.checkValidity()).toBe(false)
    fireEvent.invalid(container.querySelector('input')!)
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-invalid', 'true')
  })

  it('does not treat a missing option as a valid required selection', () => {
    const { container } = render(<form><Select required options={options} value="removed" onChange={() => {}} /></form>)
    expect(container.querySelector('form')!.checkValidity()).toBe(false)
  })


  it('positions within the visual viewport and follows keyboard resize and viewport panning', () => {
    const viewport = Object.assign(new EventTarget(), { width: 320, height: 300, offsetLeft: 20, offsetTop: 100 })
    vi.stubGlobal('visualViewport', viewport)
    const addListener = vi.spyOn(viewport, 'addEventListener')
    const removeListener = vi.spyOn(viewport, 'removeEventListener')
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('role') === 'combobox' ? new DOMRect(270, 310, 200, 48) : new DOMRect()
    })
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(600)
    const { unmount } = render(<Example />)
    fireEvent.click(screen.getByRole('combobox'))
    const menu = screen.getByRole('listbox')
    expect(menu).toHaveStyle({ left: '88px', top: '112px', width: '240px', maxHeight: '190px' })
    viewport.height = 180
    act(() => viewport.dispatchEvent(new Event('resize')))
    expect(menu).toHaveStyle({ top: '112px', maxHeight: '156px' })
    viewport.offsetTop = 180
    viewport.offsetLeft = 40
    act(() => viewport.dispatchEvent(new Event('scroll')))
    expect(menu).toHaveStyle({ left: '108px', top: '192px', maxHeight: '110px' })
    expect(addListener).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(addListener).toHaveBeenCalledWith('scroll', expect.any(Function))
    unmount()
    expect(removeListener).toHaveBeenCalledWith('resize', addListener.mock.calls.find(([name]) => name === 'resize')![1])
    expect(removeListener).toHaveBeenCalledWith('scroll', addListener.mock.calls.find(([name]) => name === 'scroll')![1])
  })

  it('keeps desktop placement when visualViewport is unavailable', () => {
    vi.stubGlobal('visualViewport', undefined)
    vi.stubGlobal('innerWidth', 1024)
    vi.stubGlobal('innerHeight', 768)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('role') === 'combobox' ? new DOMRect(120, 100, 260, 40) : new DOMRect()
    })
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(120)
    render(<Example />)
    fireEvent.click(screen.getByRole('combobox'))
    expect(screen.getByRole('listbox')).toHaveStyle({ left: '120px', top: '148px', width: '260px', maxHeight: '320px' })
  })

  it('scrolls only the menu to keep the active option visible after a keyboard resize', () => {
    const viewport = Object.assign(new EventTarget(), { width: 320, height: 600, offsetLeft: 0, offsetTop: 0 })
    vi.stubGlobal('visualViewport', viewport)
    let menuHeight = 320
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute('role') === 'combobox') return new DOMRect(20, 400, 240, 48)
      if (this.getAttribute('role') === 'listbox') return new DOMRect(20, 12, 240, menuHeight)
      if (this.getAttribute('role') === 'option' && this.textContent === 'Delta') return new DOMRect(28, 272, 224, 44)
      return new DOMRect(28, 20, 224, 44)
    })
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(600)
    render(<Example />)
    const trigger = screen.getByRole('combobox')
    fireEvent.click(trigger)
    fireEvent.keyDown(trigger, { key: 'End' })
    const menu = screen.getByRole('listbox')
    expect(menu.scrollTop).toBe(0)
    menuHeight = 160
    viewport.height = 220
    act(() => viewport.dispatchEvent(new Event('resize')))
    expect(menu.scrollTop).toBe(144)
    expect(trigger).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'Delta' }).id)
  })

  it('works inside an implicit label without reopening after an option click', () => {
    render(<label>Choice<Example /></label>)
    const trigger = screen.getByRole('combobox')
    fireEvent.click(trigger)
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Gamma' }))
    expect(trigger).toHaveTextContent('Gamma')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
