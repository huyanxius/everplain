import type { AgentAvatarId } from '../modules/agent-avatar'

/*
 * Mock 数据。字段名尽量贴近将来的真实接口，但这里不是契约——真实 DTO 以
 * `src/api/generated/` 为准。主题颜色取自角色调色板，是数据色，不是界面强调色。
 */

export type MaterialKind = '网页' | 'PDF' | '笔记' | '视频' | '书签'
export type MaterialSource = 'Chrome 书签' | 'Obsidian' | 'B 站收藏' | 'Apple 备忘录' | '上传'

export interface Topic {
  readonly id: string
  readonly name: string
  readonly color: string
}

export interface Material {
  readonly id: string
  readonly title: string
  readonly kind: MaterialKind
  readonly source: MaterialSource
  readonly topicId: string
  readonly summary: string
  readonly addedAt: string
  readonly points: readonly string[]
  readonly related: readonly string[]
  readonly host?: string
}

export const topics: readonly Topic[] = [
  { id: 'city', name: '城市与公共空间', color: '#5d8fe6' },
  { id: 'media', name: '注意力与媒介', color: '#ec8a52' },
  { id: 'rural', name: '乡土社会', color: '#3fae9c' },
  { id: 'writing', name: '写作方法', color: '#9a80e0' },
]

export const topicById = Object.fromEntries(topics.map((t) => [t.id, t])) as Record<string, Topic>

export const materials: readonly Material[] = [
  {
    id: 'm1', title: '为什么城市需要第三空间', kind: '网页', source: 'Chrome 书签', topicId: 'city', host: 'aeon.co',
    summary: '奥尔登堡把家和单位之外的咖啡馆、书店、理发店称为第三空间，它们让陌生人以很低的成本保持联系。',
    addedAt: '3 天前', points: ['第三空间的八个特征', '常客是第三空间的核心', '中立地带降低社交成本'], related: ['m3', 'm5'],
  },
  {
    id: 'm2', title: '乡土中国', kind: 'PDF', source: '上传', topicId: 'rural',
    summary: '差序格局、礼治秩序、无讼。整理出 18 个知识点，其中 6 个和你的城市研究有关。',
    addedAt: '上周', points: ['差序格局', '礼治秩序', '长老统治', '无讼', '血缘与地缘'], related: ['m1', 'm7'],
  },
  {
    id: 'm3', title: '访谈提纲草稿', kind: '笔记', source: 'Apple 备忘录', topicId: 'city',
    summary: '先问日常动线，再问"你上一次和陌生人聊天是在哪里"。最后留十分钟给对方补充。',
    addedAt: '昨天', points: ['从动线切入', '追问具体场景'], related: ['m1'],
  },
  {
    id: 'm4', title: '注意力是怎样被设计出来的', kind: '视频', source: 'B 站收藏', topicId: 'media', host: 'bilibili.com',
    summary: '从无限滚动到红点提醒，讲产品如何把"可变奖励"嵌进界面。附转写稿 42 分钟。',
    addedAt: '5 天前', points: ['可变奖励', '无限滚动', '通知的节奏'], related: ['m6'],
  },
  {
    id: 'm5', title: '雅各布斯：街道眼', kind: '笔记', source: 'Obsidian', topicId: 'city',
    summary: '人行道上持续有人看着，是街道安全的来源。混合功能让一天里不同时段都有人。',
    addedAt: '2 周前', points: ['街道眼', '混合功能', '短街区'], related: ['m1', 'm3'],
  },
  {
    id: 'm6', title: '《娱乐至死》读书笔记', kind: '笔记', source: 'Obsidian', topicId: 'media',
    summary: '媒介即隐喻。电视让一切公共话语都变成娱乐的形式，问题不在内容而在形式。',
    addedAt: '3 周前', points: ['媒介即隐喻', '信息-行动比'], related: ['m4'],
  },
  {
    id: 'm7', title: '县城的消费与面子', kind: '网页', source: 'Chrome 书签', topicId: 'rural', host: 'thepaper.cn',
    summary: '县城婚礼与购房里的熟人社会逻辑，面子消费如何沿着人情网络扩散。',
    addedAt: '1 个月前', points: ['熟人社会', '面子消费'], related: ['m2'],
  },
  {
    id: 'm8', title: '写作：先找到你的问题', kind: '书签', source: 'Chrome 书签', topicId: 'writing', host: 'paulgraham.com',
    summary: '好的文章从一个你真的想知道答案的问题开始，而不是从一个主题开始。',
    addedAt: '1 个月前', points: ['问题先于主题', '写作即思考'], related: ['m9'],
  },
  {
    id: 'm9', title: '论文开题的五个坑', kind: '笔记', source: 'Apple 备忘录', topicId: 'writing',
    summary: '题目太大、问题不可回答、文献只罗列不对话、方法和问题对不上、没有预期发现。',
    addedAt: '6 天前', points: ['问题可回答', '文献对话'], related: ['m8'],
  },
]

export const materialById = Object.fromEntries(materials.map((m) => [m.id, m])) as Record<string, Material>

export interface Conversation {
  readonly id: string
  readonly title: string
  readonly when: string
}

export const conversations: readonly Conversation[] = [
  { id: 'c1', title: '第三空间的支持与反驳', when: '今天' },
  { id: 'c2', title: '把访谈提纲改得更具体', when: '今天' },
  { id: 'c3', title: '短视频和注意力的文献', when: '昨天' },
  { id: 'c4', title: '开题报告的问题怎么收窄', when: '周一' },
  { id: 'c5', title: '县城面子消费的案例', when: '上周' },
]

export interface Research {
  readonly id: string
  readonly title: string
  readonly question: string
  readonly stage: '提问' | '找资料' | '写大纲' | '写作'
  readonly materials: number
  readonly updated: string
}

export const researches: readonly Research[] = [
  { id: 'r1', title: '城市第三空间', question: '年轻人在大城市里还需要第三空间吗？', stage: '写作', materials: 12, updated: '2 小时前' },
  { id: 'r2', title: '短视频与注意力', question: '短视频改变的是注意力的长度，还是注意力的方向？', stage: '找资料', materials: 5, updated: '昨天' },
  { id: 'r3', title: '县城的人情社会', question: '县城的人情网络在年轻一代里怎样变化？', stage: '提问', materials: 2, updated: '上周' },
]

export const memories: readonly { readonly id: string; readonly text: string; readonly source: string }[] = [
  { id: 'mem1', text: '在读社会学本科，大三，正在准备毕业论文开题。', source: '引导问卷' },
  { id: 'mem2', text: '希望 Agent 帮忙找资料之间的联系，而不是直接写答案。', source: '引导问卷' },
  { id: 'mem3', text: '引用格式用 GB/T 7714。', source: '对话 · 9 月 28 日' },
  { id: 'mem4', text: '不喜欢太长的回答，先给结论。', source: '对话 · 9 月 20 日' },
]

export interface AgentProfile {
  name: string
  avatar: AgentAvatarId
  color: string
}

export const defaultAgent: AgentProfile = { name: '澄', avatar: 'cheng', color: '#5d8fe6' }

/* 换色只给这一组：都是角色调色板里的值，和中性界面放在一起不打架。 */
export const agentColors = ['#5d8fe6', '#ec8a52', '#3fae9c', '#e55f6f', '#de6aa5', '#9a80e0', '#eeb146', '#3d3d3a']
