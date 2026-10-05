import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRightIcon, BookOpenIcon, ChatCircleIcon, FileTextIcon, StackIcon } from '@phosphor-icons/react'
import { Link, useLocation } from 'react-router'
import libraryScreenshot from '../../assets/docs/library.png'
import writingScreenshot from '../../assets/docs/writing.png'
import { AgentAvatar, agentAvatarPresets } from '../../modules/agent-avatar'
import {
  REFERENCE_PRICING, estimateReferenceUsage, readPublicProductCatalog, supportedPublicModels,
  type PublicProductCatalog,
} from '../../modules/product-docs'
import { ModelSelectionControl } from '../model-selection/ModelSelectionControl'
import { type ModelSelection } from '../model-selection/modelSelection'
import './docs.css'

const contents = [
  ['start', '从这里开始'], ['collect', '收集与知识库'], ['research', '对话与文稿'],
  ['models', '模型与思考强度'], ['pricing', '官方价格参考'], ['free', 'Free 能用多少'],
  ['plans', '订阅与积分'], ['appearance', '你的 Everplain'], ['questions', '常见问题'],
] as const
const numbers = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 })
const money = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 2 })

function ModelControlPreview({ catalog }: { catalog: PublicProductCatalog }) {
  const choices = useMemo(() => supportedPublicModels(catalog.agent_models).map(model => ({
    id: model.model_id, label: model.label, reasoningEfforts: model.reasoning_efforts,
    defaultReasoningEffort: model.default_reasoning_effort,
  })), [catalog.agent_models])
  const [selection, setSelection] = useState<ModelSelection>(() => ({
    modelId: choices[0]?.id ?? '', reasoningEffort: choices[0]?.defaultReasoningEffort ?? null,
  }))
  if (!choices.length) return <p className="ep-docs-notice">{catalog.agent_models.length ? '此版本的预览控件暂不支持当前模型选项，请到工作台查看。' : '服务端目前没有提供可选对话模型。请稍后再查看。'}</p>
  return <figure className="ep-docs-demo">
    <figcaption>试试工作台里的模型控件</figcaption>
    <ModelSelectionControl catalog={choices} value={selection} onChange={setSelection} autoFocus={false} />
    {choices.length < catalog.agent_models.length && <p>部分新型号暂不能在此版本控件中预览，请在工作台查看。</p>}
    <p>使用工作台的真实控件试选模型与思考强度。本页预览不消耗积分或保存设置。</p>
  </figure>
}

function AvatarPreview() {
  const [avatar, setAvatar] = useState(agentAvatarPresets[0].id)
  return <figure className="ep-docs-avatar-preview">
    <AgentAvatar avatar={avatar} size={120} state="greet" />
    <div className="ep-docs-avatar-options" role="group" aria-label="预览角色头像">
      {agentAvatarPresets.map(preset => <button key={preset.id} type="button" aria-label={`预览${preset.name}头像`} aria-pressed={avatar === preset.id} onClick={() => setAvatar(preset.id)}>
        <AgentAvatar avatar={preset.id} size={42} state="idle" />
      </button>)}
    </div>
    <figcaption>点选预览角色，账户外观请在设置中保存。</figcaption>
  </figure>
}

export function SubscriptionPlanCards({ catalog }: { catalog: PublicProductCatalog }) {
  return <div className="ep-docs-plans">
    <article><h3>Free</h3><p className="ep-docs-plan-price">免费</p><p>每 {catalog.reset_days} 天 {numbers.format(catalog.free_weekly_points)} 积分</p><small>适合先带一份资料试试</small></article>
    {catalog.plans.map(plan => <article key={plan.id}>
      <h3>{plan.name}</h3><p className="ep-docs-plan-price">{money.format(plan.price_cny_fen / 100)}<span> / {plan.period_days} 天</span></p>
      <p>每 {catalog.reset_days} 天 {numbers.format(plan.weekly_points)} 积分</p>
      <small>{plan.period_days / catalog.reset_days} 个周期，共 {numbers.format(plan.period_points)} 积分{plan.description ? `。${plan.description}` : ''}</small>
    </article>)}
  </div>
}

