import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, expect, it } from 'vitest'
import { ResearchPrompt } from './ResearchPrompt'

afterEach(cleanup)
function Location() { const value = useLocation(); return <output aria-label="Address">{value.pathname + value.search}</output> }
it('starts research with the entered question and preserves multiline content', () => {
  render(<MemoryRouter><ResearchPrompt /><Location /></MemoryRouter>)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'first\nsecond' } })
  fireEvent.click(screen.getByRole('button', { name: '开始研究' }))
  expect(screen.getByRole('status', { name: 'Address' })).toHaveTextContent('/agent?prompt=first%0Asecond')
})
it('opens a blank research workspace without creating an invented question', () => {
  render(<MemoryRouter><ResearchPrompt /><Location /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: '开始研究' }))
  expect(screen.getByRole('status', { name: 'Address' })).toHaveTextContent('/agent')
})
