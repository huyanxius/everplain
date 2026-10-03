import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { listMyResearchViaApi, useAccount } from '../../modules/account'
import { readAgentProfile } from '../../modules/agent-profile'
import { readPersonalGraph } from '../../modules/personal-graph'
import { seedAgentDraft } from '../agent/ResearchAgentConversationPage'
import { useAgentModelSelection } from '../model-selection'

export function homeGreeting(hour: number) {
  return hour < 6 ? '还没睡呀' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'
}

export function useAppHome() {
  const account = useAccount()
  const navigate = useNavigate()
  const userId = account.sessionState.status === 'authenticated' ? account.sessionState.session.user.userId : null
  const modelSelection = useAgentModelSelection(userId)
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
  function ask(text = question) {
    const value = text.trim()
    if (userId && value) seedAgentDraft(userId, value)
    navigate('/agent')
  }
  return { profile, graph, research, question, setQuestion, documents, visibleDocuments, projects, ask, modelSelection }
}
