import { AgentComposer, ResearchComposer } from '../shared/Composer'

/*
 * 两个输入框的视觉参照：Agent 页面的简单版、研究界面的详细版。组件本身在 shared/Composer。
 * 研究框只在有内容时才出现的东西（这里没画，位置照下面）：
 *   「正在讨论：X」、材料来源导入状态 → 框内顶部，和附件同一行区；
 *   问题示例 → 空状态时在托盘下面，一次四条，可换一组。
 */
export function ChatMock() {
  return (
    <main className="ch-page">
      <AgentComposer />
      <ResearchComposer />
    </main>
  )
}
