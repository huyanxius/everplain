import { createContext, useContext, useEffect, useState } from 'react'

import { defaultAgent, type AgentProfile } from './data'

export function useHashPath() {
  const read = () => window.location.hash.replace(/^#/, '') || '/'
  const [path, setPath] = useState(read)
  useEffect(() => {
    const onChange = () => {
      setPath(read())
      document.querySelector('.mk-main')?.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return path
}

export function go(path: string) {
  window.location.hash = path
}

interface AgentState {
  readonly agent: AgentProfile
  readonly setAgent: (next: AgentProfile) => void
}

export const AgentContext = createContext<AgentState>({ agent: defaultAgent, setAgent: () => undefined })
export const useAgent = () => useContext(AgentContext)

export function loadAgent(): AgentProfile {
  try {
    const raw = localStorage.getItem('mk-agent')
    const saved = raw ? { ...defaultAgent, ...JSON.parse(raw) } : defaultAgent
    return saved.name?.trim() ? saved : { ...saved, name: defaultAgent.name }
  } catch {
    return defaultAgent
  }
}

