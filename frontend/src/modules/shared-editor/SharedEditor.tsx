import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { CharacterCount, Focus, Placeholder } from '@tiptap/extensions'
import {
  ArrowCounterClockwiseIcon,
  ArrowClockwiseIcon,
  ArrowsInSimpleIcon,
  ArrowsOutSimpleIcon,
  CaretDownIcon,
  CaretUpIcon,
  CheckSquareIcon,
  CodeBlockIcon,
  CodeIcon,
  CodeSimpleIcon,
  ColumnsPlusRightIcon,
  CrosshairIcon,
  HighlighterIcon,
  ImageIcon,
  InfoIcon,
  KeyboardIcon,
  LinkIcon,
  LinkSimpleIcon,
  ListBulletsIcon,
  ListNumbersIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PlusIcon,
  QuotesIcon,
  RowsPlusBottomIcon,
  TableIcon,
  TextBIcon,
  TextHOneIcon,
  TextHThreeIcon,
  TextHTwoIcon,
  TextItalicIcon,
  TextStrikethroughIcon,
  TextTIcon,
  TextUnderlineIcon,
  TrashIcon,
  WarningIcon,
  XIcon,
} from '@phosphor-icons/react'

import './shared-editor.css'
import { splitMarkdown, joinMarkdown, canEditProperties } from './markdownSource'
import { mapMarkdownSelection, type MarkdownSelection } from './markdownSelection'

import { Callout, Highlight, Image, Search, Table, TableCell, TableHeader, TableRow, TagDecor, WikiLink, findMatches, searchKey, tableCommands, tableJSON } from './extensions'

/*
 * 共享编辑器。笔记、写作、研究文稿、资料批注都用它，各页面只换外面的侧栏，不各写一个编辑器。
 *
 * 编辑器自己负责（各宿主都有，不能少）：
 *   Markdown 读写（含源码模式）、属性（frontmatter）、标题 / 列表 / 任务 / 引用 / 提示块 / 代码块 / 表格 / 图片 / 分割线、
 *   加粗 / 斜体 / 下划线 / 删除线 / 行内代码 / 高亮 / 链接 / 双链 / #标签、
 *   斜杠菜单、[[ 联想、选区浮条、查找替换、表格操作条、专注模式、全宽 / 阅读宽、快捷键说明、字数与保存状态。
 * 宿主通过参数接入：
 *   selectionActions —— 选区浮条右半边的宿主动作（写作页的「改写 / 更像我」，研究页的「讨论选中段落」）；
 *   notes / onOpenLink —— 双链联想的候选和点击跳转；
 *   onReady —— 拿到 editor 实例，宿主自己算大纲、反链、接 Agent 修改。
 * 保存：由宿主显式保存并传入状态；模式切换保留原始 Markdown，不制造保存回执。
 */

export type Property = { key: string; value: string }
export type SelectionAction = { id: string; label: string; icon?: ReactNode; disabled?: boolean; run: (editor: Editor, text: string, selection: MarkdownSelection) => void }

type Menu = { kind: 'slash' | 'wiki'; query: string; from: number; x: number; y: number; index: number } | null

