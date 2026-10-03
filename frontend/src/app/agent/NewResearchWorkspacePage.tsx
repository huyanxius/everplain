import { ArrowLeftIcon, ArrowRightIcon, ChatCircleDotsIcon, CheckCircleIcon, CircleNotchIcon, CompassIcon, FileTextIcon, FolderOpenIcon, GraphIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { useRef, type CSSProperties } from 'react'
import { Link } from 'react-router'

import type { ResearchStartJourney, ResearchStartProposal } from '../../modules/research-agent'
import { RESEARCH_MATERIAL_ACCEPT } from '../../modules/research-materials'
import { ResearchMapCanvas } from '../research-workspace/ResearchMapCanvas'
import { PageContent, PageShell } from '../ui/PageShell'
import { ResearchAgentConversationPage } from './ResearchAgentConversationPage'
import { useNewResearchWorkspace } from './useNewResearchWorkspace'
import './new-research-workspace.css'

function ResearchStartProposalCard({ proposal, busy, error, onConfirm, onContinue }: {
  proposal: ResearchStartProposal
  busy: boolean
  error: string | null
  onConfirm: () => void
  onContinue: () => void
}) {
  return <section className="qx-card research-start-card" aria-label="研究建立确认" aria-busy={busy}>
    <div className="research-start-card__label"><CompassIcon aria-hidden="true" /><span>研究起点</span></div>
    <h2 className="qx-card__title">{proposal.phenomenon}</h2>
    <dl className="research-start-card__details">
      <div><dt>意图</dt><dd>{proposal.researchIntent || '待补充'}</dd></div>
      <div><dt>情境</dt><dd>{proposal.context || '待补充'}</dd></div>
    </dl>
    {error ? <p className="research-start-card__error" role="alert"><WarningCircleIcon aria-hidden="true" />{error}</p> : null}
    <footer className="research-start-card__actions">
      <button type="button" className="qx-btn qx-btn--primary" disabled={busy} onClick={onConfirm}>
        {busy ? <><CircleNotchIcon className="research-start-spin" aria-hidden="true" />正在建立研究…</> : <>{error ? '重试建立研究' : '确认研究起点'}<ArrowRightIcon aria-hidden="true" /></>}
      </button>
      <button className="qx-btn qx-btn--ghost" type="button" disabled={busy} onClick={onContinue}>{error ? '返回继续修改' : '继续修改'}</button>
    </footer>
  </section>
}

function ResearchStartReadyCard({ journey, error, busy, onEnter, onRetry }: {
  journey: ResearchStartJourney
  error: string | null
  busy: boolean
  onEnter: () => void
  onRetry: () => void
}) {
  return <section className="qx-card research-start-card" aria-label="研究已建立">
    <div className="research-start-card__label"><CheckCircleIcon aria-hidden="true" /><span>研究已建立</span></div>
    <h2 className="qx-card__title">{journey.proposal?.phenomenon || '当前研究问题'}</h2>
    {error ? <p className="research-start-card__error" role="alert">{error}</p> : null}
    <footer className="research-start-card__actions">
      <button type="button" className="qx-btn qx-btn--primary" onClick={onEnter}>展开文档节点 <ArrowRightIcon aria-hidden="true" /></button>
      {error ? <button type="button" className="qx-btn qx-btn--ghost" disabled={busy} onClick={onRetry}>{busy ? '正在恢复…' : '恢复研究状态'}</button> : null}
    </footer>
  </section>
}

function ResearchStartRecoveryError({ message, busy, onRetry, onContinue }: {
  message: string
  busy: boolean
  onRetry: () => void
  onContinue: () => void
}) {
  return <section className="qx-card research-start-card" role="alert" aria-label="研究状态恢复失败">
    <div className="research-start-card__label"><WarningCircleIcon aria-hidden="true" /><span>研究状态</span></div>
    <h2 className="qx-card__title">研究状态暂时无法恢复</h2>
    <p className="qx-card__body">{message}</p>
    <footer className="research-start-card__actions">
      <button type="button" className="qx-btn qx-btn--primary" disabled={busy} onClick={onRetry}>{busy ? <><CircleNotchIcon className="research-start-spin" aria-hidden="true" />正在恢复…</> : '重试'}</button>
      <button className="qx-btn qx-btn--ghost" type="button" disabled={busy} onClick={onContinue}>继续对话</button>
    </footer>
  </section>
}

export function NewResearchWorkspacePage({ userId }: { userId: string | null }) {
  const state = useNewResearchWorkspace()
  const agentPanel = useRef<HTMLElement>(null)
  const retryJourney = () => { if (state.conversation?.conversation_id) void state.loadJourney(state.conversation.conversation_id) }
  const continueConversation = () => {
    state.setJourneyError(null)
    state.setMobilePane('agent')
    agentPanel.current?.querySelector('textarea')?.focus()
  }
  const journeyTail = state.journey?.proposal?.status === 'pending_confirmation' ? (
    <ResearchStartProposalCard proposal={state.journey.proposal} busy={state.journeyConfirming} error={state.journeyError} onConfirm={() => void state.confirmResearchStart()} onContinue={continueConversation} />
  ) : state.journey?.taskId ? (
    <ResearchStartReadyCard journey={state.journey} error={state.journeyError} busy={state.journeyLoading} onEnter={state.enterDocumentResearch} onRetry={retryJourney} />
  ) : state.journeyError ? (
    <ResearchStartRecoveryError message={state.journeyError} busy={state.journeyLoading} onRetry={retryJourney} onContinue={continueConversation} />
  ) : state.journeyLoading ? <p className="research-start-loading" role="status"><CircleNotchIcon className="research-start-spin" aria-hidden="true" />正在恢复研究建立状态…</p> : null

  return <PageShell workspace wide railContentRef={state.setHistoryRailTarget}>
    <PageContent>
      <section className="research-launch" aria-label="新建研究工作区">
        <header className="research-launch__bar">
          <Link className="qx-btn qx-btn--ghost qx-btn--icon" to="/research/materials" aria-label="返回研究"><ArrowLeftIcon /></Link>
          <h1 className="qx-heading">{state.conversation?.title || '新建研究'}</h1>
          <nav className="qx-segmented research-launch__views" aria-label="研究工作区视图">
            <button type="button" aria-pressed={state.mobilePane === 'agent'} onClick={() => state.setMobilePane('agent')}><ChatCircleDotsIcon aria-hidden="true" />Agent</button>
            <button type="button" aria-pressed={state.mobilePane === 'map'} onClick={() => state.setMobilePane('map')}><GraphIcon aria-hidden="true" />研究地图</button>
          </nav>
        </header>
        <div ref={state.workspaceRef} className="research-launch__body" data-mobile-pane={state.mobilePane} data-resizing={state.resizingAgentPanel} style={{ '--qx-research-agent-width': `${state.agentPanelWidth}px` } as CSSProperties}>
          <div className="research-launch__canvas">
            <ResearchMapCanvas
              projection={state.projection}
              conversation={state.conversation}
              onConversationChange={state.syncConversation}
              idleActions={!state.activeTaskId ? <div className="research-launch__entry" role="group" aria-label="研究起点">
                <p>直接提问，或先放入一批材料</p>
                <div className="research-launch__entry-options">
                  <button className="qx-btn qx-btn--secondary" type="button" disabled={state.materialUploading} onClick={() => state.materialInputRef.current?.click()}>
                    {state.materialUploading ? <CircleNotchIcon className="research-start-spin" /> : <FileTextIcon />}{state.materialUploading ? '正在导入…' : '从材料开始研究'}
                  </button>
                  <Link className="qx-btn qx-btn--ghost" to="/research/existing"><FolderOpenIcon />接入已有研究</Link>
                </div>
                <input ref={state.materialInputRef} className="research-launch__file-input" type="file" multiple accept={RESEARCH_MATERIAL_ACCEPT} aria-label="从材料开始研究" disabled={state.materialUploading} onChange={(event) => {
                  const files = Array.from(event.target.files ?? [])
                  event.target.value = ''
                  void state.startFromMaterials(files)
                }} />
                {state.materialEntryError && !state.materialSourceNames.length ? <p className="research-start-card__error" role="alert">{state.materialEntryError}</p> : null}
              </div> : undefined}
              selectedNodeId={state.selectedNodeId}
              onSelectNode={(node) => state.setSelectedNodeId(node.id)}
              onClearSelection={() => state.setSelectedNodeId(null)}
              onContinueNode={state.continueNode}
              onOpenCitation={(id) => { state.setCitationRequest({ id, key: Date.now() }); state.setMobilePane('agent') }}
            />
          </div>
          <div className="research-launch__resize" role="separator" tabIndex={0} aria-label="调整对话栏宽度" aria-orientation="vertical" aria-controls="research-launch-agent-panel" aria-valuemin={state.minAgentPanelWidth} aria-valuemax={state.agentPanelMaxWidth} aria-valuenow={state.agentPanelWidth} aria-valuetext={`${state.agentPanelWidth} 像素`} onKeyDown={state.handleResizeKey} onMouseDown={state.startMouseResize} onPointerDown={state.startPointerResize} onPointerMove={state.movePointerResize} onPointerUp={state.finishPointerResize} onPointerCancel={state.finishPointerResize} />
          <aside ref={agentPanel} id="research-launch-agent-panel" className="research-launch__agent" aria-label="研究对话">
            <ResearchAgentConversationPage
              embedded showConversationManagement
              historyRailTarget={state.historyRailTarget}
              userId={userId}
              conversationId={state.requestedConversationId}
              knowledgeReleaseId={state.requestedKnowledgeReleaseId}
              workspace={state.activeTaskId ? 'research' : 'agent'}
              taskId={state.activeTaskId ?? null}
              composerAriaLabel="和 Agent 讨论你的研究"
              composerPrefix={state.materialSourceNames.length ? <div className="research-launch__import">
                <div className="research-launch__import-summary" role="status" aria-label="材料来源"><FileTextIcon aria-hidden="true" /><span>材料来源</span><strong title={state.materialSourceNames.join('、')}>{state.materialSourceNames[0]}</strong>{state.materialSourceNames.length > 1 ? <small>另 {state.materialSourceNames.length - 1} 份</small> : null}<span>{state.materialEntryError ? '导入失败' : state.materialUploading ? '导入中' : '已添加'}</span></div>
                {state.materialEntryError ? <div className="research-launch__import-error"><p role="alert">{state.materialEntryError}</p><button className="qx-btn qx-btn--ghost" type="button" disabled={state.materialUploading} onClick={() => void state.retryMaterials()}>重试导入</button></div> : null}
              </div> : null}
              suggestedPrompt={state.suggestedPrompt}
              suggestedPromptKey={state.suggestedPromptKey}
              onConversationStarted={state.syncConversationIdentity}
              onConversationChange={state.syncConversation}
              onStreamingTurnChange={state.setStreamingTurn}
              conversationTail={journeyTail}
              discussion={state.discussion}
              onClearDiscussion={() => state.setDiscussion(null)}
              citationRequest={state.citationRequest}
              enableResearchGuidance={Boolean(state.journey?.taskId)}
            />
          </aside>
        </div>
      </section>
    </PageContent>
  </PageShell>
}
