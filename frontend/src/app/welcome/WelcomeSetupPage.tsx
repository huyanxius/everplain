import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftIcon, ArrowRightIcon, ArrowUpRightIcon, CheckIcon, FileTextIcon, FolderOpenIcon, GlobeIcon } from '@phosphor-icons/react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import type { ReactNode } from 'react'
import { AgentAvatar, agentAvatarPresets, type AgentAvatarId } from '../../modules/agent-avatar'
import { readAgentProfile, saveAgentProfile, type PersonalAgentProfileUpdate } from '../../modules/agent-profile'
import { importFiles, readImportBatches, retryImport } from '../../modules/knowledge-import'
import { ErrorState, LoadingState } from '../ui/States'
import logo from '../../assets/qunxue-brand-mark.svg'
import './welcome-setup.css'

const steps = ['带来一些资料', '认识你的伙伴', '聊聊你自己', '让思绪相遇']
const styles = [{ id: 'clear', title: '清晰直接', detail: '先说重点，清楚利落' }, { id: 'warm', title: '温和自然', detail: '耐心倾听，一起想办法' }, { id: 'rigorous', title: '严谨细致', detail: '重视依据，深入推敲' }, { id: 'curious', title: '好奇开放', detail: '发现联系，探索可能' }] as const
const colors = ['#a5b69c', '#c7b99d', '#bc9c8c', '#98aeb5', '#aaa0b9', '#c2ae80', '#a9aaa0']
const occupations = ['学生', '研究者', '产品经理', '老师', '创作者', '自由职业']
const goalOptions = ['整理阅读笔记', '查找收藏资料', '研究一个问题', '辅助写作', '准备课程', '探索新领域']

export function OnboardingGate({ userId, children }: { userId: string | null; children: ReactNode }) {
  const location = useLocation()
  const bypass = location.pathname === '/welcome/setup'
  const profile = useQuery({ queryKey: ['agent-profile', userId], queryFn: readAgentProfile, enabled: Boolean(userId) && !bypass, staleTime: 30_000 })
  if (!userId || bypass) return children
  if (profile.isPending) return <LoadingState message="正在准备你的空间" />
  if (profile.isError) return <ErrorState detail={profile.error.message} onRetry={() => { void profile.refetch() }} />
  if (!profile.data.setup_completed) return <Navigate to="/welcome/setup" replace />
  return children
}

