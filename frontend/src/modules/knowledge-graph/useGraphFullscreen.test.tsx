import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGraphFullscreen } from './useGraphFullscreen'

let fullscreenElement: Element | null = null
const exitFullscreen = vi.fn(async () => {
  fullscreenElement = null
  document.dispatchEvent(new Event('fullscreenchange'))
})

function Harness() {
  const graph = useGraphFullscreen<HTMLElement>()
  return <div>
    <button>页面导航</button>
    <section ref={graph.fullscreenRef} data-testid="graph" data-mode={graph.mode}>
      <div data-testid="canvas" />
      {graph.isFullscreen
        ? <button data-graph-fullscreen-exit onClick={() => void graph.exitFullscreen()}>退出全屏</button>
        : <button data-graph-fullscreen-enter onClick={() => void graph.enterFullscreen()}>进入全屏</button>}
      {graph.notice && <p role="status">{graph.notice}</p>}
    </section>
  </div>
}

function mockNativeFullscreen() {
  const request = vi.fn(async function (this: HTMLElement) {
    fullscreenElement = this.ownerDocument.querySelector('[data-testid="graph"]')
    document.dispatchEvent(new Event('fullscreenchange'))
  })
  Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, value: request })
  return request
}

beforeEach(() => {
  fullscreenElement = null
  exitFullscreen.mockClear()
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreenElement })
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFullscreen })
  Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, value: undefined })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  delete (HTMLElement.prototype as Partial<HTMLElement>).requestFullscreen
  Reflect.deleteProperty(document, 'fullscreenElement')
  delete (document as Partial<Document>).exitFullscreen
  document.body.style.overflow = ''
})

describe('useGraphFullscreen', () => {
  it('requests native fullscreen on the graph section and keeps the canvas mounted', async () => {
    const request = mockNativeFullscreen()
    render(<Harness />)
    const canvas = screen.getByTestId('canvas')
    const enter = screen.getByRole('button', { name: '进入全屏' })
    enter.focus()
    fireEvent.click(enter)
    await waitFor(() => expect(screen.getByTestId('graph')).toHaveAttribute('data-mode', 'native'))
    expect(request).toHaveBeenCalledOnce()
    expect(request.mock.instances[0]).toBe(screen.getByTestId('graph'))
    expect(fullscreenElement).toBe(screen.getByTestId('graph'))
    expect(screen.getByRole('button', { name: '退出全屏' })).toHaveFocus()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByTestId('canvas')).toBe(canvas)
    fireEvent.click(screen.getByRole('button', { name: '退出全屏' }))
    await waitFor(() => expect(screen.getByTestId('graph')).toHaveAttribute('data-mode', 'none'))
    expect(exitFullscreen).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '进入全屏' })).toHaveFocus()
    expect(screen.getByTestId('canvas')).toBe(canvas)
  })

  it('synchronizes browser-initiated exits and supports entering again', async () => {
    const request = mockNativeFullscreen()
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '进入全屏' }))
    await waitFor(() => expect(screen.getByTestId('graph')).toHaveAttribute('data-mode', 'native'))
    act(() => { fullscreenElement = null; document.dispatchEvent(new Event('fullscreenchange')) })
    expect(screen.getByTestId('graph')).toHaveAttribute('data-mode', 'none')
    fireEvent.click(screen.getByRole('button', { name: '进入全屏' }))
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId('graph')).toHaveAttribute('data-mode', 'native')
  })

  it('exits native fullscreen with Escape', async () => {
    mockNativeFullscreen()
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '进入全屏' }))
    await waitFor(() => expect(screen.getByTestId('graph')).toHaveAttribute('data-mode', 'native'))
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.getByTestId('graph')).toHaveAttribute('data-mode', 'none'))
    expect(exitFullscreen).toHaveBeenCalledOnce()
  })

  it('reports a rejected request and provides an escapable viewport fallback', async () => {
    const request = vi.fn().mockRejectedValue(new Error('Permission denied'))
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, value: request })
    document.body.style.overflow = 'auto'
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '进入全屏' }))
    await waitFor(() => expect(screen.getByTestId('graph')).toHaveAttribute('data-mode', 'viewport'))
    expect(screen.getByRole('status')).toHaveTextContent('浏览器未允许全屏，已切换为窗口内全屏')
    expect(fullscreenElement).toBeNull()
    expect(document.body.style.overflow).toBe('hidden')
    expect(screen.getByRole('button', { name: '页面导航' }).inert).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.getByTestId('graph')).toHaveAttribute('data-mode', 'none'))
    expect(document.body.style.overflow).toBe('auto')
    expect(screen.getByRole('button', { name: '页面导航' }).inert).toBeFalsy()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(exitFullscreen).not.toHaveBeenCalled()
  })

  it('reports unsupported fullscreen and restores page state on unmount', () => {
    const alreadyInert = document.createElement('aside')
    alreadyInert.inert = true
    document.body.append(alreadyInert)
    const { unmount } = render(<Harness />)
    const navigation = screen.getByRole('button', { name: '页面导航' })
    fireEvent.click(screen.getByRole('button', { name: '进入全屏' }))
    expect(screen.getByTestId('graph')).toHaveAttribute('data-mode', 'viewport')
    expect(screen.getByRole('status')).toHaveTextContent('此浏览器不支持浏览器全屏')
    expect(navigation.inert).toBe(true)
    expect(alreadyInert.inert).toBe(true)
    unmount()
    expect(document.body.style.overflow).toBe('')
    expect(navigation.inert).toBeFalsy()
    expect(alreadyInert.inert).toBe(true)
    alreadyInert.remove()
  })

  it('prevents duplicate native requests while a request is pending', async () => {
    let resolve!: () => void
    const request = vi.fn(() => new Promise<void>((done) => { resolve = done }))
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, value: request })
    render(<Harness />)
    const button = screen.getByRole('button', { name: '进入全屏' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(request).toHaveBeenCalledOnce()
    await act(async () => { resolve() })
  })

  it('does not reopen fallback after Escape cancels a pending request', async () => {
    let reject!: (reason: Error) => void
    const request = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail }))
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, value: request })
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '进入全屏' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    await act(async () => { reject(new Error('late rejection')) })
    expect(screen.getByTestId('graph')).toHaveAttribute('data-mode', 'none')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('leaves a different fullscreen element alone on graph unmount', () => {
    const { unmount } = render(<Harness />)
    fullscreenElement = document.body
    act(() => document.dispatchEvent(new Event('fullscreenchange')))
    expect(screen.getByTestId('graph')).toHaveAttribute('data-mode', 'none')
    unmount()
    expect(exitFullscreen).not.toHaveBeenCalled()
  })

  it('releases its native fullscreen if the graph is unmounted', async () => {
    mockNativeFullscreen()
    const { unmount } = render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '进入全屏' }))
    await waitFor(() => expect(screen.getByTestId('graph')).toHaveAttribute('data-mode', 'native'))
    unmount()
    expect(exitFullscreen).toHaveBeenCalledOnce()
  })

  it('keeps exit controls available and reports a failed native exit', async () => {
    mockNativeFullscreen()
    const rejectExit = vi.fn().mockRejectedValue(new Error('Exit failed'))
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: rejectExit })
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '进入全屏' }))
    await waitFor(() => expect(screen.getByTestId('graph')).toHaveAttribute('data-mode', 'native'))
    fireEvent.click(screen.getByRole('button', { name: '退出全屏' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('请按 Esc 退出'))
    expect(screen.getByTestId('graph')).toHaveAttribute('data-mode', 'native')
    expect(screen.getByRole('button', { name: '退出全屏' })).toBeInTheDocument()
  })
})
