import { createRef } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
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
  expect(screen.getByRole('textbox')).toBeDisabled()
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
