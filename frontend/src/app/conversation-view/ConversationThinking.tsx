import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppLocale } from '../../i18n/AppLocaleProvider'
import { useReducedMotion } from '../../ui/useReducedMotion'
import { KineticCopyCycle } from '../agent/KineticCopyCycle'
import type { ConversationTurnView } from './types'

export function ConversationThinking({ turn }: { turn: ConversationTurnView }) {
  const { text } = useAppLocale()
  const reduced = useReducedMotion()
  const active = Boolean(turn.streaming && !turn.answer)
  const [visible, setVisible] = useState(active)
  const message = turn.statusText || turn.toolSteps?.find(step => step.status === 'running')?.label || text('正在思考', 'Thinking')
  const lastMessage = useRef(message)
  if (active) lastMessage.current = message
  const displayMessage = active ? message : lastMessage.current
  const messages = useMemo(() => [[displayMessage]], [displayMessage])
  useEffect(() => {
    if (active) { setVisible(true); return }
    if (reduced) { setVisible(false); return }
    const timer = window.setTimeout(() => setVisible(false), 420)
    return () => window.clearTimeout(timer)
  }, [active, reduced])
  if (!visible && !active) return null
  return <div className="cv-thinking" data-collapsed={!active || undefined} role="status" aria-live="polite" aria-label={displayMessage}>
    <div><KineticCopyCycle messages={messages} motionMode="characters" active={active} className="cv-thinking__copy" /></div>
  </div>
}
