// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FoundationAgentReveal } from './FoundationAgentReveal'

vi.mock('@paper-design/shaders-react', () => ({
  ShaderMount: ({ className }: { className?: string }) => <div className={className} />,
}))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function renderReveal() {
  return render(
    <MemoryRouter>
      <FoundationAgentReveal />
    </MemoryRouter>,
  )
}

describe('FoundationAgentReveal', () => {
  it('cycles complete research questions with character-level motion', () => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', () => ({ matches: false }))

    const { container } = renderReveal()
    const question = container.querySelector<HTMLElement>('[data-research-question]')

    expect(screen.queryByText('研究 Agent')).not.toBeInTheDocument()
    expect(question).toHaveTextContent('帮我比较这两份产品方案的差异')
    expect(question?.dataset.copyPhase).toBe('entering')
    expect(question?.querySelectorAll('.foundation-agent__glyph')).toHaveLength(14)

    act(() => vi.advanceTimersByTime(959))
    expect(question?.dataset.copyPhase).toBe('entering')

    act(() => vi.advanceTimersByTime(1))
    expect(question?.dataset.copyPhase).toBe('resting')

    act(() => vi.advanceTimersByTime(2_780))
    expect(question?.dataset.copyPhase).toBe('exiting')
    expect(question).toHaveTextContent('帮我比较这两份产品方案的差异')

    act(() => vi.advanceTimersByTime(459))
    expect(question?.dataset.copyPhase).toBe('exiting')
    expect(question).toHaveTextContent('帮我比较这两份产品方案的差异')

    act(() => vi.advanceTimersByTime(1))

    expect(question).toHaveTextContent('从我的阅读笔记里找到反对意见')
    expect(question?.dataset.copyPhase).toBe('entering')
  })

  it('replaces the question cycle with the characters the visitor types', () => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', () => ({ matches: false }))

    const { container } = renderReveal()
    const input = screen.getByRole('textbox', { name: '输入你的研究问题' })

    fireEvent.change(input, { target: { value: '这两份报告有哪些相同观点？' } })

    const question = container.querySelector<HTMLElement>('[data-research-question]')
    expect(input).toHaveValue('这两份报告有哪些相同观点？')
    expect(question?.dataset.copyMode).toBe('input')
    expect(question).toHaveTextContent('这两份报告有哪些相同观点？')
    expect(question).not.toHaveTextContent('帮我比较这两份产品方案的差异')

    fireEvent.scroll(input, { target: { scrollLeft: 96 } })
    expect(question).toHaveStyle({ transform: 'translate3d(-96px, 0, 0)' })

    act(() => vi.advanceTimersByTime(8_400))
    expect(question).toHaveTextContent('这两份报告有哪些相同观点？')
  })
})
