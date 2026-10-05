import { AgentAnswerMarkdown } from '../agent/AgentAnswerMarkdown'
import { useReducedMotion } from '../../ui/useReducedMotion'
import { liveWritingMarkdown, type WritingLiveDraft } from './writingLivePreviewState'

/** Network snapshots appear immediately. Only the existing Agent reveal CSS animates new bytes. */
export function WritingLivePreview({ draft }: { draft: WritingLiveDraft }) {
  const reduced = useReducedMotion(), revealedAt: number[] = []
  if (!reduced) draft.revealedAt.forEach((time, index) => { revealedAt[draft.selection_start + index] = time })
  return <div className="se-prose writing-live-preview" data-streaming={draft.state === 'streaming' && !draft.incomplete || undefined} aria-label="正在生成的正文草稿">
    <AgentAnswerMarkdown citations={[]} onSelectCitation={() => {}} inertResources reveal={{ now: performance.now(), revealedAt }}>{liveWritingMarkdown(draft)}</AgentAnswerMarkdown>
  </div>
}
