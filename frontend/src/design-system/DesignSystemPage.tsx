import { useEffect, useState, type ReactNode } from 'react'
import {
  ArrowUpIcon,
  BookmarkSimpleIcon,
  BooksIcon,
  ChatCircleIcon,
  ClockCounterClockwiseIcon,
  CopyIcon,
  DesktopIcon,
  DotsThreeIcon,
  ExportIcon,
  FileTextIcon,
  FolderIcon,
  GearSixIcon,
  GlobeIcon,
  HouseIcon,
  InfoIcon,
  LinkIcon,
  MagnifyingGlassIcon,
  MicrophoneIcon,
  MoonIcon,
  NoteIcon,
  PencilSimpleIcon,
  PlusIcon,
  SunIcon,
  TrashIcon,
  WarningCircleIcon,
  XIcon,
} from '@phosphor-icons/react'

type Scheme = 'system' | 'light' | 'dark'

const colorTokens = [
  ['canvas', '页面底'],
  ['surface', '卡片、输入框聚焦'],
  ['surface-raised', '菜单、弹窗'],
  ['surface-muted', '次级底'],
  ['surface-strong', '灰底控件、用户气泡'],
  ['ink', '标题'],
  ['ink-soft', '正文'],
  ['muted', '元信息'],
  ['faint', '占位符'],
  ['rule', '分隔线'],
  ['accent', '主按钮'],
  ['danger', '危险'],
  ['danger-soft', '危险底'],
  ['notice-soft', '提示底'],
  ['info', '链接、进行中'],
  ['warning', '待留意'],
  ['success', '完成'],
  ['highlight', '标注'],
  ['data-blue', '类别'],
  ['data-green', '类别'],
  ['data-teal', '类别'],
  ['data-rose', '类别'],
  ['data-amber', '类别'],
  ['data-violet', '类别'],
  ['data-rust', '类别'],
  ['data-olive', '类别'],
] as const

const typeTokens = [
  ['display', '今天想整理什么？', 'serif'],
  ['section', '我的知识库', 'serif'],
  ['title', '《乡土中国》读书笔记', 'serif'],
  ['reading', '差序格局是费孝通用来描述中国传统社会结构的概念，像石子投入水中荡开的波纹。', 'serif'],
  ['heading', '最近整理', 'ui'],
  ['body', '把这篇文章加入「城市研究」主题', 'ui'],
  ['control', '新建研究', 'ui'],
  ['meta', '2 小时前 · 12 条引用', 'ui'],
] as const

const radiusTokens = [
  ['mark', '行内高亮'],
  ['tag', '标签'],
  ['item', '侧栏行'],
  ['card', '卡片'],
  ['field', '多行输入'],
  ['panel', '面板'],
  ['modal', '弹窗'],
  ['pill', '按钮/单行输入'],
] as const

const shadowTokens = ['ring', 'card', 'composer', 'menu', 'panel', 'float'] as const

function useScheme(): [Scheme, (s: Scheme) => void] {
  const [scheme, setScheme] = useState<Scheme>(() => {
    try {
      return (localStorage.getItem('qx-ds-scheme') as Scheme) || 'system'
    } catch {
      return 'system'
    }
  })
  useEffect(() => {
    document.documentElement.style.colorScheme = scheme === 'system' ? '' : scheme
    try {
      localStorage.setItem('qx-ds-scheme', scheme)
    } catch {
      /* 隐私模式下读写会抛错，样张照常显示。 */
    }
  }, [scheme])
  return [scheme, setScheme]
}

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section className="ds-section" id={id}>
      <header className="ds-section__head">
        <h2 className="qx-section-title">{title}</h2>
        {note ? <p className="qx-meta">{note}</p> : null}
      </header>
      {children}
    </section>
  )
}

function Swatch({ token, use, scheme }: { token: string; use: string; scheme: Scheme }) {
  const [value, setValue] = useState('')
  useEffect(() => {
    const probe = document.createElement('i')
    probe.style.background = `var(--qx-color-${token})`
    document.body.append(probe)
    const rgb = getComputedStyle(probe).backgroundColor
    probe.remove()
    const parts = rgb.match(/\d+/g)?.slice(0, 3).map(Number) ?? []
    setValue(parts.length === 3 ? `#${parts.map((n) => n.toString(16).padStart(2, '0')).join('')}` : rgb)
  }, [token, scheme])
  return (
    <div className="ds-swatch">
      <span className="ds-swatch__chip" style={{ background: `var(--qx-color-${token})` }} />
      <div>
        <code>{token}</code>
        <p className="qx-meta">
          {use} · {value}
        </p>
      </div>
    </div>
  )
}

