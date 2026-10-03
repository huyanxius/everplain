import { useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeftIcon, BookmarkSimpleIcon, CheckIcon, FolderIcon, NoteIcon, TelevisionSimpleIcon } from '@phosphor-icons/react'
import { Link, Navigate, useLocation } from 'react-router'
import { AgentAvatar, agentAvatarPresets } from '../../modules/agent-avatar'
import { readAgentProfile } from '../../modules/agent-profile'
import type { ImportSourceType } from '../../modules/knowledge-import'
import { ErrorState, LoadingState } from '../ui/States'
import { agentColors, goalOptions, occupations, speakingStyles, useWelcomeSetup } from './useWelcomeSetup'
import './welcome-setup.css'

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

type SetupFlow = ReturnType<typeof useWelcomeSetup>
const stageNames = ['导入资料', '名字与外观', '说说自己', '整理图谱']
const avatarStates = ['idle', 'greet', 'think', 'work'] as const

export function WelcomeSetupPage({ userId }: { userId: string | null }) {
  const flow = useWelcomeSetup(userId)
  if (flow.profile.isPending) return <LoadingState message="正在铺开你的知识空间" />
  if (flow.profile.isError) return <ErrorState detail={flow.profile.error.message} onRetry={() => { void flow.profile.refetch() }} />
  return (
    <main className="setup-flow">
      <header className="setup-flow__top">
        {flow.step > 0 ? <button className="qx-btn qx-btn--ghost qx-btn--icon" type="button" aria-label="上一步" disabled={Boolean(flow.busy)} onClick={() => void flow.change(flow.step - 1, true)}><ArrowLeftIcon /></button> : <Link className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="返回官网" to="/welcome"><ArrowLeftIcon /></Link>}
        <ol className="setup-flow__steps" aria-label={`第 ${flow.step + 1} 步，共 4 步`}>
          {stageNames.map((name, index) => <li key={name} data-done={index < flow.step} data-current={index === flow.step}>
            <button type="button" aria-label={name} aria-current={index === flow.step ? 'step' : undefined} disabled={Boolean(flow.busy) || index >= flow.step} onClick={() => void flow.change(index, true)} />
          </li>)}
        </ol>
        {flow.step < 3 ? <button className="qx-btn qx-btn--ghost" type="button" disabled={Boolean(flow.busy)} onClick={() => void flow.change(flow.step + 1, true)}>暂时跳过</button> : <span />}
      </header>
      <div className="setup-flow__agent">
        <AgentAvatar avatar={flow.draft.avatar} color={flow.draft.color} size={flow.step === 3 ? 128 : 96} state={flow.step === 3 && !flow.processing ? 'greet' : avatarStates[flow.step]} />
      </div>
      {flow.step === 0 && <ImportStep flow={flow} />}
      {flow.step === 1 && <IdentityStep flow={flow} />}
      {flow.step === 2 && <SurveyStep flow={flow} />}
      {flow.step === 3 && <GenerateStep flow={flow} />}
    </main>
  )
}

function StepBody({ flow, title, children, wide = false, action = '继续' }: { flow: SetupFlow; title: string; children: ReactNode; wide?: boolean; action?: string }) {
  return <section className={`setup-flow__body${wide ? ' setup-flow__body--wide' : ''}`} aria-labelledby="setup-title">
    <h1 id="setup-title" className="qx-display">{title}</h1>
    {children}
    {flow.error && <p className="qx-notice qx-notice--danger setup-flow__notice" role="alert">{flow.error}</p>}
    <button className="qx-btn qx-btn--primary qx-btn--lg setup-flow__next" type="button" disabled={Boolean(flow.busy)} onClick={() => void flow.change(flow.step + 1)}>{flow.busy === 'save' ? '正在保存…' : flow.busy === 'import' ? '正在导入…' : action}</button>
    {flow.step === 3 && flow.processing && <button className="qx-btn qx-btn--ghost" type="button" disabled={Boolean(flow.busy)} onClick={() => void flow.change(4, true)}>先进入，后台继续</button>}
    <Link className="setup-flow__settings qx-meta" to="/settings">账户设置</Link>
  </section>
}

