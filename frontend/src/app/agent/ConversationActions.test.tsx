import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ConversationActions } from './ConversationActions'

afterEach(cleanup)

it('opens from the title bar, focuses its action and restores focus on Escape', () => {
  render(<ConversationActions label="更多对话操作"><button type="button">研究面板</button></ConversationActions>)
  const trigger = screen.getByRole('button', { name: '更多对话操作' })
  expect(screen.queryByRole('group')).not.toBeInTheDocument()
  fireEvent.click(trigger)
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('button', { name: '研究面板' })).toHaveFocus()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('group')).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
})

it('keeps the supplied action intact and closes after selection or an outside click', () => {
  const action = vi.fn()
  render(<ConversationActions label="更多对话操作"><button type="button" onClick={action}>研究面板</button></ConversationActions>)
  const trigger = screen.getByRole('button', { name: '更多对话操作' })
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('button', { name: '研究面板' }))
  expect(action).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('group')).not.toBeInTheDocument()
  fireEvent.click(trigger)
  fireEvent.pointerDown(document.body)
  expect(screen.queryByRole('group')).not.toBeInTheDocument()
})

it('closes when keyboard focus moves outside without taking it back', () => {
  render(<><ConversationActions label="更多对话操作"><button type="button">研究面板</button></ConversationActions><button type="button">下一项</button></>)
  fireEvent.click(screen.getByRole('button', { name: '更多对话操作' }))
  const outside = screen.getByRole('button', { name: '下一项' })
  fireEvent.blur(screen.getByRole('button', { name: '研究面板' }), { relatedTarget: outside })
  expect(screen.queryByRole('group')).not.toBeInTheDocument()
})
