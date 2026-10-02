import { useEffect, useState } from 'react'
import { ArrowLeftIcon, BookmarkSimpleIcon, CheckIcon, FolderIcon, NoteIcon, TelevisionSimpleIcon } from '@phosphor-icons/react'

import { AgentAvatar, agentAvatarPresets } from '../../modules/agent-avatar'
import { agentColors, topics } from '../data'
import { go, useAgent } from '../state'

/*
 * 引导四步：导入 → 取名与外观 → 问卷 → 生成图谱。每一步都能跳过。
 * Agent 从第一步就站在页面上，跟着步骤换动作：导入时张望，取名时打招呼，问卷时思考，生成时工作。
 */
export function SetupPage({ step }: { step: number }) {
  const { agent } = useAgent()
  const states = ['idle', 'greet', 'think', 'work'] as const
  return (
    <main className="mk-setup">
      <header className="mk-setup__top">
        {step > 1 ? (
          <a className="qx-btn qx-btn--ghost qx-btn--icon" aria-label="上一步" href={`#/setup/${step - 1}`}>
            <ArrowLeftIcon />
          </a>
        ) : (
          <span />
        )}
        <ol className="mk-steps" aria-label={`第 ${step} 步，共 4 步`}>
          {[1, 2, 3, 4].map((n) => (
            <li key={n} data-done={n < step} data-current={n === step} />
          ))}
        </ol>
        {step < 4 ? (
          <a className="qx-btn qx-btn--ghost" href={`#/setup/${step + 1}`}>
            跳过
          </a>
        ) : (
          <span />
        )}
      </header>

      <div className="mk-setup__agent">
        <AgentAvatar avatar={agent.avatar} color={agent.color} size={step === 4 ? 128 : 96} state={states[step - 1]} />
      </div>

      {step === 1 ? <ImportStep /> : null}
      {step === 2 ? <NameStep /> : null}
      {step === 3 ? <SurveyStep /> : null}
      {step === 4 ? <GenerateStep /> : null}
    </main>
  )
}

function ImportStep() {
  const sources = [
    { id: 'chrome', icon: <BookmarkSimpleIcon />, name: 'Chrome 书签', hint: '上传导出的书签文件' },
    { id: 'obsidian', icon: <FolderIcon />, name: 'Obsidian', hint: '选择整个 Vault 文件夹' },
    { id: 'bili', icon: <TelevisionSimpleIcon />, name: 'B 站收藏夹', hint: '填你的 UID' },
    { id: 'notes', icon: <NoteIcon />, name: 'Apple 备忘录', hint: '导出 Markdown 后上传' },
  ]
  const [picked, setPicked] = useState<string[]>(['chrome'])
  return (
    <section className="mk-setup__body">
      <h1 className="qx-display">先把你收藏过的东西带进来</h1>
      <p className="mk-setup__lead">选几个你常用的地方。导入在后台进行，不用等。</p>
      <div className="mk-source-grid">
        {sources.map((s) => {
          const on = picked.includes(s.id)
          return (
            <button key={s.id} className="mk-source" aria-pressed={on} onClick={() => setPicked(on ? picked.filter((x) => x !== s.id) : [...picked, s.id])}>
              <span className="mk-source__icon">{s.icon}</span>
              <span className="mk-source__text">
                <strong>{s.name}</strong>
                <small>{s.hint}</small>
              </span>
              <span className="mk-source__check">{on ? <CheckIcon weight="bold" /> : null}</span>
            </button>
          )
        })}
      </div>
      <a className="qx-btn qx-btn--primary qx-btn--lg mk-setup__next" href="#/setup/2">
        {picked.length ? `导入 ${picked.length} 个来源` : '继续'}
      </a>
    </section>
  )
}

