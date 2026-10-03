import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowUpIcon,
  BooksIcon,
  CaretDownIcon,
  CheckIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  PlusIcon,
  StopIcon,
  XIcon,
} from '@phosphor-icons/react'

/*
 * 公共输入框（参照稿）。真实对应 conversation-view/ConversationComposer。
 *   AgentComposer：/agent 普通对话，一横条。
 *   ResearchComposer：研究界面和所有嵌入式 Agent 面板（研究工作区、写作工作台……）共用的详细版。
 * 任何页面需要和 Agent 对话，都用这里的组件，不各写一套。
 *
 * 联网：去掉开关，默认开启。真实代码里 webSearchEnabled 初始值改成 true，「⋯」菜单里的「联网搜索」按钮删掉；
 * 请求照旧带上这个字段，后端不用改。
 */
/* Agent 页：一横条。内容超过一行时整条长高，圆角从胶囊变成面板。 */
export function AgentComposer() {
  const [text, setText] = useState('')
  const multiline = text.includes('\n') || text.length > 40
  return (
    <form className="ch-bar-composer" data-multiline={multiline} onSubmit={(e) => e.preventDefault()}>
      <PlusMenu />
      <AutoTextarea value={text} onChange={setText} placeholder="问一个问题" label="问 Everplain" />
      <ModelPicker />
      <SendButton enabled={!!text.trim()} />
    </form>
  )
}

/* 研究页：上面写，底下一行操作；框下托盘放研究专属的项目和材料库。 */
export function ResearchComposer({ onSend, placeholder = '描述你想弄清楚的问题', initialFiles = [{ name: '访谈记录-B.docx', status: '已添加' }, { name: '田野笔记.pdf', status: '等待解析' }], tray = true, busy = false }: { onSend?: (text: string) => void; placeholder?: string; initialFiles?: { name: string; status: string }[]; tray?: boolean; busy?: boolean } = {}) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState(initialFiles)
  const submit = () => {
    if (!text.trim() || busy) return
    onSend?.(text.trim())
    setText('')
  }
  return (
    <div className="ch-research">
      <form className="ch-box" onSubmit={(e) => { e.preventDefault(); submit() }} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && (e.target as HTMLElement).tagName === 'TEXTAREA') { e.preventDefault(); submit() } }}>
        {files.length ? (
          <div className="ch-files">
            {files.map((f) => (
              <span key={f.name} className="ch-file">
                <FileTextIcon />
                <span className="ch-file__name">{f.name}</span>
                <span className="ch-file__status">{f.status}</span>
                <button type="button" aria-label={`移除附件 ${f.name}`} onClick={() => setFiles(files.filter((x) => x !== f))}><XIcon /></button>
              </span>
            ))}
          </div>
        ) : null}
        <AutoTextarea value={text} onChange={setText} placeholder={placeholder} label="和 Agent 讨论你的研究" minRows={2} />
        <div className="ch-box__row">
          <PlusMenu />
          <span className="ch-spacer" />
          <ModelPicker />
          {onSend ? (
            <button type="submit" className="ch-send" aria-label={busy ? '停止生成' : '发送给 Everplain'} disabled={!busy && !text.trim()}>{busy ? <StopIcon weight="fill" /> : <ArrowUpIcon weight="bold" />}</button>
          ) : <SendButton enabled={!!text.trim()} stoppable />}
        </div>
      </form>
      {tray ? (
        <div className="ch-tray">
          <ProjectPicker />
          <button type="button" className="ch-tray__btn"><FolderOpenIcon /> 材料库</button>
        </div>
      ) : null}
    </div>
  )
}

/* ---------------- 共用 ---------------- */

function AutoTextarea({ value, onChange, placeholder, label, minRows = 1 }: { value: string; onChange: (v: string) => void; placeholder: string; label: string; minRows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [value])
  return <textarea ref={ref} rows={minRows} aria-label={label} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
}

function SendButton({ enabled, stoppable }: { enabled: boolean; stoppable?: boolean }) {
  const [busy, setBusy] = useState(false)
  if (busy) return <button type="button" className="ch-send" aria-label="停止生成" onClick={() => setBusy(false)}><StopIcon weight="fill" /></button>
  return <button type="submit" className="ch-send" aria-label="发送给 Everplain" disabled={!enabled} onClick={() => stoppable && enabled && setBusy(true)}><ArrowUpIcon weight="bold" /></button>
}