function ImportStep({ flow }: { flow: SetupFlow }) {
  const [showFavorites, setShowFavorites] = useState(false)
  const [uid, setUid] = useState('')
  return <StepBody flow={flow} title="先把你收藏过的东西带进来">
    <p className="setup-flow__lead">选几个你常用的地方。导入在后台进行，不用等。</p>
    <div className="setup-sources">
      <FileSource flow={flow} source="chrome" title="Chrome 书签" hint="上传导出的书签文件" label="导入 Chrome 书签" accept=".html,.htm" icon={<BookmarkSimpleIcon />} />
      <FileSource flow={flow} source="obsidian" title="Obsidian" hint="选择整个 Vault 文件夹" label="导入 Markdown 文件夹" directory icon={<FolderIcon />} />
      <button className="setup-source" type="button" aria-expanded={showFavorites} aria-controls="setup-bilibili" disabled={Boolean(flow.busy)} onClick={() => setShowFavorites(value => !value)}>
        <span className="setup-source__icon"><TelevisionSimpleIcon /></span><span className="setup-source__text"><strong>B 站收藏夹</strong><small>填你的 UID</small></span><span className="setup-source__check" data-selected={flow.items.some(batch => batch.source_type === 'bilibili')}>{flow.items.some(batch => batch.source_type === 'bilibili') && <CheckIcon weight="bold" />}</span>
      </button>
      <FileSource flow={flow} source="apple_notes" title="Apple 备忘录" hint="导出 Markdown 后上传" label="导入 Apple 备忘录" accept=".md,.markdown,.txt,.html,.htm" icon={<NoteIcon />} />
    </div>
    {showFavorites && <form id="setup-bilibili" className="setup-flow__source-form" onSubmit={event => { event.preventDefault(); void flow.importFavorites(uid) }}>
      <input className="qx-input" aria-label="B 站 UID" placeholder="B 站 UID" inputMode="numeric" value={uid} onChange={event => setUid(event.target.value)} />
      <button className="qx-btn qx-btn--secondary" disabled={Boolean(flow.busy)} type="submit">导入收藏夹</button>
      <small className="qx-meta">只导入公开可访问的收藏内容。</small>
    </form>}
    <BatchAvailability flow={flow} />
    {flow.total > 0 && <p className="setup-flow__lead" role="status">已接收 {flow.total} 条资料 · 已处理 {flow.finished} 条</p>}
    <p className="qx-meta">默认只有你能看到。以后也能继续导入。</p>
  </StepBody>
}

function FileSource({ flow, source, title, hint, label, icon, accept, directory = false }: {
  flow: SetupFlow; source: ImportSourceType; title: string; hint: string; label: string; icon: ReactNode; accept?: string; directory?: boolean
}) {
  const selected = flow.items.some(batch => batch.source_type === source)
  return <label className="setup-source" data-disabled={Boolean(flow.busy)}>
    <span className="setup-source__icon">{icon}</span>
    <span className="setup-source__text"><strong>{title}</strong><small>{hint}</small></span>
    <span className="setup-source__check" data-selected={selected}>{selected && <CheckIcon weight="bold" />}</span>
    <input type="file" aria-label={label} accept={accept} multiple={source !== 'chrome'} {...(directory ? { webkitdirectory: '' } : {})} disabled={Boolean(flow.busy)} onChange={event => { void flow.upload(source, event.target.files); event.target.value = '' }} />
  </label>
}

function IdentityStep({ flow }: { flow: SetupFlow }) {
  const { draft, patch } = flow
  return <StepBody flow={flow} title="给它起个名字" action={`就叫${draft.name.trim() || '它'}`}>
    <input className="qx-input setup-flow__name" aria-label="你想叫它什么？" placeholder="例如：小叶" value={draft.name} maxLength={40} onChange={event => patch({ name: event.target.value })} />
    <div className="setup-avatars" role="group" aria-label="外观">
      {agentAvatarPresets.map((preset, index) => <button key={preset.id} type="button" aria-pressed={draft.avatar === preset.id} aria-label={preset.name} onClick={() => patch({ avatar: preset.id, color: preset.color })}>
        <AgentAvatar avatar={preset.id} color={draft.avatar === preset.id ? draft.color : preset.color} size={56} offset={index * 0.6} />
      </button>)}
    </div>
    <div className="setup-colors" role="group" aria-label="颜色">
      {agentColors.map(color => <button key={color} type="button" aria-pressed={draft.color === color} aria-label={`颜色 ${color}`} style={{ background: color }} onClick={() => patch({ color })} />)}
    </div>
    <fieldset className="setup-survey">
      <legend className="qx-heading">你喜欢它怎么说话？</legend>
      <div className="setup-survey__options">
        {speakingStyles.map(style => <button className="setup-option" type="button" key={style.id} aria-pressed={draft.style === style.id} title={style.detail} onClick={() => patch({ style: style.id })}>{style.title}</button>)}
      </div>
    </fieldset>
  </StepBody>
}