export function SharedEditor({
  markdown,
  properties: initialProps = [],
  notes = [],
  selectionActions = [],
  placeholder = '输入 / 插入内容，输入 [[ 链接笔记',
  onOpenLink,
  onReady,
  onChange,
  onSelectionChange,
  saveState = 'saved',
  readOnly = false,
  bodyPreview,
  statusContent,
}: {
  markdown: string
  properties?: Property[]
  notes?: string[]
  selectionActions?: SelectionAction[]
  placeholder?: string
  onOpenLink?: (target: string) => void
  onReady?: (editor: Editor) => void
  onChange?: (markdown: string) => void
  onSelectionChange?: (selection: MarkdownSelection) => void
  saveState?: 'saved' | 'dirty' | 'saving' | 'error'
  readOnly?: boolean
  /** A reversible host preview. It never replaces the live editor or its history. */
  bodyPreview?: ReactNode
  statusContent?: ReactNode
}) {
  const initial = useRef(splitMarkdown(markdown))
  const raw = useRef(markdown)
  const frontmatter = useRef(initial.current.frontmatter)
  const [propertySourceOnly, setPropertySourceOnly] = useState(!canEditProperties(initial.current.frontmatter))
  const callback = useRef(onChange); callback.current = onChange
  const selectionCallback = useRef(onSelectionChange); selectionCallback.current = onSelectionChange
  const suppressChange = useRef(false)
  const userEditing = useRef(false)
  const [props, setProps] = useState<Property[]>(initialProps.length ? initialProps : initial.current.properties)
  const [menu, setMenu] = useState<Menu>(null)
  const menuRef = useRef<Menu>(null)
  menuRef.current = menu
  const [link, setLink] = useState<{ x: number; y: number; href: string } | null>(null)
  const [find, setFind] = useState<{ term: string; replace: string; index: number; cs: boolean; withReplace: boolean } | null>(null)
  const [source, setSource] = useState<string | null>(null)
  const [sourceSelection, setSourceSelection] = useState<MarkdownSelection>(null)
  const [focusMode, setFocusMode] = useState(false)
  const [wide, setWide] = useState(false)
  const [help, setHelp] = useState(false)
  const [, force] = useState(0)
  const shell = useRef<HTMLDivElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const [imageError, setImageError] = useState('')
  const [selectionError, setSelectionError] = useState('')
  const reportSelection = (selection: MarkdownSelection) => {
    setSourceSelection(selection)
    setSelectionError(selection && 'error' in selection ? selection.error : '')
    selectionCallback.current?.(selection)
    return selection
  }
  const insertImage = (file: File, target: Editor) => {
    if (!file.type.startsWith('image/')) return
    if (file.size > 48 * 1024) { setImageError('内嵌图片请小于 48 KB；较大的图片可先放到资料库，再在源码中添加链接。'); return }
    const reader = new FileReader()
    reader.onload = () => { if (!target.isDestroyed && typeof reader.result === 'string') { target.chain().focus().insertContent({ type: 'image', attrs: { src: reader.result, alt: file.name } }).run(); setImageError('') } }
    reader.onerror = () => setImageError('图片读取失败，请重试。')
    reader.readAsDataURL(file)
  }
  const runMenuItem = useRef<(i: number) => void>(() => {})

  const editorRef = useRef<Editor | null>(null)
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: ({ node }) => (node.type.name === 'heading' ? `标题 ${node.attrs.level}` : placeholder), includeChildren: false }),
      CharacterCount,
      Focus.configure({ className: 'se-focused', mode: 'shallowest' }),
      Markdown,
      Highlight,
      WikiLink,
      TagDecor,
      Callout,
      Table,
      TableRow,
      TableHeader,
      TableCell,
      Image,
      Search,
    ],
    content: initial.current.body,
    editable: !readOnly,
    contentType: 'markdown',
    immediatelyRender: false,
    editorProps: {
      attributes: { class: 'se-prose', spellcheck: 'false' },
      handleKeyDown: (_view, e) => {
        const m = menuRef.current
        if (m) {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setMenu((cur) => (cur ? { ...cur, index: Math.max(0, cur.index + (e.key === 'ArrowDown' ? 1 : -1)) } : cur))
            return true
          }
          if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault()
            runMenuItem.current(m.index)
            return true
          }
          if (e.key === 'Escape') {
            setMenu(null)
            return true
          }
        }
        const mod = e.metaKey || e.ctrlKey
        if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openLink(); return true }
        if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); setFind((f) => f ?? { term: '', replace: '', index: 0, cs: false, withReplace: e.altKey }); return true }
        if (mod && e.key === '/') { e.preventDefault(); setHelp((v) => !v); return true }
        return false
      },
      handleClickOn: (_view, _pos, node, _nodePos, event) => {
        if (node.type.name === 'wikiLink') {
          event.preventDefault()
          onOpenLink?.(node.attrs.target)
          return true
        }
        return false
      },
      handlePaste: (view, event) => {
        const file = [...(event.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))
        if (!file) return false
        const target = (view as unknown as { editor?: Editor }).editor
        if (target) insertImage(file, target)
        else window.setTimeout(() => { const current = editorRef.current; if (current) insertImage(file, current) }, 0)
        return true
      },
      handleDrop: (view, event) => {
        const file = [...(event.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/'))
        if (!file) return false
        const target = (view as unknown as { editor?: Editor }).editor
        if (target) insertImage(file, target)
        else window.setTimeout(() => { const current = editorRef.current; if (current) insertImage(file, current) }, 0)
        return true
      },
    },
    onUpdate: ({ editor: updated }) => {
      if (suppressChange.current || !userEditing.current) return
      raw.current = joinMarkdown(frontmatter.current, updated.getMarkdown())
      callback.current?.(raw.current)
    },
  })

  useEffect(() => { editorRef.current = editor; if (editor) onReady?.(editor); return () => { editorRef.current = null } }, [editor, onReady])
  useEffect(() => { editor?.setEditable(!readOnly) }, [editor, readOnly])
  useEffect(() => {
    if (!editor) return
    const changed = () => {
      reportSelection(mapMarkdownSelection(editor, raw.current))
    }
    editor.on('selectionUpdate', changed)
    editor.on('update', changed)
    return () => { editor.off('selectionUpdate', changed); editor.off('update', changed) }
  }, [editor])
  useEffect(() => {
    if (!editor || markdown === raw.current) return
    raw.current = markdown
    const next = splitMarkdown(markdown); frontmatter.current = next.frontmatter
    setProps(next.properties)
    setPropertySourceOnly(!canEditProperties(next.frontmatter))
    userEditing.current = false
    suppressChange.current = true
    editor.commands.setContent(next.body, { contentType: 'markdown', emitUpdate: false })
    suppressChange.current = false
    setSource(current => current === null ? null : markdown)
  }, [editor, markdown])

  /* 斜杠菜单与 [[ 联想：看光标前的文字决定是否弹出 */
  useEffect(() => {
    if (!editor) return
    const check = () => {
      force((n) => n + 1)
      const { selection } = editor.state
      if (!selection.empty) return setMenu(null)
      const $from = selection.$from
      if ($from.parent.type.name === 'codeBlock') return setMenu(null)
      const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
      const wiki = /\[\[([^\]\n]*)$/.exec(before)
      const slash = /(?:^|\s)\/([^\s/]*)$/.exec(before)
      const hit = wiki ? { kind: 'wiki' as const, query: wiki[1], len: wiki[1].length + 2 } : slash ? { kind: 'slash' as const, query: slash[1], len: slash[1].length + 1 } : null
      if (!hit) return setMenu(null)
      const c = editor.view.coordsAtPos($from.pos)
      const box = shell.current!.getBoundingClientRect()
      setMenu((cur) => ({ kind: hit.kind, query: hit.query, from: $from.pos - hit.len, x: c.left - box.left, y: c.bottom - box.top + shell.current!.scrollTop + 6, index: cur && cur.kind === hit.kind && cur.query === hit.query ? cur.index : 0 }))
    }
    editor.on('update', check)
    editor.on('selectionUpdate', check)
    return () => { editor.off('update', check); editor.off('selectionUpdate', check) }
  }, [editor])

  const slashItems = useMemo(() => {
    if (!editor) return []
    const c = () => editor.chain().focus().deleteRange({ from: menu!.from, to: editor.state.selection.from })
    return [
      { label: '正文', hint: '', icon: <TextTIcon />, keys: 'text zhengwen', run: () => c().setParagraph().run() },
      { label: '标题 1', hint: '#', icon: <TextHOneIcon />, keys: 'h1 heading biaoti', run: () => c().setHeading({ level: 1 }).run() },
      { label: '标题 2', hint: '##', icon: <TextHTwoIcon />, keys: 'h2 heading biaoti', run: () => c().setHeading({ level: 2 }).run() },
      { label: '标题 3', hint: '###', icon: <TextHThreeIcon />, keys: 'h3 heading biaoti', run: () => c().setHeading({ level: 3 }).run() },
      { label: '无序列表', hint: '-', icon: <ListBulletsIcon />, keys: 'bullet list liebiao', run: () => c().toggleBulletList().run() },
      { label: '有序列表', hint: '1.', icon: <ListNumbersIcon />, keys: 'ordered number list liebiao', run: () => c().toggleOrderedList().run() },
      { label: '任务', hint: '[ ]', icon: <CheckSquareIcon />, keys: 'todo task renwu', run: () => c().toggleTaskList().run() },
      { label: '引用', hint: '>', icon: <QuotesIcon />, keys: 'quote yinyong', run: () => c().toggleBlockquote().run() },
      { label: '提示块', hint: '> [!note]', icon: <InfoIcon />, keys: 'callout note tishi', run: () => c().insertContent({ type: 'callout', attrs: { kind: 'note' }, content: [{ type: 'paragraph' }] }).run() },
      { label: '注意', hint: '> [!warning]', icon: <WarningIcon />, keys: 'warning callout zhuyi', run: () => c().insertContent({ type: 'callout', attrs: { kind: 'warning' }, content: [{ type: 'paragraph' }] }).run() },
      { label: '代码块', hint: '```', icon: <CodeBlockIcon />, keys: 'code daima', run: () => c().toggleCodeBlock().run() },
      { label: '表格', hint: '3 × 3', icon: <TableIcon />, keys: 'table biaoge', run: () => c().insertContent(tableJSON()).run() },
      { label: '图片', hint: '粘贴或拖入', icon: <ImageIcon />, keys: 'image tupian', run: () => imageInput.current?.click() },
      { label: '分割线', hint: '---', icon: <MinusIcon />, keys: 'divider hr fengexian', run: () => c().setHorizontalRule().run() },
      { label: '链接笔记', hint: '[[', icon: <LinkSimpleIcon />, keys: 'wiki link lianjie', run: () => c().insertContent('[[').run() },
    ].filter((i) => !menu || menu.kind !== 'slash' || !menu.query || (i.label + i.keys).toLowerCase().includes(menu.query.toLowerCase()))
  }, [editor, menu])

  const wikiItems = useMemo(() => {
    if (!menu || menu.kind !== 'wiki') return []
    const q = menu.query.trim()
    const hits = notes.filter((n) => !q || n.toLowerCase().includes(q.toLowerCase())).slice(0, 7)
    return [...hits.map((n) => ({ label: n, create: false })), ...(q && !notes.includes(q) ? [{ label: q, create: true }] : [])]
  }, [menu, notes])

  const items = menu?.kind === 'wiki' ? wikiItems : slashItems
  const activeIndex = menu ? Math.min(menu.index, Math.max(0, items.length - 1)) : 0

  runMenuItem.current = (i: number) => {
    if (!editor || !menu) return
    if (menu.kind === 'slash') slashItems[Math.min(i, slashItems.length - 1)]?.run()
    else {
      const it = wikiItems[Math.min(i, wikiItems.length - 1)]
      if (!it) return
      editor.chain().focus().deleteRange({ from: menu.from, to: editor.state.selection.from }).insertContent([{ type: 'wikiLink', attrs: { target: it.label } }, { type: 'text', text: ' ' }]).run()
    }
    setMenu(null)
  }

  /* 链接 */
  const openLink = useCallback(() => {
    if (!editor || !shell.current) return
    const { from } = editor.state.selection
    const c = editor.view.coordsAtPos(from)
    const box = shell.current.getBoundingClientRect()
    setLink({ x: c.left - box.left, y: c.bottom - box.top + shell.current.scrollTop + 8, href: editor.getAttributes('link').href ?? '' })
  }, [editor])
  const applyLink = (href: string) => {
    if (!editor) return
    const chain = editor.chain().focus().extendMarkRange('link')
    if (href.trim()) chain.setLink({ href: href.trim() }).run()
    else chain.unsetLink().run()
    setLink(null)
  }

  /* 查找替换 */
  const matches = editor && find ? findMatches(editor.state.doc, find.term, find.cs) : []
  useEffect(() => {
    if (!editor) return
    editor.view.dispatch(editor.state.tr.setMeta(searchKey, { term: find?.term ?? '', index: find?.index ?? 0, caseSensitive: find?.cs ?? false }))
  }, [editor, find?.term, find?.index, find?.cs])
  const goMatch = (dir: number) => {
    if (!editor || !find || !matches.length) return
    const index = (find.index + dir + matches.length) % matches.length
    setFind({ ...find, index })
    const m = matches[index]
    editor.commands.setTextSelection(m)
    editor.view.domAtPos(m.from).node.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
  const replaceOne = () => {
    if (!editor || !find || !matches.length) return
    const m = matches[Math.min(find.index, matches.length - 1)]
    editor.view.dispatch(editor.state.tr.insertText(find.replace, m.from, m.to))
  }
  const replaceAll = () => {
    if (!editor || !find || !matches.length) return
    let tr = editor.state.tr
    ;[...matches].reverse().forEach((m) => { tr = tr.insertText(find.replace, m.from, m.to) })
    editor.view.dispatch(tr)
  }

  /* Keep the exact Markdown until a user actually edits it. Mode switches never save a normalized copy. */
  const toSource = () => setSource(raw.current)
  const fromSource = () => {
    if (!editor || source === null) return
    const next = splitMarkdown(source)
    frontmatter.current = next.frontmatter
    setProps(next.properties)
    setPropertySourceOnly(!canEditProperties(next.frontmatter))
    userEditing.current = false
    suppressChange.current = true
    editor.commands.setContent(next.body, { contentType: 'markdown', emitUpdate: false })
    suppressChange.current = false
    setSource(null)
  }
  const updateProperties = (next: Property[]) => {
    setProps(next)
    frontmatter.current = next.length ? `---\n${next.map(p => `${p.key}: ${p.value}`).join('\n')}\n---\n\n` : ''
    raw.current = joinMarkdown(frontmatter.current, editor?.getMarkdown() ?? '')
    callback.current?.(raw.current)
  }

  if (!editor) return <div className="se-shell" />

  const text = editor.getText()
  const cjk = (text.match(/[㐀-鿿]/g) ?? []).length
  const latin = (text.replace(/[㐀-鿿]/g, ' ').match(/[A-Za-z0-9]+/g) ?? []).length
  const words = cjk + latin
  const inTable = editor.isActive('table')
  const block = editor.isActive('heading', { level: 1 }) ? '标题 1' : editor.isActive('heading', { level: 2 }) ? '标题 2' : editor.isActive('heading', { level: 3 }) ? '标题 3' : editor.isActive('codeBlock') ? '代码块' : editor.isActive('blockquote') ? '引用' : '正文'
  const run = (t: string) => {
    const tc = (tableCommands as Record<string, (s: typeof editor.state, d: typeof editor.view.dispatch) => boolean>)[t]
    tc(editor.state, editor.view.dispatch)
    editor.commands.focus()
  }
  const T = ({ label, active, onClick, children, kbd }: { label: string; active?: boolean; onClick: () => void; children: ReactNode; kbd?: string }) => (
    <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon se-tb" aria-label={label} title={kbd ? `${label}  ${kbd}` : label} aria-pressed={active} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>{children}</button>
  )

  return (
    <div className="se" data-focus={focusMode} data-wide={wide} inert={readOnly} onBeforeInputCapture={() => { userEditing.current = true }} onPasteCapture={() => { userEditing.current = true }} onDropCapture={() => { userEditing.current = true }} onKeyDownCapture={event => { if (event.key === 'Backspace' || event.key === 'Delete' || event.key === 'Enter' || event.key.length === 1) userEditing.current = true }} onClickCapture={event => { const button = (event.target as Element).closest('button'); if (button && button.getAttribute('role') !== 'tab') userEditing.current = true }}>
      <input ref={imageInput} hidden type="file" accept="image/*" onChange={event => { const file = event.currentTarget.files?.[0]; if (file && editor) insertImage(file, editor); event.currentTarget.value = '' }} />
      {imageError && <p className="qx-notice qx-notice--danger" role="alert">{imageError}</p>}
      {selectionError && <p className="qx-notice qx-notice--danger" role="alert">{selectionError}</p>}
      <div className="se-toolbar" role="toolbar" aria-label="编辑工具" inert={Boolean(bodyPreview)}>
        <T label="撤销" kbd="⌘Z" onClick={() => editor.chain().focus().undo().run()}><ArrowCounterClockwiseIcon /></T>
        <T label="重做" kbd="⇧⌘Z" onClick={() => editor.chain().focus().redo().run()}><ArrowClockwiseIcon /></T>
        <span className="se-gap" />
        <BlockSelect value={block} onPick={(v) => {
          const c = editor.chain().focus()
          if (v === '正文') c.setParagraph().run()
          else if (v.startsWith('标题')) c.setHeading({ level: Number(v.slice(-1)) as 1 | 2 | 3 }).run()
          else if (v === '引用') c.toggleBlockquote().run()
          else if (v === '代码块') c.toggleCodeBlock().run()
        }} />
        <span className="se-gap" />
        <T label="加粗" kbd="⌘B" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><TextBIcon /></T>
        <T label="斜体" kbd="⌘I" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><TextItalicIcon /></T>
        <T label="下划线" kbd="⌘U" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}><TextUnderlineIcon /></T>
        <T label="删除线" kbd="⇧⌘S" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><TextStrikethroughIcon /></T>
        <T label="高亮" kbd="⇧⌘H" active={editor.isActive('highlight')} onClick={() => editor.chain().focus().toggleMark('highlight').run()}><HighlighterIcon /></T>
        <T label="行内代码" kbd="⌘E" active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}><CodeIcon /></T>
        <T label="链接" kbd="⌘K" active={editor.isActive('link')} onClick={openLink}><LinkIcon /></T>
        <span className="se-gap" />
        <T label="无序列表" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><ListBulletsIcon /></T>
        <T label="有序列表" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListNumbersIcon /></T>
        <T label="任务" active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()}><CheckSquareIcon /></T>
        <T label="提示块" active={editor.isActive('callout')} onClick={() => editor.chain().focus().insertContent({ type: 'callout', attrs: { kind: 'note' }, content: [{ type: 'paragraph' }] }).run()}><InfoIcon /></T>
        <T label="表格" onClick={() => editor.chain().focus().insertContent(tableJSON()).run()}><TableIcon /></T>
        <span className="se-spacer" />
        <T label="查找替换" kbd="⌘F" active={!!find} onClick={() => setFind(find ? null : { term: '', replace: '', index: 0, cs: false, withReplace: true })}><MagnifyingGlassIcon /></T>
        <T label="专注模式" active={focusMode} onClick={() => setFocusMode(!focusMode)}><CrosshairIcon /></T>
        <T label={wide ? '阅读宽度' : '全宽'} active={wide} onClick={() => setWide(!wide)}>{wide ? <ArrowsInSimpleIcon /> : <ArrowsOutSimpleIcon />}</T>
        <T label="快捷键" kbd="⌘/" active={help} onClick={() => setHelp(!help)}><KeyboardIcon /></T>
        <div className="qx-segmented se-modeswitch" role="tablist" aria-label="编辑模式">
          <button type="button" role="tab" aria-selected={source === null} onClick={fromSource}>编辑</button>
          <button type="button" role="tab" aria-selected={source !== null} onClick={() => source === null && toSource()}><CodeSimpleIcon /> 源码</button>
        </div>
      </div>

      {find && !bodyPreview ? (
        <div className="se-find" role="search">
          <div className="se-find__row">
            <label className="qx-search se-find__field"><MagnifyingGlassIcon />
            <input autoFocus placeholder="查找" value={find.term} onChange={(e) => setFind({ ...find, term: e.target.value, index: 0 })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); goMatch(e.shiftKey ? -1 : 1) } if (e.key === 'Escape') setFind(null) }} />
            <span className="se-find__count">{find.term ? (matches.length ? `${Math.min(find.index, matches.length - 1) + 1} / ${matches.length}` : '无结果') : ''}</span></label>
            <button type="button" className="qx-btn qx-btn--ghost se-find__opt" aria-pressed={find.cs} title="区分大小写" onClick={() => setFind({ ...find, cs: !find.cs, index: 0 })}>Aa</button>
            <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon se-tb" aria-label="上一个" onClick={() => goMatch(-1)}><CaretUpIcon /></button>
            <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon se-tb" aria-label="下一个" onClick={() => goMatch(1)}><CaretDownIcon /></button>
            <button type="button" className="qx-btn qx-btn--ghost se-find__opt" aria-pressed={find.withReplace} onClick={() => setFind({ ...find, withReplace: !find.withReplace })}>替换</button>
            <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon se-tb" aria-label="关闭查找" onClick={() => setFind(null)}><XIcon /></button>
          </div>
          {find.withReplace ? (
            <div className="se-find__row">
              <label className="qx-search se-find__field"><input placeholder="替换为" value={find.replace} onChange={(e) => setFind({ ...find, replace: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); replaceOne() } }} /></label>
              <button type="button" className="qx-btn qx-btn--secondary" disabled={!matches.length} onClick={replaceOne}>替换</button>
              <button type="button" className="qx-btn qx-btn--primary" disabled={!matches.length} onClick={replaceAll}>全部替换</button>
            </div>
          ) : null}
        </div>
      ) : null}

      {inTable && source === null && !bodyPreview ? (
        <div className="se-tablebar" role="toolbar" aria-label="表格">
          <span>表格</span>
          <button type="button" className="qx-btn qx-btn--ghost" onMouseDown={(e) => e.preventDefault()} onClick={() => run('addRowAfter')}><RowsPlusBottomIcon /> 加一行</button>
          <button type="button" className="qx-btn qx-btn--ghost" onMouseDown={(e) => e.preventDefault()} onClick={() => run('addColumnAfter')}><ColumnsPlusRightIcon /> 加一列</button>
          <button type="button" className="qx-btn qx-btn--ghost" onMouseDown={(e) => e.preventDefault()} onClick={() => run('deleteRow')}>删除行</button>
          <button type="button" className="qx-btn qx-btn--ghost" onMouseDown={(e) => e.preventDefault()} onClick={() => run('deleteColumn')}>删除列</button>
          <button type="button" className="qx-btn qx-btn--ghost se-tablebar__danger" onMouseDown={(e) => e.preventDefault()} onClick={() => run('deleteTable')}><TrashIcon /> 删除表格</button>
        </div>
      ) : null}

      <div className="se-scroll" ref={shell}>
        <div className="se-page">
          {bodyPreview}
          <div hidden={Boolean(bodyPreview)}>
          {source === null && (propertySourceOnly ? <button type="button" className="qx-btn qx-btn--ghost" onClick={toSource}>在源码中编辑属性（保留完整 YAML）</button> : <Properties props={props} onChange={updateProperties} />)}
          {source !== null ? (
            <textarea className="se-source" onSelect={event => { const el = event.currentTarget; reportSelection(el.selectionStart < el.selectionEnd ? { start: el.selectionStart, end: el.selectionEnd, text: el.value.slice(el.selectionStart, el.selectionEnd) } : null) }} value={source} spellCheck={false} readOnly={readOnly} onChange={(e) => { const el = e.currentTarget; setSource(el.value); raw.current = el.value; callback.current?.(el.value); reportSelection(el.selectionStart < el.selectionEnd ? { start: el.selectionStart, end: el.selectionEnd, text: el.value.slice(el.selectionStart, el.selectionEnd) } : null) }} aria-label="Markdown 源码" />
          ) : (
            <EditorContent editor={editor} />
          )}
          </div>
        </div>

        {menu && items.length && source === null && !bodyPreview ? (
          <div className="se-pop se-suggest" style={{ left: menu.x, top: menu.y }} role="listbox" onMouseDown={(e) => e.preventDefault()}>
            {menu.kind === 'wiki' ? <p className="se-pop__label">链接到笔记</p> : null}
            {menu.kind === 'wiki'
              ? wikiItems.map((it, i) => (
                  <button key={it.label + it.create} type="button" role="option" aria-selected={i === activeIndex} className="se-suggest__item" onMouseEnter={() => setMenu({ ...menu, index: i })} onClick={() => runMenuItem.current(i)}>
                    {it.create ? <PlusIcon /> : <LinkSimpleIcon />}
                    <span>{it.create ? `新建「${it.label}」` : it.label}</span>
                  </button>
                ))
              : slashItems.map((it, i) => (
                  <button key={it.label} type="button" role="option" aria-selected={i === activeIndex} className="se-suggest__item" onMouseEnter={() => setMenu({ ...menu, index: i })} onClick={() => runMenuItem.current(i)}>
                    {it.icon}<span>{it.label}</span><kbd>{it.hint}</kbd>
                  </button>
                ))}
          </div>
        ) : null}

        {link && !bodyPreview ? (
          <form className="se-pop se-linkpop" style={{ left: link.x, top: link.y }} onSubmit={(e) => { e.preventDefault(); applyLink(link.href) }}>
            <LinkIcon />
            <input autoFocus placeholder="粘贴链接，回车确认" value={link.href} onChange={(e) => setLink({ ...link, href: e.target.value })} onKeyDown={(e) => e.key === 'Escape' && setLink(null)} />
            {editor.isActive('link') ? <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon se-tb" aria-label="移除链接" onClick={() => applyLink('')}><TrashIcon /></button> : null}
          </form>
        ) : null}
      </div>

      {source !== null && !bodyPreview && sourceSelection && 'start' in sourceSelection && selectionActions.length > 0 && <div className="se-source-bubble se-bubble" role="toolbar" aria-label="源码选区操作">{selectionActions.map(action => <button key={action.id} type="button" className="qx-btn qx-btn--ghost se-bubble__text" disabled={action.disabled} onMouseDown={event => event.preventDefault()} onClick={() => action.run(editor, sourceSelection.text, sourceSelection)}>{action.icon}{action.label}</button>)}</div>}

      <BubbleMenu editor={editor} shouldShow={({ editor: ed, state }) => !bodyPreview && !state.selection.empty && !ed.isActive('codeBlock') && !ed.isActive('image') && source === null} options={{ placement: 'top', offset: 10 }}>
        <div className="se-bubble">
          <button type="button" aria-label="加粗" aria-pressed={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><TextBIcon /></button>
          <button type="button" aria-label="斜体" aria-pressed={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><TextItalicIcon /></button>
          <button type="button" aria-label="删除线" aria-pressed={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><TextStrikethroughIcon /></button>
          <button type="button" aria-label="高亮" aria-pressed={editor.isActive('highlight')} onClick={() => editor.chain().focus().toggleMark('highlight').run()}><HighlighterIcon /></button>
          <button type="button" aria-label="行内代码" aria-pressed={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}><CodeIcon /></button>
          <button type="button" aria-label="链接" aria-pressed={editor.isActive('link')} onClick={openLink}><LinkIcon /></button>
          {selectionActions.length ? <span className="se-bubble__sep" /> : null}
          {selectionActions.map((a) => (
            <button key={a.id} type="button" className="qx-btn qx-btn--ghost se-bubble__text" disabled={a.disabled} onMouseDown={event => event.preventDefault()} onClick={() => { const { from, to } = editor.state.selection; a.run(editor, editor.state.doc.textBetween(from, to, ' '), reportSelection(mapMarkdownSelection(editor, raw.current))) }}>{a.icon}{a.label}</button>
          ))}
        </div>
      </BubbleMenu>

      <footer className="se-status">
        <span>{words.toLocaleString()} 字</span>
        <span>{editor.storage.characterCount.characters().toLocaleString()} 字符</span>
        <span>约 {Math.max(1, Math.round(words / 400))} 分钟</span>
        {statusContent}
        <span className="se-spacer" />
        {source !== null ? <span className="se-status__mode">源码模式 · Markdown</span> : focusMode ? <span className="se-status__mode">专注模式</span> : null}
        <span className="se-status__save" data-state={saveState}>{saveState === 'saving' ? '保存中…' : saveState === 'dirty' ? '尚未保存' : saveState === 'error' ? '保存失败，修改仍在' : '已保存'}</span>
      </footer>

      {help ? <ShortcutHelp onClose={() => setHelp(false)} /> : null}
    </div>
  )
}

function BlockSelect({ value, onPick }: { value: string; onPick: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', off)
    return () => document.removeEventListener('pointerdown', off)
  }, [open])
  return (
    <div className="se-anchor" ref={root}>
      <button type="button" className="qx-btn qx-btn--ghost se-blockselect" aria-expanded={open} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(!open)}>{value}<CaretDownIcon /></button>
      {open ? (
        <div className="se-pop se-pop--menu">
          {['正文', '标题 1', '标题 2', '标题 3', '引用', '代码块'].map((v) => (
            <button key={v} type="button" className="se-suggest__item" aria-selected={v === value} onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(v); setOpen(false) }}>
              <span className={`se-blockselect__sample se-blockselect__sample--${['正文', '标题 1', '标题 2', '标题 3', '引用', '代码块'].indexOf(v)}`}>{v}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/* 属性：Obsidian 的 frontmatter。源码模式里显示成 YAML，编辑模式里是可改的表格。 */
function Properties({ props, onChange }: { props: Property[]; onChange: (p: Property[]) => void }) {
  const [open, setOpen] = useState(true)
  if (!props.length) {
    return <button type="button" className="qx-btn qx-btn--ghost se-props__add-first" onClick={() => onChange([{ key: '', value: '' }])}><PlusIcon /> 添加属性</button>
  }
  return (
    <section className="se-props" aria-label="属性">
      <button type="button" className="se-props__head" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <CaretDownIcon /> : <CaretUpIcon />} 属性 <span>{props.length}</span></button>
      {open ? (
        <div className="se-props__rows">
          {props.map((p, i) => (
            <div key={i} className="se-props__row">
              <input className="se-props__key" value={p.key} placeholder="名称" onChange={(e) => onChange(props.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />
              {p.key === 'tags' ? (
                <div className="se-props__tags">
                  {p.value.split(',').map((t) => t.trim()).filter(Boolean).map((t) => <span key={t} className="se-chip">#{t}</span>)}
                  <input value={p.value} onChange={(e) => onChange(props.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} aria-label="标签，用逗号分隔" />
                </div>
              ) : (
                <input className="se-props__val" value={p.value} placeholder="空" onChange={(e) => onChange(props.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
              )}
              <button type="button" className="qx-btn qx-btn--ghost qx-btn--icon se-tb" aria-label="删除属性" onClick={() => onChange(props.filter((_, j) => j !== i))}><XIcon /></button>
            </div>
          ))}
          <button type="button" className="qx-btn qx-btn--ghost se-props__add" onClick={() => onChange([...props, { key: '', value: '' }])}><PlusIcon /> 添加属性</button>
        </div>
      ) : null}
    </section>
  )
}

function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const groups: [string, [string, string][]][] = [
    ['格式', [['加粗', '⌘ B'], ['斜体', '⌘ I'], ['下划线', '⌘ U'], ['删除线', '⇧ ⌘ S'], ['高亮', '⇧ ⌘ H'], ['行内代码', '⌘ E'], ['链接', '⌘ K']]],
    ['段落', [['标题 1–3', '# 空格'], ['无序列表', '- 空格'], ['有序列表', '1. 空格'], ['任务', '[ ] 空格'], ['引用', '> 空格'], ['代码块', '``` 回车'], ['分割线', '---']]],
    ['编辑器', [['插入菜单', '/'], ['链接笔记', '[['], ['查找', '⌘ F'], ['替换', '⌥ ⌘ F'], ['撤销 / 重做', '⌘ Z / ⇧ ⌘ Z'], ['表格跳格', 'Tab'], ['快捷键', '⌘ /']]],
  ]
  return (
    <div className="se-help" role="dialog" aria-label="快捷键">
      <header><strong>快捷键</strong><button type="button" className="qx-btn qx-btn--ghost qx-btn--icon se-tb" aria-label="关闭" onClick={onClose}><XIcon /></button></header>
      <div className="se-help__grid">
        {groups.map(([title, rows]) => (
          <section key={title}>
            <h4>{title}</h4>
            {rows.map(([a, b]) => <p key={a}><span>{a}</span><kbd>{b}</kbd></p>)}
          </section>
        ))}
      </div>
    </div>
  )
}
