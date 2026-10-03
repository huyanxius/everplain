import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConversationSuggestions } from './ConversationSuggestions'
afterEach(() => { cleanup(); vi.useRealTimers() })
describe('ConversationSuggestions', () => {
  it('keeps the question and suggestions still until the user changes them', () => {
    vi.useFakeTimers()
    render(<ConversationSuggestions onSelect={vi.fn()} />)
    act(() => vi.advanceTimersByTime(60000))
    fireEvent.click(screen.getByText('问题示例'))
    expect(screen.getByRole('button', { name: '比较这两份产品方案的关键差异' })).toBeVisible()
  })
  it('selects a complete preset without sending it automatically', () => {
    const onSelect = vi.fn()
    render(<ConversationSuggestions onSelect={onSelect} />)
    fireEvent.click(screen.getByText('问题示例'))
    fireEvent.click(screen.getByRole('button', { name: '比较这两份产品方案的关键差异' }))
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('比较这两份产品方案的关键差异')
  })
  it('keeps all twenty presets reachable and wraps to the first group', () => {
    render(<ConversationSuggestions onSelect={vi.fn()} />)
    fireEvent.click(screen.getByText('问题示例'))
    const seen = new Set<string>()
    for (let group = 0; group < 5; group += 1) {
      screen.getAllByRole('button').filter(button => button.textContent !== '换一组').forEach(button => seen.add(button.textContent ?? ''))
      fireEvent.click(screen.getByRole('button', { name: '换一组' }))
    }
    expect(seen.size).toBe(20)
    expect(seen.has('沿着上次的研究继续推进')).toBe(true)
    expect(screen.getByRole('button', { name: '比较这两份产品方案的关键差异' })).toBeVisible()
  })
})