function SurveyStep({ flow }: { flow: SetupFlow }) {
  const { draft, patch } = flow
  return <StepBody flow={flow} title="说说你自己" action="好了" wide>
    <fieldset className="setup-survey">
      <legend className="qx-heading">你现在主要在做什么？</legend>
      <div className="setup-survey__options">{occupations.map(occupation => <button className="setup-option" type="button" key={occupation} aria-pressed={draft.occupation === occupation} onClick={() => patch({ occupation: draft.occupation === occupation ? '' : occupation })}>{occupation}</button>)}</div>
    </fieldset>
    <label className="setup-survey"><span className="qx-heading">所在领域 <small className="qx-meta">选填</small></span><input className="qx-input" value={draft.industry} maxLength={160} onChange={event => patch({ industry: event.target.value })} placeholder="例如：教育、设计、互联网" /></label>
    <fieldset className="setup-survey">
      <legend className="qx-heading">最想让它帮你做什么？ <small className="qx-meta">可以多选</small></legend>
      <div className="setup-survey__options">{goalOptions.map(goal => <button className="setup-option" type="button" key={goal} aria-pressed={draft.goals.includes(goal)} onClick={() => patch({ goals: draft.goals.includes(goal) ? draft.goals.filter(item => item !== goal) : [...draft.goals, goal] })}>{goal}</button>)}</div>
    </fieldset>
    <label className="setup-survey"><span className="qx-heading">最近在关心什么？</span><input className="qx-input" value={draft.interests} onChange={event => patch({ interests: event.target.value })} placeholder="例如：城市、认知科学、电影，用顿号分隔" /></label>
    <label className="setup-survey"><span className="qx-heading">还有什么想告诉它的？ <small className="qx-meta">选填</small></span><textarea className="qx-textarea" value={draft.additional} maxLength={1000} onChange={event => patch({ additional: event.target.value })} placeholder="你自己的节奏、目标，或一个正在琢磨的问题……" /></label>
    <p className="qx-meta">每一项都可跳过。以后可以在记忆面板里修改或删除。</p>
  </StepBody>
}

function BatchAvailability({ flow }: { flow: SetupFlow }) {
  if (flow.batches.isPending) return <p className="qx-meta" role="status">正在读取导入进度…</p>
  if (!flow.batches.isError) return null
  return <div className="qx-notice qx-notice--danger setup-flow__notice" role="alert">
    <p>暂时无法读取导入进度：{flow.batches.error.message}</p>
    <button className="qx-btn qx-btn--ghost" type="button" disabled={flow.batches.isFetching} onClick={() => void flow.batches.refetch()}>重新读取</button>
  </div>
}

function GenerateStep({ flow }: { flow: SetupFlow }) {
  const readable = !flow.batches.isPending && !flow.batches.isError
  const title = !readable ? '看看你的知识图谱' : flow.processing ? `${flow.draft.name || 'Everplain'}正在读你的收藏` : flow.failed ? '还有几条资料需要重试' : flow.total ? '整理好了' : '从一张空白的纸开始'
  return <StepBody flow={flow} title={title} action="看看我的知识图谱">
    <BatchAvailability flow={flow} />
    {readable && <>
      <div className="setup-progress" role="progressbar" aria-label="资料导入进度" aria-valuemin={0} aria-valuemax={Math.max(flow.total, 1)} aria-valuenow={Math.min(flow.finished, flow.total)}>
        <span style={{ width: `${flow.total ? Math.min(100, flow.finished / flow.total * 100) : 0}%`, background: flow.draft.color }} />
      </div>
      <p className="setup-flow__lead" role="status">{flow.total ? `${flow.finished} / ${flow.total} 条已处理${flow.failed ? ` · ${flow.failed} 条需要重试` : ''}` : '还没有导入资料，随时都可以添加。'}</p>
      <div className="setup-results">
        {flow.items.map(batch => <section key={batch.id} className="setup-results__batch" aria-label={batch.source_type}>
          <div className="setup-results__summary"><span>{({ chrome: 'Chrome 书签', obsidian: 'Obsidian', bilibili: 'B 站收藏夹', apple_notes: 'Apple 备忘录' } as Record<string, string>)[batch.source_type] ?? '笔记文件'}</span><span>{batch.finished} / {batch.total}</span></div>
          {batch.items.filter(item => item.status === 'failed').map(item => <div className="setup-results__failure" key={item.id}>
            <span>{item.title}<small>{item.error}</small></span><button className="qx-btn qx-btn--secondary" type="button" disabled={Boolean(flow.busy)} onClick={() => void flow.retry(batch.id, item.id)}>重试</button>
          </div>)}
        </section>)}
      </div>
    </>}
  </StepBody>
}
