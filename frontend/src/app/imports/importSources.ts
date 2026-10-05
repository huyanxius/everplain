import type { ComponentType } from 'react'
import { FileTextIcon, FolderOpenIcon, ImageIcon, NotebookIcon, PlayCircleIcon, UploadSimpleIcon } from '@phosphor-icons/react'
import type { ImportSourceType } from '../../modules/knowledge-import'
import { COURSE_DOCUMENT_ACCEPT } from '../../modules/shared-knowledge'
import chromeLogo from '../../assets/brand/chrome.svg'
import obsidianLogo from '../../assets/brand/obsidian.svg'
import notionLogo from '../../assets/brand/notion.svg'
import evernoteLogo from '../../assets/brand/evernote.svg'
import flomoLogo from '../../assets/brand/flomo.png'
import keepLogo from '../../assets/brand/keep.svg'
import bilibiliLogo from '../../assets/brand/bilibili.svg'

export type SourceId = 'file' | ImportSourceType | 'bilibili'
export type ImportSourceDescriptor = { id: SourceId; title: string; accept: string; formats: string; hint?: string; icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean }>; logo?: string; steps: string[]; note?: string }
const descriptors: ImportSourceDescriptor[] = [
  { id: 'file', title: '文件', accept: COURSE_DOCUMENT_ACCEPT, formats: 'PDF、Word、PPT、Markdown、TXT', icon: UploadSimpleIcon, steps: ['可以一次选好几份', '上传完就能读原文', '知识点稍后自动整理好'], note: '扫描版 PDF 需先转为可选取文字的文档。' },
  { id: 'image', title: '图片与截图', accept: 'image/png,image/jpeg,image/webp,image/gif', formats: 'PNG、JPG、WebP、GIF', icon: ImageIcon, steps: ['选择截图、照片或拍下的书页', '保留原图，提取图里的文字', '之后按图里的字也能搜到'], note: '图片识别需配置 Everplain 专用视觉模型；未配置的条目会显示原因并保留重试入口。' },
  { id: 'chrome', title: '浏览器收藏', accept: '.html,.htm', formats: '书签 HTML', icon: FileTextIcon, logo: chromeLogo, steps: ['打开 Chrome 或 Edge 的书签管理器', '在菜单里选择「导出书签」', '把得到的 HTML 拖进来'], note: '逐个读取网页正文，需要登录的页面会显示失败原因，可单独重试。' },
  { id: 'obsidian', title: 'Obsidian / Markdown', accept: '.md,.markdown,.txt,.zip', formats: 'Markdown、TXT、文件夹或 ZIP', icon: FolderOpenIcon, logo: obsidianLogo, steps: ['选择 Vault 或 Markdown 笔记文件夹', '直接读取笔记和引用的附件，无需压缩', '再次同步只更新变化，保留目录和双链'] },
  // TODO: Replace this generic icon only when official Apple Notes artwork is supplied.
  // The reference apple-notes.svg is illustrative and must not ship as an official logo.
  { id: 'apple_notes', title: 'Apple 备忘录', accept: '.md,.markdown,.txt,.zip', formats: 'Markdown、TXT 或 ZIP', icon: NotebookIcon, steps: ['选中要带走的笔记', '导出为 Markdown 文件', '把导出的文件拖进来'] },
  { id: 'enex', title: '印象笔记', accept: '.enex', formats: 'ENEX', icon: NotebookIcon, logo: evernoteLogo, steps: ['在印象笔记里选中笔记本', '导出为 ENEX 文件', '把导出的文件拖进来'] },
  { id: 'notion', title: 'Notion', accept: '.zip,.html,.htm,.md', formats: 'HTML 或 Markdown 导出包', icon: NotebookIcon, logo: notionLogo, steps: ['在 Notion 设置里导出全部内容', '格式选择 HTML 或 Markdown', '把下载的导出包拖进来'] },
  { id: 'flomo', title: 'flomo', accept: '.html,.htm', formats: 'HTML', icon: NotebookIcon, logo: flomoLogo, steps: ['在 flomo 里导出全部笔记', '得到 HTML 文件', '把导出的文件拖进来'] },
  { id: 'keep', title: 'Google Keep', accept: '.zip,.json,.html', formats: 'Google Takeout ZIP、JSON 或 HTML', icon: NotebookIcon, logo: keepLogo, steps: ['打开 Google Takeout', '只勾选 Keep 并导出', '把下载的文件拖进来'] },
  { id: 'bilibili', title: 'B 站公开收藏', accept: '', formats: '公开账户 UID', icon: PlayCircleIcon, logo: bilibiliLogo, steps: ['填写公开账户 UID', '读取视频标题与简介', '整理成可检索的资料'], note: '只读取匿名可见的公开收藏，保存视频标题、简介和来源链接，不需要 Cookie。' },
]

const hints: Record<SourceId, string> = {
  file: 'PDF、Word、PPT、Markdown、TXT', image: 'PNG、JPG、WebP、GIF',
  markdown: 'Markdown 笔记文件', chrome: 'Chrome、Edge 导出的书签 HTML', obsidian: '选择笔记文件夹，直接读取正文和附件',
  apple_notes: '导出 Markdown 后上传', enex: 'ENEX 导出文件', notion: 'HTML 或 Markdown 导出包',
  flomo: '导出的 HTML 笔记文件', keep: 'Google Takeout ZIP 或 JSON', bilibili: '填你的 UID',
}
export const libraryImportSources = descriptors.map(source => ({ ...source, hint: hints[source.id] }))