export function WelcomeSetupPage({ userId }: { userId: string | null }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const profile = useQuery({ queryKey: ['agent-profile', userId], queryFn: readAgentProfile })
  const batches = useQuery({ queryKey: ['import-batches', userId], queryFn: readImportBatches,
    refetchInterval: query => query.state.data?.some(batch => batch.status === 'processing') ? 1200 : false })
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [avatar, setAvatar] = useState<AgentAvatarId>('cheng')
  const [color, setColor] = useState(colors[0])
  const [style, setStyle] = useState<typeof styles[number]['id']>('clear')
  const [occupation, setOccupation] = useState('')
  const [industry, setIndustry] = useState('')
  const [goals, setGoals] = useState<string[]>([])
  const [interests, setInterests] = useState('')
  const [additional, setAdditional] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const p = profile.data
    if (!p) return
    setStep(p.setup_completed ? 0 : Math.min(p.setup_step, 3)); setName(p.name === 'Everplain' ? '' : p.name)
    setAvatar(p.avatar_id as AgentAvatarId); setColor(p.color); setStyle(p.speaking_style as typeof style)
    setOccupation(p.questionnaire.occupation ?? ''); setIndustry(p.questionnaire.industry ?? '')
    setGoals(p.questionnaire.goals ?? []); setInterests((p.questionnaire.interests ?? []).join('、'))
    setAdditional(p.questionnaire.additional ?? '')
  }, [profile.data])
  const items = batches.data ?? []
  const total = items.reduce((n, b) => n + b.total, 0)
  const finished = items.reduce((n, b) => n + b.finished, 0)
  const processing = items.some(b => b.status === 'processing')
  async function change(next: number, skip = false) {
    if (!profile.data || busy) return
    setBusy(true); setError('')
    const update: PersonalAgentProfileUpdate = { expected_version: profile.data.version, setup_step: next, setup_completed: next === 4 }
    if (!skip && step === 1) Object.assign(update, { name: name.trim() || 'Everplain', avatar_id: avatar, color, speaking_style: style })
    if (!skip && step === 2) update.questionnaire = { occupation, industry, goals, interests: interests.split(/[、,，\n]/).map(x => x.trim()).filter(Boolean), additional }
    try {
      const saved = await saveAgentProfile(update)
      queryClient.setQueryData(['agent-profile', userId], saved)
      if (alive.current) { if (next === 4) navigate('/my/graph'); else setStep(next) }
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : '暂时无法保存') }
    finally { if (alive.current) setBusy(false) }
  }
  async function upload(source: 'chrome' | 'obsidian', files: FileList | null) {
    if (!files?.length) return
    setBusy(true); setError('')
    try { await importFiles(source, Array.from(files)); await batches.refetch() }
    catch (e) { setError(e instanceof Error ? e.message : '文件暂时无法读取') }
    finally { setBusy(false) }
  }
  if (profile.isPending) return <LoadingState message="正在铺开你的知识空间" />
  if (profile.isError) return <ErrorState detail={profile.error.message} onRetry={() => { void profile.refetch() }} />
  const titles = ['把散落的想法，带到一起。', '给你的伙伴一点个性。', '从了解你开始。', '你的空间，正在生长。']
  const intros = ['舍不得关掉的网页、写了一半的笔记，都可以从这里开始。', '一个熟悉的名字，一种舒服的交流方式。以后也能随时调整。', '几个简单的选择，让它更懂得怎么帮你。每一项都可以跳过。', '资料会保留原文和出处。可以先看看图谱，剩下的在后台继续。']
  const agentState = processing && step === 3 ? 'work' : step === 1 ? 'greet' : step === 2 ? 'think' : 'idle'
  // 布局：顶栏（品牌 · 进度 · 跳过）→ 角色 → 衬线标题 → 本步内容 → 主按钮。四步的状态与保存逻辑在上面，这里只管排布。
  return <main className="ep-setup">
    <header className="ep-setup__top">
      <Link to="/" className="ep-setup__brand"><img src={logo} alt="" />Everplain</Link>
      <nav className="ep-setup__steps" aria-label="引导进度">{steps.map((label, i) => <button key={label} type="button" aria-label={label} title={label} disabled={busy || i > step} aria-current={i === step ? 'step' : undefined} data-done={i < step} onClick={() => { void change(i, true) }} />)}</nav>
      <button type="button" className="qx-btn qx-btn--ghost ep-setup__skip" disabled={busy} onClick={() => { void change(step + 1, true) }}>{step === 3 ? '先进入，后台继续' : '暂时跳过'}</button>
    </header>

    <section className="ep-setup__stage" aria-labelledby="setup-title">
      <AgentAvatar avatar={avatar} color={color} state={agentState} size={step === 3 ? 128 : 104} label={step === 1 && name ? name : undefined} />
      <h1 id="setup-title" className="qx-display">{titles[step]}</h1>
      <p className="ep-setup__intro">{intros[step]}</p>

      {step === 0 && <div className="ep-setup__imports">
        <label className="ep-import-choice"><span className="ep-import-choice__icon"><GlobeIcon size={22} /></span><span className="ep-import-choice__text"><strong>Chrome 书签</strong><small>从浏览器导出的 HTML 文件</small></span><ArrowUpRightIcon size={18} /><input aria-label="导入 Chrome 书签" type="file" accept=".html,.htm" disabled={busy} onChange={e => { void upload('chrome', e.target.files); e.target.value = '' }} /></label>
        <label className="ep-import-choice"><span className="ep-import-choice__icon"><FolderOpenIcon size={22} /></span><span className="ep-import-choice__text"><strong>Obsidian / Markdown</strong><small>选择笔记文件夹，保留双链与目录</small></span><ArrowUpRightIcon size={18} /><input aria-label="导入 Markdown 文件夹" type="file" multiple {...{ webkitdirectory: '' }} disabled={busy} onChange={e => { void upload('obsidian', e.target.files); e.target.value = '' }} /></label>
        {total > 0 && <div className="qx-notice ep-import-summary" role="status"><CheckIcon size={18} /><span>已接收 {total} 条资料 · 已处理 {finished} 条</span></div>}
        <p className="ep-setup__hint">默认只有你能看到。以后也能继续导入。</p>
      </div>}

      {step === 1 && <div className="ep-setup__identity">
        <label className="ep-field ep-field--center">你想叫它什么？<input className="qx-input ep-name-input" value={name} maxLength={40} placeholder="例如：小叶" onChange={e => setName(e.target.value)} /></label>
        <fieldset><legend>挑一个合眼缘的伙伴</legend><div className="ep-avatar-options">{agentAvatarPresets.map(p => <button type="button" key={p.id} aria-label={p.name} aria-pressed={avatar === p.id} onClick={() => setAvatar(p.id)}><AgentAvatar avatar={p.id} color={avatar === p.id ? color : p.color} size={52} playing={avatar === p.id} /><span>{p.name}</span></button>)}</div></fieldset>
        <div className="ep-color-options" aria-label="角色颜色">{colors.map(c => <button key={c} aria-label={`颜色 ${c}`} aria-pressed={color === c} style={{ background: c }} onClick={() => setColor(c)}>{color === c && <CheckIcon size={14} />}</button>)}</div>
        <fieldset><legend>你喜欢怎样的交流方式？</legend><div className="ep-style-options">{styles.map(s => <button key={s.id} aria-pressed={style === s.id} onClick={() => setStyle(s.id)}><strong>{s.title}</strong><span>{s.detail}</span></button>)}</div></fieldset>
      </div>}

      {step === 2 && <div className="ep-setup__questions">
        <fieldset><legend>现在的你，更多时候是……</legend><div className="ep-option-chips">{occupations.map(o => <button key={o} aria-pressed={occupation === o} onClick={() => setOccupation(occupation === o ? '' : o)}>{o}</button>)}</div></fieldset>
        <label className="ep-field">所在领域 <span>选填</span><input className="qx-input" value={industry} maxLength={160} onChange={e => setIndustry(e.target.value)} placeholder="例如：教育、设计、互联网" /></label>
        <fieldset><legend>希望它帮你做些什么？<small>可以多选</small></legend><div className="ep-option-chips">{goalOptions.map(g => <button key={g} aria-pressed={goals.includes(g)} onClick={() => setGoals(goals.includes(g) ? goals.filter(x => x !== g) : [...goals, g])}>{g}</button>)}</div></fieldset>
        <label className="ep-field">最近感兴趣的事 <span>选填</span><input className="qx-input" value={interests} onChange={e => setInterests(e.target.value)} placeholder="例如：城市、认知科学、电影，用顿号分隔" /></label>
        <details className="ep-setup__optional"><summary>还有什么想告诉它的？</summary><textarea className="qx-textarea" value={additional} maxLength={1000} onChange={e => setAdditional(e.target.value)} placeholder="你自己的节奏、目标，或一个正在琢磨的问题……" /></details>
        <p className="ep-setup__hint">这些会存进记忆面板，随时可以查看、修改或删除。</p>
      </div>}

      {step === 3 && <div className="ep-setup__progress">
        <div className="ep-progress-heading"><span>{processing ? '正在整理带来的资料' : total ? '资料已经安放好了' : '从一张空白的纸开始，也很好'}</span><b>{finished}<i> / {total}</i></b></div>
        <div className="ep-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={Math.max(total, 1)} aria-valuenow={total ? finished : 1}><span style={{ width: `${total ? (finished / total) * 100 : 100}%`, background: color }} /></div>
        <div className="ep-import-results">{items.map(batch => <div key={batch.id}><div className="ep-import-results__batch"><FileTextIcon size={18} /><strong>{batch.source_type === 'chrome' ? '浏览器收藏' : '笔记文件'}</strong><span>{batch.finished} / {batch.total}</span></div>{batch.items.filter(i => i.status === 'failed').map(i => <div className="ep-import-error" key={i.id}><span>{i.title}<small>{i.error}</small></span><button className="qx-btn qx-btn--ghost" onClick={() => { void retryImport(batch.id, i.id).then(() => batches.refetch()).catch(e => setError(String(e))) }}>重试</button></div>)}</div>)}</div>
      </div>}

      {error && <p className="qx-notice qx-notice--danger ep-setup__error" role="alert">{error}</p>}

      <footer className="ep-setup__actions">
        <button className="qx-btn qx-btn--primary qx-btn--lg ep-setup__next" disabled={busy} onClick={() => { void change(step + 1) }}>{busy ? '正在保存…' : step === 3 ? '看看我的知识图谱' : '继续'}<ArrowRightIcon size={16} /></button>
        {step > 0 && <button className="qx-btn qx-btn--ghost" disabled={busy} onClick={() => { void change(step - 1, true) }}><ArrowLeftIcon size={16} />上一步</button>}
      </footer>
      <Link to="/settings" className="ep-setup__settings qx-meta">账户设置 <ArrowUpRightIcon size={12} /></Link>
    </section>
  </main>
}