function FreeEstimate({ points, resetDays }: { points: number; resetDays: number }) {
  return <>
    <p>按每 {resetDays} 天 {numbers.format(points)} 积分估算。先看上面的官方价格，再把每次请求固定为 {numbers.format(REFERENCE_PRICING.example.inputTokens)} 个输入 tokens + {numbers.format(REFERENCE_PRICING.example.outputTokens)} 个总输出 tokens。</p>
    <div className="ep-docs-table-scroll" tabIndex={0} role="region" aria-label="Free 示例用量表，可横向滚动">
      <table><caption>相同假设下的示例请求次数，向下取整</caption><thead><tr><th scope="col">模型</th><th scope="col">约可请求</th><th scope="col">累计输入 tokens</th><th scope="col">累计总输出 tokens</th></tr></thead>
        <tbody>{REFERENCE_PRICING.models.map(model => {
          const estimate = estimateReferenceUsage(model, points)
          return <tr key={model.id}><th scope="row">{model.name}</th><td>{estimate ? `${numbers.format(estimate.calls)} 次` : '无法估算'}</td><td>{estimate ? numbers.format(estimate.inputTokens) : '—'}</td><td>{estimate ? numbers.format(estimate.outputTokens) : '—'}</td></tr>
        })}</tbody>
      </table>
    </div>
    <div className="ep-docs-notice">
      <p>示例请求次数仅供估算，实际消息数会随上下文和任务变化：一次消息可能触发多次调用，历史对话与资料会计入输入，思考／推理 tokens 会计入总输出。</p>
      <p>示例无缓存、无工具、无搜索及其他附加费用，未触发长上下文档。tokens 不等于中文字数，同一段文字在不同模型的分词结果也不同。</p>
    </div>
    <details><summary>查看估算方法与参考汇率</summary><p>单次积分 =（输入 tokens × 官方输入单价 + 总输出 tokens × 官方输出单价）÷ {numbers.format(REFERENCE_PRICING.unitTokens)} × {REFERENCE_PRICING.referenceCnyPerUsd} ÷ {REFERENCE_PRICING.referenceCnyPerPoint}。</p><p>参考汇率为 1 USD = {REFERENCE_PRICING.referenceCnyPerUsd} CNY；1 积分对应人民币 {money.format(REFERENCE_PRICING.referenceCnyPerPoint)} 的官方参考用量。次数以未四舍五入的单次积分计算，再向下取整。积分按官方参考倍率折算，不代表平台按官方标价采购。</p></details>
  </>
}

