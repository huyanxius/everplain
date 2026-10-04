import { useEffect, useId, useRef, useState } from 'react'
import { ArrowRightIcon } from '@phosphor-icons/react'
import { useAnimatedDismiss } from '../../ui/usePresence'
import './imports.css'

type ExtensionSystem = 'macos' | 'windows'

export function ExtensionDownloadDialog({ trigger, onClose, manageBodyScroll = true }: { trigger: HTMLButtonElement | null; onClose(): void; manageBodyScroll?: boolean }) {
  const titleId = useId()
  const descriptionId = useId()
  const boundary = useRef<HTMLDialogElement>(null)
  const motion = useAnimatedDismiss(boundary, onClose)
  const [system, setSystem] = useState<ExtensionSystem | null>(null)
  const userAgent = navigator.userAgent
  const recommended = /iPhone|iPad|iPod|Android/i.test(userAgent) ? null : /Windows/i.test(userAgent) ? 'windows' : /Macintosh|Mac OS X/i.test(userAgent) ? 'macos' : null
  useEffect(() => {
    const dialog = boundary.current
    const overflow = document.body.style.overflow
    dialog?.showModal()
    dialog?.focus({ preventScroll: true })
    if (manageBodyScroll) document.body.style.overflow = 'hidden'
    return () => {
      dialog?.close()
      if (manageBodyScroll) document.body.style.overflow = overflow
      if (trigger?.isConnected) trigger.focus()
    }
  }, [trigger, manageBodyScroll])

  return <dialog ref={boundary} className="qx-modal ep-import__download-dialog" tabIndex={-1} aria-labelledby={titleId} aria-describedby={descriptionId} data-motion-surface="modal" {...motion.props}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); motion.dismiss() }}
    onClick={event => {
      if (event.target !== event.currentTarget) return
      const { left, right, top, bottom } = event.currentTarget.getBoundingClientRect()
      if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) motion.dismiss()
    }}>
    <h2 id={titleId} className="qx-section-title">下载 Everplain 收藏助手</h2>
    <p id={descriptionId} className="qx-meta">选择你的电脑系统。准备工具会下载并校验扩展、整理到固定文件夹，再打开扩展管理页。</p>
    <fieldset className="ep-import__download-systems">
      <legend className="qx-heading">电脑系统</legend>
      {(['macos', 'windows'] as const).map(value => <button key={value} type="button" className="qx-btn qx-btn--secondary" aria-pressed={system === value} disabled={motion.props.inert} onClick={() => setSystem(value)}>{value === 'macos' ? 'macOS' : 'Windows'}{recommended === value && <small className="qx-meta">可能适合此设备</small>}</button>)}
    </fieldset>
    {system && <p className="qx-card__body" role="status">{system === 'macos' ? '全部解压后，双击 everplain-clipper-macos.command。' : '全部解压后，双击 everplain-clipper-windows.cmd；请保留同目录的 .ps1 文件。'}</p>}
    <p className="qx-meta">按工具提示选择 Chrome 或 Edge。接下来需要你在扩展管理页打开“开发者模式”，点击“加载已解压的扩展程序”，选择脚本打开的固定文件夹。</p>
    <p className="qx-meta">系统若拦截脚本，请 <a href="/downloads/everplain-clipper.zip" download>手动下载 ZIP</a>，解压后加载。不要关闭系统保护或绕过管理限制。</p>
    <footer className="ep-import__download-actions">
      <button type="button" className="qx-btn qx-btn--secondary" disabled={motion.props.inert} onClick={motion.dismiss}>取消</button>
      {system ? <a className="qx-btn qx-btn--primary" href={`/downloads/everplain-clipper-${system}.zip`} download>下载 {system === 'macos' ? 'macOS' : 'Windows'} 准备工具<ArrowRightIcon size={15} /></a> : <button type="button" className="qx-btn qx-btn--primary" disabled>请先选择系统</button>}
    </footer>
  </dialog>
}
