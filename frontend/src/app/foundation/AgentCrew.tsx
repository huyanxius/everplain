import { useEffect, useState } from 'react'
import { AgentAvatar, agentAvatarPresets, agentAvatarStates, type AgentAvatarId, type AgentAvatarState } from '../../modules/agent-avatar'
import { prefersReducedMotion, useReveal } from './useReveal'

/*
 * 七个角色排成一行，高低错开。每个角色按 待机→思考→工作→打招呼 轮换，
 * 起点互相错开，所以任何时刻台上都同时有几种动作，看得出它们共用一套动作。
 * 减少动态效果时全部停在待机。
 */
const CYCLE_MS = 2800

export function AgentCrew() {
  const [ref, shown] = useReveal<HTMLDivElement>(0.3)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!shown || prefersReducedMotion()) return
    const timer = window.setInterval(() => setTick(value => value + 1), CYCLE_MS)
    return () => window.clearInterval(timer)
  }, [shown])
  return <div className="ep-cast" ref={ref}>
    <ul className="ep-crew-row">
      {agentAvatarPresets.map((preset, index) => {
        const state = agentAvatarStates[(tick + index * 3) % agentAvatarStates.length]
        return <li key={preset.id} className="ep-crew-member" style={{ animationDelay: `${index * 70}ms` }} data-shown={shown}>
          <AgentAvatar avatar={preset.id} state={shown ? state : 'idle'} size="100%" offset={index * 1.3} playing={shown} />
        </li>
      })}
    </ul>
  </div>
}

/** 每一幕标题旁边的那一个角色，滚到视口里才开始动 */
export function ActAgent({ avatar, state, side }: { avatar: AgentAvatarId; state: AgentAvatarState; side: 'start' | 'end' | 'center' }) {
  const [ref, shown] = useReveal<HTMLDivElement>(0.5)
  return <div className="ep-act-agent" data-side={side} ref={ref} data-shown={shown}>
    <AgentAvatar avatar={avatar} state={state} size="100%" playing={shown} />
  </div>
}
