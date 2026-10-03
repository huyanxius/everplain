import type { ErrorInfo, PropsWithChildren, ReactNode } from 'react'
import { Component } from 'react'

type State = {
  error: Error | null
}

export function FatalErrorState({
  onReload,
}: {
  onReload?: () => void
}) {
  return (
    <main className="application-recovery" role="alert">
      <h1 className="qx-section-title">页面暂时打不开</h1>
      <p>请刷新页面；若问题持续存在，保留当前地址用于排查。</p>
      <div className="application-recovery__actions">
        <button className="qx-btn qx-btn--primary" type="button" onClick={onReload ?? (() => window.location.reload())}>
          重新加载
        </button>
        <a className="qx-btn qx-btn--ghost" href="/welcome">回到首页</a>
      </div>
    </main>
  )
}

export class ErrorBoundary extends Component<PropsWithChildren, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Uncaught application error', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) {
      return <FatalErrorState />
    }
    return this.props.children
  }
}