/* 点外面或按 Esc 关闭的小弹层。 */
function Popover({ trigger, children, align = 'left', className = '' }: { trigger: (open: boolean, toggle: () => void) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right'; className?: string }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', off)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', off); document.removeEventListener('keydown', esc) }
  }, [open])
  return (
    <div className="ch-anchor" ref={root}>
      {trigger(open, () => setOpen(!open))}
      {open ? <div className={`ch-pop ch-pop--${align} ${className}`}>{children(() => setOpen(false))}</div> : null}
    </div>
  )
}

/* 「+」：上传文件、从研究材料添加、知识来源（原来在顶栏「⋯」里）。 */
function PlusMenu() {
  const [kb, setKb] = useState('不使用知识库')
  return (
    <Popover
      trigger={(open, toggle) => <button type="button" className="ch-icon" aria-label="添加" aria-expanded={open} onClick={toggle}><PlusIcon /></button>}
    >
      {(close) => (
        <div className="ch-menu" role="menu">
          <button type="button" className="ch-menu__item" role="menuitem" onClick={close}><FilePlusIcon /> 上传文件</button>
          <button type="button" className="ch-menu__item" role="menuitem" onClick={close}><FolderOpenIcon /> 从研究材料添加</button>
          <div className="ch-menu__rule" />
          <p className="ch-menu__label"><BooksIcon /> 知识来源</p>
          {['不使用知识库', '毕业论文', '读书笔记', '我的资料'].map((k) => (
            <button key={k} type="button" className="ch-menu__item ch-menu__item--sub" role="menuitemradio" aria-checked={kb === k} onClick={() => setKb(k)}>
              {k}{kb === k ? <CheckIcon className="ch-menu__check" /> : null}
            </button>
          ))}
          <p className="ch-menu__hint">对话中切换会开启新对话</p>
        </div>
      )}
    </Popover>
  )
}

/*
 * 模型与思考强度。选模型 → 下面的强度档位只显示这个模型支持的；换模型时保留仍然可用的档位，否则回到默认。
 * 档位是离散的六档（无 / 低 / 中 / 高 / 很高 / 最高），滑块只停在档位上。生成中整块禁用并提示"结束后可调整"。
 */
const models = [
  { id: 'luna', name: 'GPT 6 Luna', note: '日常对话与研究', efforts: ['无', '低', '中', '高', '很高', '最高'], def: 2 },
  { id: 'sol', name: 'GPT 6.1 Sol', note: '更强的推理，回答更慢', efforts: ['低', '中', '高', '很高'], def: 1 },
  { id: 'mini', name: 'GPT 6 Mini', note: '快速回答', efforts: ['无', '低'], def: 0 },
]

function ModelPicker() {
  const [modelId, setModelId] = useState('luna')
  const [effort, setEffort] = useState('中')
  const model = models.find((m) => m.id === modelId)!
  const level = Math.max(0, model.efforts.indexOf(effort))
  const pick = (id: string) => {
    const next = models.find((m) => m.id === id)!
    setModelId(id)
    if (!next.efforts.includes(effort)) setEffort(next.efforts[next.def])
  }
  return (
    <Popover
      align="right"
      trigger={(open, toggle) => (
        <button type="button" className="ch-model" aria-expanded={open} aria-label={`模型与思考强度：${model.name} · ${effort}`} onClick={toggle}>
          {model.name} <span className="ch-model__effort">{effort}</span> <CaretDownIcon />
        </button>
      )}
    >
      {() => (
        <div className="ch-modelpop" role="dialog" aria-label="选择模型与思考强度">
          <p className="ch-modelpop__title">模型</p>
          <div className="ch-modelpop__list" role="radiogroup">
            {models.map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={m.id === modelId} className="ch-modelpop__model" onClick={() => pick(m.id)}>
                <span>
                  <strong>{m.name}</strong>
                  <small>{m.note}</small>
                </span>
                {m.id === modelId ? <CheckIcon /> : null}
              </button>
            ))}
          </div>
          <div className="ch-modelpop__effort">
            <div className="ch-modelpop__effort-head">
              <p className="ch-modelpop__title">思考强度</p>
              <span>{effort}</span>
            </div>
            <EffortSlider steps={model.efforts} value={level} onChange={(i) => setEffort(model.efforts[i])} />
            <p className="ch-modelpop__hint">越高想得越久，适合需要推理的问题</p>
          </div>
        </div>
      )}
    </Popover>
  )
}