function TokenValue({ name }: { name: string }) {
  const [value, setValue] = useState('')
  useEffect(() => {
    setValue(getComputedStyle(document.documentElement).getPropertyValue(name).trim())
  }, [name])
  return <span className="qx-meta">{value}</span>
}

export function DesignSystemPage() {
  const [scheme, setScheme] = useScheme()
  const [tab, setTab] = useState<'chat' | 'work'>('chat')
  const [filters, setFilters] = useState<string[]>(['网页'])
  const [sync, setSync] = useState(true)
  const [current, setCurrent] = useState('library')

  const toggleFilter = (f: string) => setFilters((all) => (all.includes(f) ? all.filter((x) => x !== f) : [...all, f]))

  return (
    <div className="ds">
      <header className="ds-top">
        <div className="ds-top__brand">
          <img src="/src/assets/qunxue-brand-mark.svg" alt="" width={28} height={28} />
          <span>Everplain 设计样张</span>
        </div>
        <nav className="ds-top__nav">
          {[
            ['color', '颜色'],
            ['type', '字阶'],
            ['shape', '圆角与阴影'],
            ['buttons', '按钮'],
            ['inputs', '输入'],
            ['cards', '卡片'],
            ['lists', '列表与菜单'],
            ['chat', '对话'],
            ['feedback', '提示与弹窗'],
          ].map(([id, label]) => (
            <a key={id} href={`#${id}`} className="qx-btn qx-btn--ghost">
              {label}
            </a>
          ))}
        </nav>
        <div className="qx-segmented" role="group" aria-label="外观">
          <button aria-pressed={scheme === 'system'} onClick={() => setScheme('system')} aria-label="跟随系统">
            <DesktopIcon />
          </button>
          <button aria-pressed={scheme === 'light'} onClick={() => setScheme('light')} aria-label="浅色">
            <SunIcon />
          </button>
          <button aria-pressed={scheme === 'dark'} onClick={() => setScheme('dark')} aria-label="深色">
            <MoonIcon />
          </button>
        </div>
      </header>

      <main className="ds-main">
        <div className="ds-hero">
          <h1 className="qx-display">今天想整理什么？</h1>
          <div className="qx-composer ds-hero__composer">
            <button className="qx-btn qx-btn--ghost qx-btn--icon qx-btn--lg" aria-label="添加资料">
              <PlusIcon />
            </button>
            <input placeholder="问问你的知识库，或者丢一个链接进来" />
            <button className="qx-btn qx-btn--ghost qx-btn--icon qx-btn--lg" aria-label="语音">
              <MicrophoneIcon />
            </button>
            <button className="qx-btn qx-btn--primary qx-btn--icon qx-btn--lg" aria-label="发送">
              <ArrowUpIcon weight="bold" />
            </button>
          </div>
          <div className="ds-row ds-row--center">
            <button className="qx-tag qx-tag--outline">
              <BookmarkSimpleIcon /> 导入 Chrome 书签
            </button>
            <button className="qx-tag qx-tag--outline">
              <NoteIcon /> 导入 Apple 备忘录
            </button>
            <button className="qx-tag qx-tag--outline">
              <FolderIcon /> 导入 Obsidian
            </button>
          </div>
        </div>

        <Section id="color" title="颜色" note="中性色没有改；状态色与类别色取自各页原有颜色。切右上角的外观看深色。">
          <div className="ds-grid ds-grid--swatch">
            {colorTokens.map(([token, use]) => (
              <Swatch key={token} token={token} use={use} scheme={scheme} />
            ))}
          </div>
        </Section>

        <Section id="type" title="字阶" note="衬线给标题与阅读，无衬线给界面。地板 13px。">
          <div className="ds-type">
            {typeTokens.map(([token, sample, family]) => (
              <div key={token} className="ds-type__row">
                <div className="ds-type__label">
                  <code>{token}</code>
                  <TokenValue name={`--qx-text-${token}`} />
                </div>
                <p
                  style={{
                    fontFamily: family === 'serif' ? 'var(--qx-font-reading)' : 'var(--qx-font-ui)',
                    fontSize: `var(--qx-text-${token})`,
                    lineHeight: `var(--qx-text-${token}--line-height)`,
                    letterSpacing: `var(--qx-text-${token}--letter-spacing, normal)`,
                    fontWeight: `var(--qx-text-${token}--font-weight, 400)`,
                    color: 'var(--qx-color-ink)',
                  }}
                >
                  {sample}
                </p>
              </div>
            ))}
          </div>
        </Section>

        <Section id="shape" title="圆角与阴影" note="圆角按物件分档；阴影是发丝环加大范围淡投影。">
          <div className="ds-grid ds-grid--shape">
            {radiusTokens.map(([token, use]) => (
              <div key={token} className="ds-shape">
                <div className="ds-shape__box" style={{ borderRadius: `var(--qx-radius-${token})` }} />
                <code>{token}</code>
                <p className="qx-meta">
                  {use} · <TokenValue name={`--qx-radius-${token}`} />
                </p>
              </div>
            ))}
          </div>
          <div className="ds-grid ds-grid--shape">
            {shadowTokens.map((token) => (
              <div key={token} className="ds-shape">
                <div className="ds-shape__box ds-shape__box--shadow" style={{ boxShadow: `var(--qx-shadow-${token})` }} />
                <code>shadow-{token}</code>
              </div>
            ))}
          </div>
        </Section>

        <Section id="buttons" title="按钮" note="primary 一页最多一个；ghost 用在工具栏和卡片角落。">
          <div className="ds-row">
            <button className="qx-btn qx-btn--primary">新建研究</button>
            <button className="qx-btn qx-btn--secondary">导入资料</button>
            <button className="qx-btn">稍后再说</button>
            <button className="qx-btn qx-btn--ghost">
              <PencilSimpleIcon /> 编辑
            </button>
            <button className="qx-btn qx-btn--danger">
              <TrashIcon /> 删除
            </button>
            <button className="qx-btn qx-btn--primary" disabled>
              不可用
            </button>
          </div>
          <div className="ds-row">
            <button className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="复制">
              <CopyIcon />
            </button>
            <button className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="分享">
              <ExportIcon />
            </button>
            <button className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="更多">
              <DotsThreeIcon weight="bold" />
            </button>
            <button className="qx-btn qx-btn--secondary qx-btn--icon" aria-label="关闭">
              <XIcon />
            </button>
          </div>
          <div className="ds-narrow">
            <button className="qx-btn qx-btn--primary qx-btn--lg qx-btn--block">继续</button>
            <button className="qx-btn qx-btn--secondary qx-btn--lg qx-btn--block">
              <GlobeIcon /> 用 Google 账号登录
            </button>
          </div>
        </Section>

        <Section id="inputs" title="输入" note="单行是灰底胶囊，多行是大圆角，聚焦时变白并加一道墨色环。">
          <div className="ds-narrow">
            <div className="qx-field">
              <label htmlFor="ds-email">邮箱</label>
              <input id="ds-email" className="qx-input" placeholder="手机号码或电邮地址" />
              <small>只用来登录，不会发推广邮件。</small>
            </div>
            <label className="qx-search">
              <MagnifyingGlassIcon />
              <input placeholder="搜索资料、笔记、对话" />
            </label>
            <textarea className="qx-textarea" placeholder="写下这份资料对你有什么用，Agent 整理时会参考。" />
          </div>
          <div className="ds-row">
            <div className="qx-segmented" role="tablist">
              <button role="tab" aria-selected={tab === 'chat'} onClick={() => setTab('chat')}>
                聊天
              </button>
              <button role="tab" aria-selected={tab === 'work'} onClick={() => setTab('work')}>
                研究
              </button>
            </div>
            <label className="ds-row ds-row--tight">
              <button className="qx-switch" role="switch" aria-checked={sync} onClick={() => setSync(!sync)} aria-label="自动同步" />
              <span>自动同步 Obsidian</span>
            </label>
          </div>
          <div className="ds-row">
            {['网页', '笔记', 'PDF', '视频', '书签'].map((f) => (
              <button key={f} className="qx-tag" aria-pressed={filters.includes(f)} onClick={() => toggleFilter(f)}>
                {f}
              </button>
            ))}
            <span className="qx-tag qx-tag--outline">城市研究</span>
            <span className="qx-avatar">HU</span>
          </div>
        </Section>

        <Section id="cards" title="卡片" note="资料卡片网格是主界面；可点的卡片悬停时浮起。">
          <div className="ds-grid ds-grid--cards">
            {[
              { icon: <GlobeIcon />, kind: '网页', title: '为什么城市需要第三空间', body: '奥尔登堡把家和单位之外的咖啡馆、书店称为第三空间，它们让陌生人保持低成本的联系。', meta: '3 天前 · 4 条关联' },
              { icon: <FileTextIcon />, kind: 'PDF', title: '乡土中国', body: '差序格局、礼治秩序、无讼。整理出 18 个知识点，其中 6 个和你的城市研究有关。', meta: '上周 · 18 个知识点' },
              { icon: <NoteIcon />, kind: '笔记', title: '访谈提纲草稿', body: '先问日常动线，再问"你上一次和陌生人聊天是在哪里"。', meta: '昨天 · 来自 Apple 备忘录' },
            ].map((c) => (
              <article key={c.title} className="qx-card qx-card--interactive" tabIndex={0}>
                <span className="qx-tag">
                  {c.icon} {c.kind}
                </span>
                <h3 className="qx-card__title ds-card-title">{c.title}</h3>
                <p className="qx-card__body">{c.body}</p>
                <div className="qx-card__meta">{c.meta}</div>
              </article>
            ))}
            <article className="qx-card qx-card--muted ds-card-empty">
              <PlusIcon />
              <p className="qx-heading">添加资料</p>
              <p className="qx-meta">链接、文件，或者一段想法</p>
            </article>
          </div>
          <div className="qx-panel ds-panel">
            <h3 className="qx-heading">面板</h3>
            <p className="qx-card__body">侧栏抽屉、设置页里的一整块用面板，比卡片大一档圆角，投影更深。</p>
          </div>
        </Section>

        <Section id="lists" title="列表与菜单" note="侧栏行、会话列表、菜单项共用一种行；选中态是灰底。">
          <div className="ds-split">
            <aside className="ds-sidebar">
              {[
                ['home', <HouseIcon key="i" />, '首页'],
                ['library', <BooksIcon key="i" />, '知识库'],
                ['agent', <ChatCircleIcon key="i" />, 'Agent'],
                ['history', <ClockCounterClockwiseIcon key="i" />, '最近'],
              ].map(([id, icon, label]) => (
                <button key={id as string} className="qx-item" aria-current={current === id ? 'page' : undefined} onClick={() => setCurrent(id as string)}>
                  {icon}
                  {label}
                </button>
              ))}
              <p className="qx-group-label">研究</p>
              <button className="qx-item">
                城市第三空间 <span className="qx-item__trail">12</span>
              </button>
              <button className="qx-item">
                短视频与注意力 <span className="qx-item__trail">5</span>
              </button>
              <button className="qx-item">
                <GearSixIcon /> 设置
              </button>
            </aside>
            <div className="qx-menu" role="menu">
              <button className="qx-item" role="menuitem">
                <PencilSimpleIcon /> 重命名
              </button>
              <button className="qx-item" role="menuitem">
                <LinkIcon /> 复制链接
              </button>
              <button className="qx-item" role="menuitem">
                <ExportIcon /> 导出 Markdown
              </button>
              <div className="qx-menu__divider" />
              <button className="qx-item ds-danger-item" role="menuitem">
                <TrashIcon /> 删除
              </button>
            </div>
          </div>
        </Section>

        <Section id="chat" title="对话" note="你的话放在灰气泡里；Agent 的回答直接写成衬线正文，不套气泡。">
          <div className="ds-chat">
            <div className="qx-bubble">第三空间这个概念，我的资料里有哪些支持和反驳？</div>
            <div className="qx-prose">
              <p>
                你收的资料里有三处直接谈到第三空间。奥尔登堡的原始定义强调"中立地带"和"常客"
                <button className="qx-cite">1</button>，你的访谈提纲草稿正好在追问这一点
                <button className="qx-cite">2</button>。
              </p>
              <p>
                反驳主要来自《乡土中国》的读书笔记：在差序格局里，公共场所的陌生人关系本来就弱
                <button className="qx-cite">3</button>，这和奥尔登堡的前提不一样。
              </p>
            </div>
            <div className="ds-row ds-row--tight">
              <button className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="复制">
                <CopyIcon />
              </button>
              <button className="qx-btn qx-btn--ghost">
                <BookmarkSimpleIcon /> 存为笔记
              </button>
            </div>
            <div className="qx-composer">
              <button className="qx-btn qx-btn--ghost qx-btn--icon qx-btn--lg" aria-label="添加">
                <PlusIcon />
              </button>
              <input placeholder="接着问" />
              <button className="qx-btn qx-btn--primary qx-btn--icon qx-btn--lg" aria-label="发送">
                <ArrowUpIcon weight="bold" />
              </button>
            </div>
          </div>
        </Section>

        <Section id="feedback" title="提示与弹窗">
          <div className="ds-narrow ds-narrow--wide">
            <div className="qx-notice">
              <InfoIcon />
              <span>正在整理 24 份书签，可以先去做别的，好了会告诉你。</span>
            </div>
            <div className="qx-notice qx-notice--danger">
              <WarningCircleIcon />
              <span>有 2 个网页打不开，没有导入。</span>
            </div>
            <div className="qx-modal ds-modal">
              <h3 className="qx-section-title">删除这份资料？</h3>
              <p className="qx-card__body">相关的 4 条关联和 2 处引用会一起失效，删除后不能恢复。</p>
              <div className="ds-row ds-row--end">
                <button className="qx-btn qx-btn--secondary">取消</button>
                <button className="qx-btn qx-btn--danger">删除</button>
              </div>
            </div>
          </div>
        </Section>
      </main>
    </div>
  )
}
