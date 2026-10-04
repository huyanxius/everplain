import { useEffect, useState } from 'react'
import { prefersReducedMotion } from './useReveal'

/*
 * 首屏输入框的占位文字：轮流逐字打出几句示例问法，让人一眼看出这里该说什么。
 * 问法都是记忆残片（大概什么时候、大概讲什么），不写成标题或关键词——
 * 产品要证明的正是「只记得一点也能找回」，写成精确搜索词就演反了。
 * 用户一开始输入，占位文字自然消失，演示不会和真实输入抢位置。
 */
const recalls = [
  { ask: '上个月看的那篇讲睡眠的' },
  { ask: '那个讲注意力机制的视频' },
  { ask: '截过图的那份书单' },
  { ask: '备忘录里关于写作的那句话' },
]

const TYPE_MS = 80
const HOLD_MS = 2600

export function useRecall() {
  const [index, setIndex] = useState(0)
  const [typed, setTyped] = useState(() => prefersReducedMotion() ? recalls[0].ask.length : 0)
  const ask = recalls[index].ask
  const found = typed >= ask.length

  useEffect(() => {
    if (prefersReducedMotion()) return
    const timer = found
      ? window.setTimeout(() => { setIndex(i => (i + 1) % recalls.length); setTyped(0) }, HOLD_MS)
      : window.setTimeout(() => setTyped(n => n + 1), TYPE_MS)
    return () => window.clearTimeout(timer)
  }, [found, typed])

  return { placeholder: typed === 0 ? '说说你的想法…' : ask.slice(0, typed) }
}