function NameStep() {
  const { agent, setAgent } = useAgent()
  return (
    <section className="mk-setup__body">
      <h1 className="qx-display">给它起个名字</h1>
      <input className="qx-input mk-name-input" value={agent.name} maxLength={8} onChange={(e) => setAgent({ ...agent, name: e.target.value })} aria-label="Agent 的名字" />
      <div className="mk-avatar-pick" role="radiogroup" aria-label="外观">
        {agentAvatarPresets.map((p, i) => (
          <button key={p.id} role="radio" aria-checked={agent.avatar === p.id} aria-label={p.name} onClick={() => setAgent({ ...agent, avatar: p.id, color: p.color })}>
            <AgentAvatar avatar={p.id} color={agent.avatar === p.id ? agent.color : p.color} size={56} offset={i * 0.6} />
          </button>
        ))}
      </div>
      <div className="mk-color-pick" role="radiogroup" aria-label="颜色">
        {agentColors.map((c) => (
          <button key={c} role="radio" aria-checked={agent.color === c} aria-label={c} style={{ background: c }} onClick={() => setAgent({ ...agent, color: c })} />
        ))}
      </div>
      <a className="qx-btn qx-btn--primary qx-btn--lg mk-setup__next" href="#/setup/3">
        就叫{agent.name || '它'}
      </a>
    </section>
  )
}

function SurveyStep() {
  const questions = [
    { q: '你现在主要在做什么？', options: ['在读本科', '在读研究生', '产品 / 运营', '老师', '写作 / 媒体', '其他'] },
    { q: '最想让它帮你做什么？', options: ['找回以前看过的东西', '把资料串起来', '一起想问题', '帮我写初稿', '整理读书笔记'], multi: true },
    { q: '你喜欢它怎么说话？', options: ['先给结论', '多问我问题', '详细展开', '轻松一点'], multi: true },
  ]
  const [answers, setAnswers] = useState<Record<number, string[]>>({ 0: ['在读本科'], 1: ['把资料串起来'] })
  const toggle = (qi: number, o: string, multi?: boolean) =>
    setAnswers((a) => {
      const cur = a[qi] ?? []
      return { ...a, [qi]: multi ? (cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o]) : [o] }
    })
  return (
    <section className="mk-setup__body mk-setup__body--wide">
      <h1 className="qx-display">说说你自己</h1>
      {questions.map((item, qi) => (
        <fieldset key={item.q} className="mk-survey">
          <legend className="qx-heading">{item.q}</legend>
          <div className="mk-survey__options">
            {item.options.map((o) => (
              <button key={o} className="mk-option" aria-pressed={(answers[qi] ?? []).includes(o)} onClick={() => toggle(qi, o, item.multi)}>
                {o}
              </button>
            ))}
          </div>
        </fieldset>
      ))}
      <fieldset className="mk-survey">
        <legend className="qx-heading">最近在关心什么？</legend>
        <textarea className="qx-textarea" placeholder="比如：毕业论文想写城市里的第三空间" />
      </fieldset>
      <a className="qx-btn qx-btn--primary qx-btn--lg mk-setup__next" href="#/setup/4">
        好了
      </a>
    </section>
  )
}

function GenerateStep() {
  const { agent } = useAgent()
  const [done, setDone] = useState(0)
  const total = 248
  useEffect(() => {
    const t = window.setInterval(() => setDone((d) => Math.min(total, d + 9)), 90)
    return () => window.clearInterval(t)
  }, [])
  const finished = done >= total
  return (
    <section className="mk-setup__body">
      <h1 className="qx-display">{finished ? '整理好了' : `${agent.name}正在读你的收藏`}</h1>
      <div className="mk-progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
        <span style={{ width: `${(done / total) * 100}%`, background: agent.color }} />
      </div>
      <p className="mk-setup__lead">
        {done} / {total} 条 · 已经找到 {Math.min(topics.length, Math.ceil(done / 60))} 个主题
      </p>
      <div className="mk-found">
        {topics.slice(0, Math.ceil(done / 60)).map((t) => (
          <span key={t.id} className="qx-tag qx-tag--outline mk-pop">
            <i className="mk-dot" style={{ background: t.color }} />
            {t.name}
          </span>
        ))}
      </div>
      <button className="qx-btn qx-btn--primary qx-btn--lg mk-setup__next" disabled={!finished} onClick={() => go('/graph')}>
        看看我的图谱
      </button>
      {!finished ? (
        <a className="qx-btn qx-btn--ghost" href="#/">
          先去首页，好了告诉我
        </a>
      ) : null}
    </section>
  )
}
