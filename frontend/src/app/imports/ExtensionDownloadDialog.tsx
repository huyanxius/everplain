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
    <p id={descriptionId} className="qx-meta">下载 ZIP、解压，然后在 Chrome / Edge 加载文件夹。无需运行脚本。</p>
    <fieldset className="ep-import__download-systems">
      <legend className="qx-heading">查看你的系统步骤</legend>
      {(['macos', 'windows'] as const).map(value => <button key={value} type="button" className="qx-btn qx-btn--secondary" aria-pressed={system === value} disabled={motion.props.inert} onClick={() => setSystem(value)}>{value === 'macos' ? 'macOS' : 'Windows'}{recommended === value && <small className="qx-meta">可能适合此设备</small>}</button>)}
    </fieldset>
    <ol className="ep-import__extension-steps">
      <li><h3>下载并解压</h3><p>{system === 'windows' ? '下载后右键 ZIP → 全部解压缩。不要在 ZIP 预览里直接加载。' : system === 'macos' ? '下载后在 Finder 双击 ZIP，得到 everplain-clipper 文件夹。' : 'Mac 双击 ZIP；Windows 右键 ZIP → 全部解压缩。两种系统下载同一个扩展包。'}把解压后的文件夹放到你容易找到、不会清理的位置。</p></li>
      <li><h3>打开扩展管理</h3><p>在浏览器地址栏输入 <code>chrome://extensions</code>（Chrome）或 <code>edge://extensions</code>（Edge），打开“开发者模式”。</p></li>
      <li><h3>选择扩展文件夹</h3><p>点击“加载已解压的扩展程序 / 载入未封装的项目”（Load unpacked），选择直接包含 <code>manifest.json</code> 的文件夹，再点“选择 / 选择文件夹”。不要选择 ZIP 或上一级目录。</p><p>{system === 'windows' ? '找不到？在资源管理器打开解压文件夹，按 Ctrl+L、Ctrl+C 复制完整路径。在浏览器文件夹选择窗口按 Ctrl+L，粘贴、回车，再确认。' : system === 'macos' ? '找不到？在 Finder 选中解压文件夹，按 Option+Command+C 复制路径。在浏览器文件夹选择窗口按 Command+Shift+G，粘贴、回车，再点“选择”。' : '找不到文件夹时，选择上方系统查看复制完整路径的方法。'}</p></li>
      <li><h3>固定并开始收藏</h3><p>安装后在浏览器拼图菜单里固定 Everplain。同一浏览器用户资料登录 e.qunxue.xyz 并保留标签页，再打开文章，点击扩展的“收藏当前页面”。请保留已加载的文件夹。</p></li>
    </ol>
    <p className="qx-meta">目前尚未上架商店。受管理的浏览器若禁止开发者模式，请联系管理员。<a href="https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked" target="_blank" rel="noreferrer">Chrome 官方图示教程</a></p>
    <footer className="ep-import__download-actions">
      <button type="button" className="qx-btn qx-btn--secondary" disabled={motion.props.inert} onClick={motion.dismiss}>关闭</button>
      <a className="qx-btn qx-btn--primary" href="/downloads/everplain-clipper.zip" download>下载扩展 ZIP<ArrowRightIcon size={15} /></a>
    </footer>
  </dialog>
}

