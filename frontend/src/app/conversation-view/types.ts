import type { ReactNode, Ref } from 'react'
import type { AgentAvatarId, AgentAvatarState } from '../../modules/agent-avatar'
import type { AgentCitation, AgentToolStep } from '../../modules/research-agent'

export type ConversationAgent = { name: string; avatar: AgentAvatarId; color?: string }
export type ConversationAction = {
  id: string
  label: string
  icon?: ReactNode
  disabled?: boolean
  busy?: boolean
  primary?: boolean
} & ({ onClick: () => void; href?: never; external?: never } | { href: string; external?: boolean; onClick?: never })

/** Display-only additions to the existing tool DTO; no requests are made here. */
export type ConversationToolStep = AgentToolStep & {
  interrupted?: boolean
  purpose?: string
  resultItems?: readonly { id: string; title: string; excerpt?: string | null }[]
}
export type ConversationHandoff = {
  label?: string
  id: string
  title: string
  eyebrow?: string
  description?: string
  fields?: readonly { label: string; value: string }[]
  actions?: readonly ConversationAction[]
}
export type ConversationTurnView = {
  id: string
  question: string
  answer: string
  previousOutputs?: readonly { id: string; ordinal: number; answer: string; unsaved?: boolean }[]
  citations: readonly AgentCitation[]
  knowledgeReleaseId?: string | null
  toolSteps?: readonly ConversationToolStep[]
  liveText?: boolean
  streaming?: boolean
  statusText?: string
  progressEnd?: number
  interrupted?: boolean
  failure?: string
  notice?: string
  provenance?: string
  handoffs?: readonly ConversationHandoff[]
  /** Receives sanitized answer text. No clipboard or network call without this callback. */
  onCopy?: (content: string) => void | Promise<void>
  onRegenerate?: () => void
  onResume?: () => void
  onSaveNote?: () => void
  onContinueResearch?: () => void
  actionsDisabled?: boolean
  researchBusy?: boolean
}
export type ConversationThreadProps = {
  turns: readonly ConversationTurnView[]
  agent?: ConversationAgent
  renderAvatar?: (state: AgentAvatarState, turnId: string) => ReactNode
  onSelectCitation: (citation: AgentCitation, knowledgeReleaseId: string | null, turnId: string) => void
  onOpenActivity?: (turnId: string, step?: ConversationToolStep) => void
  children?: ReactNode
  endRef?: Ref<HTMLDivElement>
}
export type ConversationSourceDetail = {
  citation: AgentCitation
  kindLabel?: string
  topicLabel?: string
  locatorLabel?: string
  unavailableReason?: string
  /** Host resolves ownership, release and return-location links. Deleted sources suppress these. */
  actions?: readonly ConversationAction[]
}
export type ConversationSourcePanelProps = {
  closing?: boolean
  detail?: ConversationSourceDetail | null
  activity?: ConversationToolStep | null
  citations?: readonly AgentCitation[]
  toolSteps?: readonly ConversationToolStep[]
  onClose: () => void
  onBack?: () => void
  onSelectCitation?: (citation: AgentCitation) => void
  onSelectActivity?: (step: ConversationToolStep) => void
}
export type ConversationResearchFlowProps = {
  label?: string
  confirmLabel?: string
  stage: 'clarifying' | 'planning' | 'researching' | 'completed'
  question: string
  options?: readonly string[]
  toolSteps?: readonly ConversationToolStep[]
  elapsedSeconds?: number
  progressPercent?: number
  phaseSteps?: readonly string[]
  currentPhase?: number
  conclusion?: string
  knowledgeCount?: number
  webCount?: number
  busy?: boolean
  error?: string
  exportState?: 'idle' | 'docx' | 'pdf'
  onChooseIntent?: (intent: string) => void
  onSkip?: () => void
  onConfirmPlan?: () => void
  onEdit?: () => void
  onExport?: (kind: 'docx' | 'pdf') => void
  onContinueResearch?: () => void
}