/* 对话所属项目：可搜索；第一项「独立对话」表示不归属项目。 */
function ProjectPicker() {
  const [value, setValue] = useState('城市第三空间')
  const [q, setQ] = useState('')
  const options = ['独立对话', '城市第三空间', '短视频与注意力', '县城的人情社会']
  return (
    <Popover
      trigger={(open, toggle) => <button type="button" className="ch-tray__btn" aria-expanded={open} aria-label="对话所属项目" onClick={toggle}><FolderIcon /> {value} <CaretDownIcon /></button>}
    >
      {(close) => (
        <div className="ch-menu" role="dialog" aria-label="切换项目">
          <input className="ch-menu__search" placeholder="搜索项目" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          {options.filter((o) => o.includes(q)).map((o) => (
            <button key={o} type="button" className="ch-menu__item" role="menuitemradio" aria-checked={value === o} onClick={() => { setValue(o); close() }}>
              <FolderIcon /> {o}{value === o ? <CheckIcon className="ch-menu__check" /> : null}
            </button>
          ))}
        </div>
      )}
    </Popover>
  )
}

/*
 * 思考强度滑条。档位离散，但拖动是连续的：按住后圆点、填充条和上方气泡跟着指针走，气泡里的字实时换成最近的档位；
 * 松手后带一点回弹吸到那一档。点轨道任意位置直接跳过去；键盘左右键、Home/End 也能调。
 * 真实实现里 onChange 对应 selectionFromEffortStep()，只在松手或键盘时提交，拖动中不发请求。
 */
function EffortSlider({ steps, value, onChange }: { steps: readonly string[]; value: number; onChange: (i: number) => void }) {
  const track = useRef<HTMLDivElement>(null)
  const [drag, setDragState] = useState<number | null>(null)
  const live = useRef<number | null>(null)
  const setDrag = (v: number | null) => { live.current = v; setDragState(v) }
  const last = steps.length - 1
  const ratio = drag ?? (last ? value / last : 0)
  const nearest = Math.round(ratio * last)
  const shown = drag === null ? value : nearest
  const toRatio = (x: number) => {
    const r = track.current!.getBoundingClientRect()
    return Math.min(1, Math.max(0, (x - r.left) / r.width))
  }
  const down = (e: React.PointerEvent) => {
    if (!last) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag(toRatio(e.clientX))
  }
  const move = (e: React.PointerEvent) => { if (live.current !== null) setDrag(toRatio(e.clientX)) }
  const up = () => {
    if (live.current === null) return
    onChange(Math.round(live.current * last))
    setDrag(null)
  }
  const key = (e: React.KeyboardEvent) => {
    const next = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? value + 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? value - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? last : null
    if (next === null) return
    e.preventDefault()
    onChange(Math.min(last, Math.max(0, next)))
  }
  return (
    <div className="ch-effort" data-dragging={drag !== null}>
      <div
        ref={track}
        className="ch-effort__track"
        role="slider"
        tabIndex={0}
        aria-label="思考强度"
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={shown}
        aria-valuetext={steps[shown]}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={key}
        style={{ ['--r' as string]: ratio }}
      >
        <div className="ch-effort__rail">
          <div className="ch-effort__fill" />
        </div>
        {steps.map((s, i) => (
          <span key={s} className="ch-effort__tick" data-on={i <= nearest} style={{ left: `${last ? (i / last) * 100 : 0}%` }} />
        ))}
        <div className="ch-effort__thumb">
          <span className="ch-effort__bubble">{steps[shown]}</span>
        </div>
      </div>
      <div className="ch-effort__labels">
        {steps.map((s, i) => (
          <button key={s} type="button" data-on={i === shown} style={{ left: `${last ? (i / last) * 100 : 0}%` }} onClick={() => onChange(i)}>{s}</button>
        ))}
      </div>
    </div>
  )
}
