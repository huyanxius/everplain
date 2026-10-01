import { Link, useSearchParams } from 'react-router'
import { BooksIcon, PlusIcon } from '@phosphor-icons/react'
import { MyResearchPage, RecentResearchPanel } from '../../modules/account'
import { PageContent, PageShell } from '../ui/PageShell'
import { RouterLinkAdapter } from '../ui/RouterLinkAdapter'
import { useAppLocale } from '../i18n/AppLocaleProvider'
import { ResearchPrompt } from '../foundation/ResearchPrompt'

export function AppHomePage() {
  const { text } = useAppLocale()
  const [searchParams] = useSearchParams()
  const showingAllResearch = searchParams.get('research') === 'all'
  return <PageShell wide><PageContent>
    <div className="everplain-home">
      <div className="everplain-start"><h1>Everplain</h1><p>{text('个人知识库与研究助手', 'Your personal library and research assistant')}</p><ResearchPrompt /></div>
      <nav className="everplain-home__links" aria-label={text('快捷入口', 'Quick access')}><Link to="/library"><BooksIcon size={16} />{text('我的知识库', 'My library')}</Link><Link to="/research/new"><PlusIcon size={16} />{text('新建研究', 'New research')}</Link></nav>
      <section className="everplain-home__recent">
        <header><h2 id="work-home-recent-title">{showingAllResearch ? text('全部研究', 'All research') : text('最近研究', 'Recent research')}</h2>
          <nav aria-label={text('研究视图', 'Research view')}>
            {showingAllResearch ? <Link to="/app">{text('最近', 'Recent')}</Link> : <span aria-current="page">{text('最近', 'Recent')}</span>}
            {showingAllResearch ? <span aria-current="page">{text('查看全部', 'View all')}</span> : <Link to="/app?research=all">{text('查看全部', 'View all')}</Link>}
          </nav>
        </header>
        <div role="region" aria-label={showingAllResearch ? text('全部研究', 'All research') : text('最近研究', 'Recent research')}>
          {showingAllResearch ? <MyResearchPage /> : <RecentResearchPanel LinkComponent={RouterLinkAdapter} />}
        </div>
      </section>
    </div>
  </PageContent></PageShell>
}