export function DocsPage({ authenticated = false }: { authenticated?: boolean }) {
  const catalog = useQuery({ queryKey: ['public-product-catalog'], queryFn: ({ signal }) => readPublicProductCatalog(signal), retry: 1, staleTime: 60_000 })
  const currentCatalog = catalog.data
  const { hash } = useLocation()
  useEffect(() => {
    const previousTitle = document.title
    document.title = 'Docs · Everplain'
    return () => { document.title = previousTitle }
  }, [])
  useEffect(() => {
    if (!hash) return
    // Hash targets are local section IDs, never selectors sourced from the URL.
    document.getElementById(hash.slice(1))?.scrollIntoView?.({ block: 'start' })
  }, [hash, catalog.isPending])
  const publicStatus = catalog.isPending ? <p role="status">正在读取当前模型与订阅目录…</p> : catalog.isError ? <div className="ep-docs-notice" role="alert"><p>{currentCatalog ? '本次刷新目录失败，下面保留上次成功读取的内容。当前可用模型、套餐和额度请重试后确认。' : '暂时无法读取当前目录。使用指南与官方参考价仍可查看；可用模型、套餐和额度请重试后确认。'}</p><button className="qx-btn qx-btn--secondary" type="button" disabled={catalog.isFetching} onClick={() => void catalog.refetch()}>{catalog.isFetching ? '正在重试…' : '重试目录'}</button></div> : null
  return <div className="ep-docs">
    <a className="ep-docs-skip" href="#docs-main">跳到正文</a>
    <header className="ep-docs-header">
      <Link className="ep-docs-brand" to="/welcome" aria-label="Everplain 首页"><span aria-hidden="true" />Everplain</Link>
      <nav aria-label="文档导航"><Link to="/welcome">首页</Link><Link to="/docs" aria-current="page">Docs</Link><Link className="qx-btn qx-btn--primary" to={authenticated ? '/app' : '/login'}>{authenticated ? '进入工作台' : '登录'}<ArrowUpRightIcon size={16} aria-hidden="true" /></Link></nav>
    </header>
    <div className="ep-docs-layout">
      <aside className="ep-docs-sidebar"><p>使用指南</p><nav aria-label="文档目录">{contents.map(([id, label]) => <Link key={id} to={`#${id}`} aria-current={hash === `#${id}` ? 'location' : undefined}>{label}</Link>)}</nav><small>从资料到想法，<br />每一步都留得下来。</small></aside>
      <main id="docs-main">
        <header className="ep-docs-intro"><p className="ep-docs-kicker">Everplain Docs</p><h1>把资料用起来。</h1><p>收集、整理、带着出处思考，再把想法写成文稿。这份指南介绍现在能做的事，以及模型和积分如何使用。</p></header>
        <section id="start" aria-labelledby="start-title"><h2 id="start-title">从一份资料开始</h2><p>不用先规划一整套知识体系。选一篇你想读懂的文章、一份 PDF，或者一段笔记，走完下面三步。</p>
          <ol className="ep-docs-steps"><li><StackIcon size={28} aria-hidden="true" /><div><h3>收到资料库</h3><p>在个人知识库添加资料，检查导入结果。文件、网页和平台导入的支持范围以导入面板为准。</p><Link to="/library">打开个人知识库<ArrowUpRightIcon size={14} aria-hidden="true" /></Link></div></li><li><ChatCircleIcon size={28} aria-hidden="true" /><div><h3>带着具体问题对话</h3><p>先问“这份资料在解释什么”，再追问论据。需要使用资料时，选择已就绪的知识库，并打开引用核对原文。</p><Link to="/agent">打开对话<ArrowUpRightIcon size={14} aria-hidden="true" /></Link></div></li><li><FileTextIcon size={28} aria-hidden="true" /><div><h3>变成可修改的文稿</h3><p>进入文稿工作区，组织章节、修改正文、检查引用，并按导出面板提供的格式保存。</p><Link to="/writing">打开文稿<ArrowUpRightIcon size={14} aria-hidden="true" /></Link></div></li></ol>
          <p className="ep-docs-caption">上述入口需要登录；登录后会回到你要打开的位置。</p>
        </section>
        <section id="collect" aria-labelledby="collect-title"><h2 id="collect-title">收集与知识库</h2><div className="ep-docs-columns"><article><BookOpenIcon size={32} aria-hidden="true" /><h3>资料是起点，出处要保留</h3><p>在右上角“添加”上传文件、加入网页链接，或从导入入口整理已有笔记与收藏。保留原文，方便之后检索、阅读与引用。</p></article><article><StackIcon size={32} aria-hidden="true" /><h3>先看处理状态，再用它回答</h3><p>资料卡片会显示解析、知识整理和语义索引的进度。等需要的资料就绪后再用它检索；查看图谱还需要完成实体与关系整理。</p></article></div><p>遇到未就绪资料，可以先用已就绪部分，或选择补齐并等待。点击资料卡片可打开原文；从“导入记录”查看处理情况。</p><figure className="ep-docs-screenshot"><a href={libraryScreenshot} target="_blank" rel="noopener noreferrer" aria-label="放大知识库原图，在新窗口打开"><img src={libraryScreenshot} width={1440} height={1000} loading="lazy" alt="Everplain 个人知识库真实界面：三份演示笔记已保存，卡片显示等待知识整理与语义索引。" /></a><figcaption>知识库实拍 · 演示资料正在等待整理与索引。点击查看原尺寸。</figcaption></figure></section>
        <section id="research" aria-labelledby="research-title"><h2 id="research-title">对话、研究与文稿</h2><div className="ep-docs-columns"><article><h3>日常对话</h3><p>说明你的问题、背景和希望得到的结果。你可以切换模型与思考强度。需要出处时明确要求检索资料，并逐条核对引用。</p></article><article><h3>研究与写作</h3><p>复杂问题可以进入研究工作区，持续整理材料与保存结果。写作时用工具栏组织标题、段落和列表，在右侧继续讨论；检查 AI 修改预览后再接受，完成后从右上角导出文稿。</p></article></div><figure className="ep-docs-screenshot"><a href={writingScreenshot} target="_blank" rel="noopener noreferrer" aria-label="放大写作文稿原图，在新窗口打开"><img src={writingScreenshot} width={1440} height={1000} loading="lazy" alt="Everplain 写作工作区真实界面：编辑演示文稿《沿河步行的一小时》，包含标题、段落、列表、右侧对话区和导出 Markdown 按钮。" /></a><figcaption>写作工作区实拍 · 原生编辑器中的原创演示文稿。点击查看原尺寸。</figcaption></figure><p className="ep-docs-notice">AI 可能出错，重要事实、计算与决策请核对来源后再使用。</p></section>
        <section id="models" aria-labelledby="models-title"><h2 id="models-title">模型与你的思考节奏</h2><p>Free 和付费档位都可使用当前开放的全部模型，差别在积分额度。实际可选型号、思考强度和可用状态，以服务端目录及工作台为准。</p>{publicStatus}{currentCatalog && <><p className="ep-docs-caption">目录上次读取：{new Date(catalog.dataUpdatedAt).toLocaleString('zh-CN')}（本机时间）</p><p className="ep-docs-caption">{currentCatalog.runtime_mode === 'mock' ? '当前服务处于演示模式。' : '以下型号来自当前服务端目录。'}</p><p>当前目录：{currentCatalog.agent_models.length ? currentCatalog.agent_models.map(model => model.label).join('、') : '暂无可选型号'}。</p><ModelControlPreview key={JSON.stringify(currentCatalog.agent_models)} catalog={currentCatalog} /><p>需要更深入推敲时，可以提高思考强度；这通常会增加等待时间和积分用量。各型号提供的档位直接显示在控件中。</p></>}</section>
        <section id="pricing" aria-labelledby="pricing-title"><h2 id="pricing-title">先看官方价格</h2><p>以下是官方标准 API 参考价，单位为 USD / 百万 tokens。按输入、缓存读取和输出分别计算，便于比较相同任务的相对用量。</p><p className="ep-docs-caption">核验日期：<time dateTime={REFERENCE_PRICING.checkedOn}>{REFERENCE_PRICING.checkedOn}</time>。价格可能调整，点击模型名称查看原厂页面。</p><div className="ep-docs-table-scroll" tabIndex={0} role="region" aria-label="官方模型参考价格表，可横向滚动"><table><caption>标准 API 输入、缓存读取与输出价格</caption><thead><tr><th scope="col">模型 / 官方来源</th><th scope="col">输入</th><th scope="col">缓存读取</th><th scope="col">输出</th></tr></thead><tbody>{REFERENCE_PRICING.models.map(model => <tr key={model.id}><th scope="row"><a href={model.source} target="_blank" rel="noopener noreferrer">{model.name}<span className="ep-docs-sr-only">，官方价格，在新窗口打开</span></a></th><td>${numbers.format(model.input)}</td><td>${numbers.format(model.cachedInput)}</td><td>${numbers.format(model.output)}</td></tr>)}</tbody></table></div><details><summary>缓存、长上下文与时段说明</summary><ul className="ep-docs-notes">{REFERENCE_PRICING.models.map(model => <li key={model.id}><strong>{model.name}：</strong>{model.note}</li>)}</ul><p className="ep-docs-caption">Batch、Flex、Priority、区域处理及附加工具费率，请以原厂说明为准。</p></details></section>
        <section id="free" aria-labelledby="free-title"><h2 id="free-title">Free 大致能用多少？</h2>{currentCatalog ? <FreeEstimate points={currentCatalog.free_weekly_points} resetDays={currentCatalog.reset_days} /> : <p>读取当前 Free 额度后，将显示对应的用量估算。</p>}</section>
        <section id="plans" aria-labelledby="plans-title"><h2 id="plans-title">按你的使用节奏选择</h2><p>根据使用频率选择额度，实际余额和扣费可在账户用量页查看。</p>{currentCatalog ? <><SubscriptionPlanCards catalog={currentCatalog} /><p>订阅按各档位标注的天数计算，每 {currentCatalog.reset_days} 天进入新的额度周期。总积分是各周期配额之和，按周期发放。</p><p>充值包：{money.format(currentCatalog.top_up_price_cny_fen / 100)} / {numbers.format(currentCatalog.top_up_points)} 积分。具体到账与到期规则以账户订阅页和已启用的服务为准。</p><p className="ep-docs-notice">{currentCatalog.payments_enabled ? '支付开通情况及可用操作请登录账户订阅页查看。' : '当前未接入真实支付，套餐与充值包仅作规则展示。'}</p><Link className="ep-docs-text-link" to="/subscription">查看账户订阅与额度<ArrowUpRightIcon size={16} aria-hidden="true" /></Link></> : <p>套餐目录读取成功后，会在这里显示当前价格与额度。</p>}</section>
        <section id="appearance" aria-labelledby="appearance-title"><h2 id="appearance-title">让它成为你的 Everplain</h2><div className="ep-docs-columns ep-docs-columns--center"><div><p>设置里可以给你的 AI 起名、挑选角色外观，并调整说话风格。资料、对话和文稿仍围绕你的账户与私有知识库组织。</p><Link className="ep-docs-text-link" to="/settings">打开设置<ArrowUpRightIcon size={16} aria-hidden="true" /></Link></div><AvatarPreview /></div></section>
        <section id="questions" aria-labelledby="questions-title"><h2 id="questions-title">常见问题</h2><details><summary>为什么长对话会更快消耗积分？</summary><p>后续请求会携带相关历史内容、系统提示与检索片段。思考、工具和多轮执行也会增加用量，可以在账户用量页查看明细。</p></details><details><summary>换模型会丢掉资料吗？</summary><p>模型选择影响后续调用。你的资料、对话记录和文稿由工作区保存；不同模型的能力、上下文限制和响应仍可能不同。</p></details><details><summary>为什么看到了模型，但调用失败？</summary><p>先查看界面的错误原因：额度不足可检查余额，模型服务异常可稍后重试。保留报错信息，也方便进一步定位问题。</p></details><details><summary>我可以在哪里查看隐私与数据操作？</summary><p>账户设置提供当前支持的数据导出、账号管理等操作。向外分享、发布知识库或接入外部服务前，请检查目标、内容和权限。</p></details></section>
        <footer className="ep-docs-footer"><p>准备好从一份资料开始了吗？</p><Link className="qx-btn qx-btn--primary" to="/library">进入个人知识库<ArrowUpRightIcon size={16} aria-hidden="true" /></Link><a href="https://github.com/huyanxius/everplain" target="_blank" rel="noopener noreferrer">项目与反馈</a></footer>
      </main>
    </div>
  </div>
}
