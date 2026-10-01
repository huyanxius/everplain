import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AgentAvatar, agentAvatarPresets, agentAvatarStates } from '.'

describe('AgentAvatar', () => {
  it('每个角色在每种状态下都画出同一套双眼', () => {
    for (const preset of agentAvatarPresets) {
      for (const state of agentAvatarStates) {
        const { container, unmount } = render(<AgentAvatar avatar={preset.id} state={state} />)
        const svg = container.querySelector('svg')!
        expect(svg.dataset.state).toBe(state)
        expect(svg.querySelectorAll('.aa-pupil')).toHaveLength(2)
        expect(svg.querySelectorAll('.aa-happy')).toHaveLength(2)
        unmount()
      }
    }
  })

  it('不传名字时对读屏隐藏，传了就作为图片朗读', () => {
    const { container, rerender } = render(<AgentAvatar avatar="cheng" />)
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    rerender(<AgentAvatar avatar="cheng" label="澄" />)
    expect(container.querySelector('svg')).toHaveAccessibleName('澄')
  })

  it('可以覆盖角色的默认颜色', () => {
    const { container } = render(<AgentAvatar avatar="cheng" color="#123456" />)
    expect(container.querySelector('svg')!.style.getPropertyValue('--aa-color')).toBe('#123456')
  })
})
