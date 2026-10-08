import type { AppLocale } from '../i18n/AppLocaleProvider'

// Generic starters have no server card identity, source evidence or hidden prompt.
export type StarterSuggestion = { id: string; title: string; description: string } & (
  | { kind: 'draft' }
  | { kind: 'navigate'; to: '/library?add=file' | '/library?add=extension' | '/library?add=obsidian' | '/library?add=chrome' | '/library' | '/research/new' | '/writing' }
)

export function starterSuggestionPool(locale: AppLocale): StarterSuggestion[] {
  const text = (zh: string, en: string) => locale === 'en-US' ? en : zh
  return [
    { id: 'untangle', kind: 'draft', title: text('帮我理清一个想法', 'Help me untangle an idea'), description: text('先说说你的想法，一起找出关键线索。', 'Share your idea and find the key threads together.') },
    { id: 'compare', kind: 'draft', title: text('帮我比较几个方案', 'Help me compare some options'), description: text('列出备选方向，梳理各自的取舍。', 'Lay out your options and explore the trade-offs.') },
    { id: 'learn', kind: 'draft', title: text('我想弄懂一个新概念', 'Help me understand a new concept'), description: text('从你的疑问出发，逐步拆解概念。', 'Start with your questions and unpack the concept.') },
    { id: 'steps', kind: 'draft', title: text('把一个大任务拆成小步骤', 'Break a big task into small steps'), description: text('说说目标，整理可以着手的下一步。', 'Share your goal and work out manageable next steps.') },
    { id: 'plan', kind: 'draft', title: text('和我一起安排这周的计划', 'Help me plan my week'), description: text('列出待办和时间限制，一起安排优先级。', 'List your tasks and time constraints to set priorities.') },
    { id: 'notes', kind: 'draft', title: text('帮我提炼一段笔记的重点', 'Help me find the key points in a note'), description: text('贴上笔记，整理重点与值得继续追问的地方。', 'Paste a note to explore key points and follow-up questions.') },
    { id: 'ideas', kind: 'draft', title: text('一起想几个新的点子', 'Brainstorm some fresh ideas with me'), description: text('给出一个方向，一起探索更多可能。', 'Pick a direction and explore new possibilities.') },
    { id: 'explain', kind: 'draft', title: text('帮我把一件事说清楚', 'Help me explain something clearly'), description: text('说说要表达什么、讲给谁听，一起理顺思路。', 'Share what you want to say and who it is for.') },
    { id: 'decision', kind: 'draft', title: text('陪我想清楚一个选择', 'Help me think through a decision'), description: text('摆出顾虑和期待，逐项想清楚。', 'Explore what matters to you and what gives you pause.') },
    { id: 'reading', kind: 'draft', title: text('一起整理我的读书思路', 'Help me organize my thoughts on a book'), description: text('从一段摘录或感想开始，串起阅读收获。', 'Start with an excerpt or reflection and connect your thoughts.') },
    { id: 'import', kind: 'navigate', to: '/library?add=file', title: text('导入一份资料', 'Import a document'), description: text('上传文件，将资料加入你的私人知识库。', 'Upload a file to your private knowledge library.') },
    { id: 'webpage', kind: 'navigate', to: '/library?add=extension', title: text('设置网页收藏扩展', 'Set up the web clipper'), description: text('查看安装步骤，把读到的网页收藏进知识库。', 'View setup steps for saving webpages to your library.') },
    { id: 'obsidian', kind: 'navigate', to: '/library?add=obsidian', title: text('导入我的 Obsidian 笔记', 'Import my Obsidian notes'), description: text('打开导入入口，把已有笔记带入知识库。', 'Open the import flow to bring your notes into your library.') },
    { id: 'bookmarks', kind: 'navigate', to: '/library?add=chrome', title: text('整理我的浏览器收藏', 'Organize my browser bookmarks'), description: text('导入浏览器书签，集中整理值得保留的网页。', 'Import browser bookmarks to organize saved webpages.') },
    { id: 'library', kind: 'navigate', to: '/library', title: text('整理我的知识库', 'Organize my knowledge library'), description: text('打开知识库，查看并整理已有资料。', 'Open your library to review and organize your sources.') },
    { id: 'browse', kind: 'navigate', to: '/library', title: text('看看知识库里的资料', 'Explore my knowledge library'), description: text('浏览已保存的资料，找到接下来想读的内容。', 'Browse saved sources and find what to read next.') },
    { id: 'research', kind: 'navigate', to: '/research/new', title: text('深入研究一个问题', 'Research a question in depth'), description: text('打开研究入口，明确问题与研究方向。', 'Open a new research project and define your question.') },
    { id: 'investigate', kind: 'navigate', to: '/research/new', title: text('从资料开始一次研究', 'Start a research project with sources'), description: text('新建研究，把已有资料作为探索的起点。', 'Start a new research project from your sources.') },
    { id: 'writing', kind: 'navigate', to: '/writing', title: text('开始写一篇文章', 'Start writing an article'), description: text('打开文稿空间，从题目或提纲开始。', 'Open your writing space and start with a topic or outline.') },
    { id: 'outline', kind: 'navigate', to: '/writing', title: text('把想法整理成文稿', 'Turn an idea into a draft'), description: text('进入文稿空间，逐步组织想法与段落。', 'Open your writing space to organize ideas and paragraphs.') },
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
