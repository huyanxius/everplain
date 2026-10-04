import { createContext, useContext, type ComponentType } from 'react'
import { AgentLiquid } from '../modules/agent-avatar'
import { useReducedMotion } from './useReducedMotion'

type PageLoadingProps = { message: string }

// Standalone previews use the same seven-preset liquid without assuming an account.
function DefaultPageLoading({ message }: PageLoadingProps) {
  const reduced = useReducedMotion()
  return <div className="agent-loading" data-compact="false" data-reduced-motion={reduced} role="status" aria-live="polite" aria-busy="true"><AgentLiquid /><p>{message}</p></div>
}

// The application supplies its authenticated loader without module-to-app imports.
export const PageLoadingRenderer = createContext<ComponentType<PageLoadingProps>>(DefaultPageLoading)

export function PageLoading(props: PageLoadingProps) {
  const Renderer = useContext(PageLoadingRenderer)
  return <Renderer {...props} />
}
