import { describe, expect, it } from 'vitest'
import { isContinuousResearchTransition } from './route-motion-model'

describe('continuous research canvas transitions', () => {
  it.each([
    ['/research/new', '/research/task-a/workspace'],
    ['/research/task-a', '/research/task-a/workspace'],
    ['/research/task-a/workspace', '/research/task-a/workspace/notes'],
    ['/research/task-a/phenomenon', '/research/task-a/match'],
  ])('keeps %s → %s continuous', (from, to) => {
    expect(isContinuousResearchTransition(from, to)).toBe(true)
  })
  it.each([
    ['/research/materials', '/research/new'],
    ['/research/new', '/research/materials'],
    ['/research/existing', '/research/task-a/workspace'],
    ['/research/task-a/workspace', '/research/task-b/workspace'],
    ['/research/task-a/workspace', '/research/new'],
    ['/agent', '/research/new'],
  ])('animates genuine destination %s → %s', (from, to) => {
    expect(isContinuousResearchTransition(from, to)).toBe(false)
  })
})
