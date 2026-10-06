import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConversationThread } from './ConversationThread'
import type { ConversationTurnView } from './types'

afterEach(cleanup)

const contextCard = { title: '核对迁移窗口', description: '周五分批迁移，保留旧入口。' }
const turn: ConversationTurnView = { id: 'question-layout', question: '', answer: '', citations: [] }

describe('user question layout structure and CSS contracts (not browser geometry)', () => {
  it('anchors the percentage-sized bubble to the full message row', () => {
    const css = readFileSync(resolve('src/app/conversation-view/context-card.css'), 'utf8')
    const declarations = css.split('.cv-turn__question-content {')[1]?.split('}')[0] ?? ''
    // Without a definite row width, this flex child's intrinsic grid width is
    // measured from the text, then the bubble is capped to 80% of that width.
    expect(declarations).toMatch(/(?:^|;)\s*width:\s*100%\s*;/)
    expect(declarations).toContain('min-width: 0')
    expect(declarations).toContain('max-width: 100%')
    expect(declarations).toContain('justify-items: end')

    const components = readFileSync(resolve('src/styles/components.css'), 'utf8')
    const bubble = components.split('.qx-bubble {')[1]?.split('}')[0] ?? ''
    expect(bubble).toContain('max-width: min(80%, 36rem)')
    const conversation = readFileSync(resolve('src/app/conversation-view/conversation-view.css'), 'utf8')
    const text = conversation.split('.cv-turn__question .qx-bubble {')[1]?.split('}')[0] ?? ''
    expect(text).toContain('white-space: pre-wrap')
    expect(text).toContain('overflow-wrap: anywhere')
  })

  it.each([
    ['short Chinese', '看看我的知识库'],
    ['short Latin', 'Review my library'],
    ['long unbroken text', 'knowledge'.repeat(80)],
    ['explicit line breaks', '第一行\n第二行'],
  ])('preserves %s in the row-width wrapper', (_, question) => {
    const { container } = render(<ConversationThread turns={[{ ...turn, question }]} onSelectCitation={vi.fn()} />)
    const row = container.querySelector('[data-role="user-message"]')!
    expect(row.querySelector(':scope > .cv-turn__question-content > .qx-bubble')?.textContent).toBe(question)
    expect(row.querySelector('.cv-context-card')).not.toBeInTheDocument()
  })

  it('keeps a context card and its extra question as separate right-aligned items', () => {
    const question = `${contextCard.title}\n${contextCard.description}\n\n只比较两种方案。`
    const { container } = render(<ConversationThread turns={[{ ...turn, question, contextCard }]} onSelectCitation={vi.fn()} />)
    const content = container.querySelector('.cv-turn__question-content')!
    expect(content.children).toHaveLength(2)
    expect(content.firstElementChild).toHaveClass('cv-context-card')
    expect(content.lastElementChild).toHaveClass('qx-bubble')
    expect(content.lastElementChild?.textContent).toBe('只比较两种方案。')
    expect(screen.getByText(contextCard.title)).toBeVisible()
  })

  it('does not add an empty bubble for a card-only message', () => {
    const question = `${contextCard.title}\n${contextCard.description}`
    const { container } = render(<ConversationThread turns={[{ ...turn, question, contextCard }]} onSelectCitation={vi.fn()} />)
    expect(container.querySelector('.cv-turn__question-content > .cv-context-card')).toBeInTheDocument()
    expect(container.querySelector('[data-role="user-message"] .qx-bubble')).not.toBeInTheDocument()
  })
})
