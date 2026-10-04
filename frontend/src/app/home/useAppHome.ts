import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { listMyResearchViaApi, useAccount } from '../../modules/account'
import { readAgentProfile } from '../../modules/agent-profile'
import { listAgentConversations } from '../../modules/research-agent'
import { readPersonalGraph } from '../../modules/personal-graph'
import { seedAgentDraft } from '../agent/ResearchAgentConversationPage'
import { useAgentModelSelection } from '../model-selection'
import { useAppLocale } from '../i18n/AppLocaleProvider'
import { useConversationGreeting } from '../conversation-view/researchPrompts'
import { createHomeSubmission, type ComposerOrigin } from '../conversation-view/homeSubmission'

export function useAppHome() {
  const account = useAccount()
  const navigate = useNavigate()
  const userId = account.sessionState.status === 'authenticated' ? account.sessionState.session.user.userId : null
  const modelSelection = useAgentModelSelection(userId)
  const { locale } = useAppLocale()
  const history = useQuery({ queryKey: ['greeting-history', userId], queryFn: ({ signal }) => listAgentConversations(signal), enabled: Boolean(userId), staleTime: 60000 })
  const greeting = useConversationGreeting(locale, history.data?.some(item => item.turn_count > 0) ?? false, userId, history.isSuccess)
  const sending = useRef(false)
  const profile = useQuery({ queryKey: ['agent-profile', userId], queryFn: readAgentProfile, enabled: Boolean(userId) })
  const graph = useQuery({ queryKey: ['personal-graph', userId], queryFn: readPersonalGraph, enabled: Boolean(userId) })
  const research = useQuery({ queryKey: ['account', 'research-tasks', userId], queryFn: listMyResearchViaApi, enabled: Boolean(userId), retry: false })
  const [question, setQuestion] = useState('')
  const documents = (graph.data?.nodes ?? []).flatMap(node => {
    const source = graph.data?.sources[node.id]
    return node.nodeType === 'document' && source ? [{ node, source }] : []
  })
  const visibleDocuments = documents.slice(0, 3)
  const projects = [...research.data ?? []].sort((first, second) => (Date.parse(second.updatedAt) || 0) - (Date.parse(first.updatedAt) || 0)).slice(0, 3)
  function ask(origin?: ComposerOrigin) {
    const value = question.trim()
    if (!userId || !value || sending.current || modelSelection.status !== 'ready' || !modelSelection.selection) return
    sending.current = true
    seedAgentDraft(userId, value)
    const homeSubmitId = createHomeSubmission(userId, value, modelSelection.selection, origin)
    navigate('/agent', { state: { homeSubmitId } })
  }
  function choosePrompt(value: string) {
    if (userId) seedAgentDraft(userId, value)
    navigate('/agent')
  }
  return { profile, graph, research, question, setQuestion, documents, visibleDocuments, projects, ask, choosePrompt, greeting, modelSelection }
}
