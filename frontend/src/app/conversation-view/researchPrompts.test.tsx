import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { conversationDaypart, conversationGreeting, conversationGreetingPresets, useConversationGreeting } from './researchPrompts'
const local = (hour: number, minute = 0) => new Date(2026, 9, 3, hour, minute)
afterEach(() => { cleanup(); vi.useRealTimers(); sessionStorage.clear() })
describe('time-aware greeting', () => {
  it.each([[0, 'night'], [5, 'night'], [6, 'morning'], [10, 'morning'], [11, 'noon'], [13, 'noon'], [14, 'afternoon'], [17, 'afternoon'], [18, 'evening'], [22, 'evening'], [23, 'night']] as const)('uses local hour %i for %s', (hour, part) => {
    expect(conversationDaypart(local(hour))).toBe(part)
  })
  it('uses selected bilingual candidates and stays stable within a local daypart', () => {
    expect(new Set(Object.values(conversationGreetingPresets).flat().map(item => item.zh)).size).toBe(8)
    expect(conversationGreeting('zh-CN', local(18))).toBe(conversationGreeting('zh-CN', local(22, 59)))
    expect(conversationGreeting('en-US', local(23))).not.toMatch(/[\u4e00-\u9fff]/)
    const seen = new Set(Array.from({ length: 12 }, (_, index) => conversationGreeting('zh-CN', new Date(2026, 9, 3 + index, 23))))
    expect(seen.size).toBe(4)
    expect(seen.has('月亮值班中。')).toBe(true)
  })
  it('reserves the return greeting for users with real conversation history', () => {
    const dates = Array.from({ length: 12 }, (_, index) => new Date(2026, 9, 3 + index, 8))
    for (const greeting of ['你回来啦。', '别来无恙。']) {
      expect(dates.map(date => conversationGreeting('zh-CN', date))).not.toContain(greeting)
      expect(dates.map(date => conversationGreeting('zh-CN', date, true))).toContain(greeting)
    }
  })
  it('can select exactly the ten approved Chinese phrases, without unselected candidates', () => {
    const seen = new Set([8, 12, 15, 20, 23].flatMap(hour => Array.from({ length: 30 }, (_, day) => conversationGreeting('zh-CN', new Date(2026, 9, day + 1, hour), true))))
    expect([...seen].sort()).toEqual(['偷得浮生半日闲。', '月亮值班中。', '夜猫子，集合。', '你回来啦。', '太阳已到岗。', '来啦。', '这么巧，你也在。', '今晚我值班。', '别来无恙。', '恭候多时。'].sort())
  })
  it('changes at a time boundary without waiting for a user render', () => {
    vi.useFakeTimers()
    vi.setSystemTime(local(17, 59))
    function Greeting() { return <h1>{useConversationGreeting('zh-CN')}</h1> }
    const { rerender, unmount } = render(<Greeting />)
    expect(screen.getByRole('heading')).toHaveTextContent(conversationGreeting('zh-CN', local(17)))
    rerender(<Greeting />)
    expect(screen.getByRole('heading')).toHaveTextContent(conversationGreeting('zh-CN', local(17)))
    act(() => vi.advanceTimersByTime(60000))
    expect(screen.getByRole('heading')).toHaveTextContent(conversationGreeting('zh-CN', local(18)))
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('refreshes after a sleeping tab returns to focus', () => {
    vi.useFakeTimers()
    vi.setSystemTime(local(8))
    function Greeting() { return <h1>{useConversationGreeting('zh-CN')}</h1> }
    render(<Greeting />)
    vi.setSystemTime(local(23))
    act(() => window.dispatchEvent(new Event('focus')))
    expect(screen.getByRole('heading')).toHaveTextContent(conversationGreeting('zh-CN', local(23)))
  })
})


it('pairs home and new conversation after history loads and across locale changes', () => {
  vi.useFakeTimers(); vi.setSystemTime(local(8))
  function Greeting({ history, ready, locale = 'zh-CN' }: { history: boolean; ready: boolean; locale?: 'zh-CN' | 'en-US' }) {
    return <h1>{useConversationGreeting(locale, history, 'paired-owner', ready)}</h1>
  }
  const home = render(<Greeting history={false} ready={false} />)
  home.rerender(<Greeting history ready />)
  const settled = screen.getByRole('heading').textContent
  expect(settled).toBe(conversationGreeting('zh-CN', local(8), true))
  home.unmount()
  const agent = render(<Greeting history={false} ready={false} />)
  expect(screen.getByRole('heading')).toHaveTextContent(settled!)
  agent.rerender(<Greeting history ready />)
  expect(screen.getByRole('heading')).toHaveTextContent(settled!)
  agent.rerender(<Greeting history ready locale="en-US" />)
  expect(screen.getByRole('heading')).toHaveTextContent(conversationGreeting('en-US', local(8), true))
})

it('isolates paired greetings by account and refreshes on the next daypart', () => {
  vi.useFakeTimers(); vi.setSystemTime(local(17, 59))
  function Greeting({ owner, history }: { owner: string; history: boolean }) {
    return <h1>{useConversationGreeting('zh-CN', history, owner)}</h1>
  }
  const view = render(<Greeting owner="one" history />)
  view.rerender(<Greeting owner="two" history={false} />)
  expect(screen.getByRole('heading')).toHaveTextContent(conversationGreeting('zh-CN', local(17), false))
  act(() => vi.advanceTimersByTime(60000))
  expect(screen.getByRole('heading')).toHaveTextContent(conversationGreeting('zh-CN', local(18), false))
})
