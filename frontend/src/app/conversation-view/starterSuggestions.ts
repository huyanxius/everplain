import type { AppLocale } from '../i18n/AppLocaleProvider'

// Generic starters have no server card identity, source evidence or hidden prompt.
export type StarterSuggestion = { id: string; title: string } & (
  | { kind: 'draft' }
  | { kind: 'navigate'; to: '/library?add=file' | '/library?add=extension' | '/library?add=obsidian' | '/library?add=chrome' | '/library' | '/research/new' | '/writing' }
)

export function starterSuggestionPool(locale: AppLocale): StarterSuggestion[] {
  const text = (zh: string, en: string) => locale === 'en-US' ? en : zh
  return [
    { id: 'untangle', kind: 'draft', title: text('帮我理清一个想法', 'Help me untangle an idea') },
    { id: 'compare', kind: 'draft', title: text('帮我比较几个方案', 'Help me compare some options') },
    { id: 'learn', kind: 'draft', title: text('我想弄懂一个新概念', 'Help me understand a new concept') },
    { id: 'steps', kind: 'draft', title: text('把一个大任务拆成小步骤', 'Break a big task into small steps') },
    { id: 'plan', kind: 'draft', title: text('和我一起安排这周的计划', 'Help me plan my week') },
    { id: 'notes', kind: 'draft', title: text('帮我提炼一段笔记的重点', 'Help me find the key points in a note') },
    { id: 'ideas', kind: 'draft', title: text('一起想几个新的点子', 'Brainstorm some fresh ideas with me') },
    { id: 'explain', kind: 'draft', title: text('帮我把一件事说清楚', 'Help me explain something clearly') },
    { id: 'decision', kind: 'draft', title: text('陪我想清楚一个选择', 'Help me think through a decision') },
    { id: 'reading', kind: 'draft', title: text('一起整理我的读书思路', 'Help me organize my thoughts on a book') },
    { id: 'import', kind: 'navigate', to: '/library?add=file', title: text('导入一份资料', 'Import a document') },
    { id: 'webpage', kind: 'navigate', to: '/library?add=extension', title: text('设置网页收藏扩展', 'Set up the web clipper') },
    { id: 'obsidian', kind: 'navigate', to: '/library?add=obsidian', title: text('导入我的 Obsidian 笔记', 'Import my Obsidian notes') },
    { id: 'bookmarks', kind: 'navigate', to: '/library?add=chrome', title: text('整理我的浏览器收藏', 'Organize my browser bookmarks') },
    { id: 'library', kind: 'navigate', to: '/library', title: text('整理我的知识库', 'Organize my knowledge library') },
    { id: 'browse', kind: 'navigate', to: '/library', title: text('看看知识库里的资料', 'Explore my knowledge library') },
    { id: 'research', kind: 'navigate', to: '/research/new', title: text('深入研究一个问题', 'Research a question in depth') },
    { id: 'investigate', kind: 'navigate', to: '/research/new', title: text('从资料开始一次研究', 'Start a research project with sources') },
    { id: 'writing', kind: 'navigate', to: '/writing', title: text('开始写一篇文章', 'Start writing an article') },
    { id: 'outline', kind: 'navigate', to: '/writing', title: text('把想法整理成文稿', 'Turn an idea into a draft') },
  ]
}

export function getStarterSuggestions(locale: AppLocale, userId: string, {
  count = 3, excludedTitles = [],
}: { count?: number; excludedTitles?: readonly string[] } = {}): StarterSuggestion[] {
  const pool = starterSuggestionPool(locale)
  // Stable across Home/Chat and re-renders. Each set offers a conversation,
  // a knowledge action and a research/writing action without an extra request.
  const seed = [...userId].reduce((value, character) => (value * 31 + character.charCodeAt(0)) >>> 0, 0)
  const preferred = [pool[seed % 10], pool[10 + seed % 6], pool[16 + seed % 4]]
  const normalize = (title: string) => title.trim().replace(/\s+/g, ' ').toLowerCase()
  const titles = new Set(excludedTitles.map(normalize))
  const ids = new Set<string>()
  // If a real card already uses a generic title, continue through the same
  // twenty-card pool in deterministic order rather than repeating its copy.
  return [...preferred, ...pool.slice(seed % pool.length), ...pool.slice(0, seed % pool.length)]
    .filter(card => {
      const title = normalize(card.title)
      if (ids.has(card.id) || titles.has(title)) return false
      ids.add(card.id)
      titles.add(title)
      return true
    }).slice(0, Math.max(0, Math.min(3, count)))
}
