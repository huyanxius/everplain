import { createRef } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { takeLaunch } from './sendFlight'
import { ConversationComposer, type ConversationComposerProps } from './ConversationComposer'
afterEach(cleanup)
const props = (): ConversationComposerProps => ({
  mode: 'standard', value: '', label: '问题', placeholder: '问一个问题', maxLength: 1000,
  busy: false, canSend: false, canStop: false, uploading: false, toolsOpen: false,
  inputRef: createRef(), toolsRef: createRef(), toolsButtonRef: createRef(), fileRef: createRef(),
  accept: '.pdf', attachments: [], tools: <button type="button">上传文件</button>,
  onChange: vi.fn(), onKeyDown: vi.fn(), onSubmit: vi.fn(e => e.preventDefault()), onStop: vi.fn(),
  onToggleTools: vi.fn(), onUpload: vi.fn(), onRemoveAttachment: vi.fn(),
})
it('keeps the empty chat free of sample files, and uses actual controlled input and submit state', () => {
  const state = props()
  const view = render(<ConversationComposer {...state} />)
  expect(screen.queryByLabelText('本轮附件')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '发送给 Everplain' })).toBeDisabled()
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '真实问题' } })
  expect(state.onChange).toHaveBeenCalledWith('真实问题')
  view.rerender(<ConversationComposer {...state} value="真实问题" canSend />)
  fireEvent.click(screen.getByRole('button', { name: '发送给 Everplain' }))
  expect(state.onSubmit).toHaveBeenCalledOnce()
})
it('renders research attachments and preserves removal and stop bindings', () => {
  const state = props()
  const view = render(<ConversationComposer {...state} researchLayout attachments={[{ id: 'actual-id', title: '我的文件.pdf', status: '已添加', removable: true }]} />)
  expect(screen.getByRole('textbox').closest('form')).toHaveAttribute('data-layout', 'research')
  fireEvent.click(screen.getByRole('button', { name: '移除附件 我的文件.pdf' }))
  expect(state.onRemoveAttachment).toHaveBeenCalledWith('actual-id')
  view.rerender(<ConversationComposer {...state} busy canStop />)
  expect(screen.getByRole('textbox')).not.toBeDisabled()
  expect(screen.getByRole('textbox')).toHaveAttribute('readonly')
  fireEvent.click(screen.getByRole('button', { name: '停止生成' }))
  expect(state.onStop).toHaveBeenCalledOnce()
  expect(state.onSubmit).not.toHaveBeenCalled()
})
it('forwards uploads once and clears the file input for repeat uploads', () => {
  const state = props()
  const { container } = render(<ConversationComposer {...state} />)
  const file = new File(['content'], 'local.pdf', { type: 'application/pdf' })
  const input = container.querySelector('input[type=file]')!
  fireEvent.change(input, { target: { files: [file] } })
  expect(state.onUpload).toHaveBeenCalledExactlyOnceWith([file])
  expect(input).toHaveValue('')
})

it('marks both Enter and form submission once and clears unused launches on unmount', () => {
  const state = props()
  const view = render(<ConversationComposer {...state} value="实际问题" canSend />)
  const input = screen.getByRole('textbox')
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
  expect(takeLaunch('实际问题')).toBeNull()
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  expect(takeLaunch('实际问题')).toBeNull()
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(takeLaunch('实际问题')).not.toBeNull(); expect(takeLaunch('实际问题')).toBeNull()
  fireEvent.submit(input.closest('form')!)
  expect(takeLaunch('实际问题')).not.toBeNull()
  fireEvent.submit(input.closest('form')!)
  view.unmount(); expect(takeLaunch('实际问题')).toBeNull()
  expect(state.onSubmit).toHaveBeenCalledTimes(2)
})
it('does not mark blocked sends or stop actions as a launch', () => {
  const state = props()
  const view = render(<ConversationComposer {...state} value="问题" busy canStop />)
  fireEvent.click(screen.getByRole('button', { name: '停止生成' }))
  expect(takeLaunch('问题')).toBeNull()
  view.rerender(<ConversationComposer {...state} value="问题" canSend={false} />)
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
  expect(takeLaunch('问题')).toBeNull()
})


it.each(['standard', 'deep-research'] as const)('keeps %s input focused but blocks busy editing and all submission paths', mode => {
  const state = props()
  const view = render(<ConversationComposer {...state} mode={mode} value="保留的输入" canSend />)
  const input = screen.getByRole('textbox')
  input.focus()
  view.rerender(<ConversationComposer {...state} mode={mode} value="保留的输入" busy canSend canStop />)
  expect(screen.getByRole('textbox')).toBe(input)
  expect(input).toHaveFocus()
  expect(input).not.toBeDisabled()
  expect(input).toHaveAttribute('readonly')
  fireEvent.change(input, { target: { value: '生成中不能覆盖' } })
  expect(state.onChange).not.toHaveBeenCalled()
  expect(input).toHaveValue('保留的输入')
  fireEvent.keyDown(input, { key: 'Enter' })
  fireEvent.keyDown(input, { key: 'Enter', repeat: true })
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  fireEvent.submit(input.closest('form')!)
  expect(state.onKeyDown).not.toHaveBeenCalled()
  expect(state.onSubmit).not.toHaveBeenCalled()
  expect(takeLaunch('保留的输入')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '停止生成' }))
  expect(state.onStop).toHaveBeenCalledOnce()
  view.rerender(<ConversationComposer {...state} mode={mode} value="恢复的草稿" canSend />)
  expect(screen.getByRole('textbox')).toBe(input)
  expect(input).toHaveFocus()
  expect(input).not.toHaveAttribute('readonly')
  fireEvent.change(input, { target: { value: '可以继续编辑' } })
  expect(state.onChange).toHaveBeenCalledExactlyOnceWith('可以继续编辑')
  fireEvent.submit(input.closest('form')!)
  expect(state.onSubmit).toHaveBeenCalledOnce()
})

it('blocks a not-ready or repeated Enter without blocking ordinary editing', () => {
  const state = props()
  const view = render(<ConversationComposer {...state} value="尚未可发送" />)
  const input = screen.getByRole('textbox')
  fireEvent.keyDown(input, { key: 'Enter' })
  fireEvent.submit(input.closest('form')!)
  expect(state.onKeyDown).not.toHaveBeenCalled()
  expect(state.onSubmit).not.toHaveBeenCalled()
  fireEvent.change(input, { target: { value: '仍可编辑' } })
  expect(state.onChange).toHaveBeenCalledOnce()
  view.rerender(<ConversationComposer {...state} value="可发送" canSend />)
  fireEvent.keyDown(input, { key: 'Enter', repeat: true })
  expect(state.onKeyDown).not.toHaveBeenCalled()
})
