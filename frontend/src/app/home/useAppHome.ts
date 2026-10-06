import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { useAccount } from '../../modules/account'
import { readAgentProfile } from '../../modules/agent-profile'
import { listRecentConversationContext } from '../../modules/research-agent'
import { readPersonalGraph } from '../../modules/personal-graph'
import { seedAgentDraft } from '../agent/ResearchAgentConversationPage'
import { useAgentModelSelection } from '../model-selection'
import { useAppLocale } from '../i18n/AppLocaleProvider'
import { useConversationGreeting } from '../conversation-view/researchPrompts'
import { composeContextCardMessage, type SelectedContextCard } from '../conversation-view/contextCard'
import { createHomeSubmission, type ComposerOrigin } from '../conversation-view/homeSubmission'

export function useAppHome() {
  const account = useAccount()
  const navigate = useNavigate()
  const userId = account.sessionState.status === 'authenticated' ? account.sessionState.session.user.userId : null
  const modelSelection = useAgentModelSelection(userId)
  const { locale } = useAppLocale()
  const history = useQuery({ queryKey: ['recent-conversation-context', userId], queryFn: ({ signal }) => listRecentConversationContext(signal), enabled: Boolean(userId), staleTime: 0, refetchOnMount: 'always' })
  const greeting = useConversationGreeting(locale, Boolean(history.data?.length), userId, history.isSuccess)
  const sending = useRef(false)
  const profile = useQuery({ queryKey: ['agent-profile', userId], queryFn: readAgentProfile, enabled: Boolean(userId) })
  const graph = useQuery({ queryKey: ['personal-graph', userId], queryFn: readPersonalGraph, enabled: Boolean(userId) })
  const [question, setQuestion] = useState('')
  const [cardSelection, setCardSelection] = useState<{ owner: string; card: SelectedContextCard } | null>(null)
  const selectedCard = cardSelection?.owner === userId ? cardSelection.card : null
  const selectCard = (card: SelectedContextCard) => { if (userId) setCardSelection({ owner: userId, card }) }
  const removeCard = () => setCardSelection(null)
  useLayoutEffect(() => { setQuestion(''); removeCard(); sending.current = false }, [userId])
  useEffect(() => { window.addEventListener('pagehide', removeCard); return () => window.removeEventListener('pagehide', removeCard) }, [])
  const documents = (graph.data?.nodes ?? []).flatMap(node => {
    const source = graph.data?.sources[node.id]
    return node.nodeType === 'document' && source ? [{ node, source }] : []
  })
  const visibleDocuments = documents.slice(0, 3)
  function ask(origin?: ComposerOrigin) {
    const value = composeContextCardMessage(selectedCard, question)
    if (!userId || !value || sending.current || modelSelection.status !== 'ready' || !modelSelection.selection) return
    sending.current = true
    seedAgentDraft(userId, value)
    const homeSubmitId = createHomeSubmission(userId, value, modelSelection.selection, origin, selectedCard ?? undefined)
    navigate('/agent', { state: { homeSubmitId } })
  }
  return { userId, history, recentConversations: history.data ?? [], profile, graph, question, setQuestion, selectedCard, selectCard, removeCard, documents, visibleDocuments, ask, greeting, modelSelection }
}
