import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRightIcon, BookOpenIcon, ChatCircleIcon, FileTextIcon, StackIcon } from '@phosphor-icons/react'
import { Link, useLocation } from 'react-router'
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
    <p>这里使用工作台的真实控件和当前服务端目录。调整只在此页生效，不发起模型调用，也不更改账户设置。</p>
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
    <figcaption>真实角色组件预览。选择不会保存到你的账户。</figcaption>
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
      <p>这不是保证可发送的消息条数。一次用户消息可能触发多次模型调用；历史对话、系统提示、资料片段也会计入输入。总输出包含供应商计费的思考／推理 tokens。</p>
      <p>示例无缓存、无工具、无搜索及其他附加费用，未触发长上下文档。tokens 不等于中文字数，同一段文字在不同模型的分词结果也不同。</p>
    </div>
    <details><summary>查看估算方法与参考汇率</summary><p>单次积分 =（输入 tokens × 官方输入单价 + 总输出 tokens × 官方输出单价）÷ {numbers.format(REFERENCE_PRICING.unitTokens)} × {REFERENCE_PRICING.referenceCnyPerUsd} ÷ {REFERENCE_PRICING.referenceCnyPerPoint}。</p><p>参考汇率为 1 USD = {REFERENCE_PRICING.referenceCnyPerUsd} CNY；1 积分对应人民币 {money.format(REFERENCE_PRICING.referenceCnyPerPoint)} 的官方参考用量。次数以未四舍五入的单次积分计算，再向下取整。它描述相对扣费的参考尺度，不代表平台按官方标价采购。</p></details>
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
        <section id="collect" aria-labelledby="collect-title"><h2 id="collect-title">收集与知识库</h2><div className="ep-docs-columns"><article><BookOpenIcon size={32} aria-hidden="true" /><h3>资料是起点，出处要保留</h3><p>可以上传文件、加入网页链接，或使用导入入口整理已有笔记与收藏。浏览器扩展和平台导入各有支持范围与授权要求；请先确认拥有资料的访问和使用权限。</p></article><article><StackIcon size={32} aria-hidden="true" /><h3>先看处理状态，再用它回答</h3><p>导入成功不等于所有整理工作已经完成。解析、检索索引、实体和关系整理可能处于不同阶段；图谱需要实体与关系，只有向量索引并不代表图谱已就绪。</p></article></div><p>遇到未就绪资料，界面会让你选择仅使用已就绪部分，或补齐后等待。失败资料要检查原因，不能把它当作已经读懂的证据。分享知识库或发布公开条目前，请检查权限与内容。</p></section>
        <section id="research" aria-labelledby="research-title"><h2 id="research-title">对话、研究与文稿</h2><div className="ep-docs-columns"><article><h3>日常对话</h3><p>说明你的问题、背景和希望得到的结果。你可以切换模型与思考强度。需要出处时明确要求检索资料，并逐条核对引用。</p></article><article><h3>研究与写作</h3><p>复杂问题可以进入研究工作区，持续整理材料、推进问题和保存结果。文稿支持独立编辑与 AI 修改；检查修改预览后再接受，保留你自己的判断。</p></article></div><p className="ep-docs-notice">AI 可能出错。引用只能帮助追溯来源，不自动证明结论正确；重要事实、计算与决策都应再核验。</p></section>
        <section id="models" aria-labelledby="models-title"><h2 id="models-title">模型与你的思考节奏</h2><p>Free 和付费档位都可使用当前开放的全部模型，差别在积分额度。实际可选型号、思考强度和可用状态，以服务端目录及工作台为准。</p>{publicStatus}{currentCatalog && <><p className="ep-docs-caption">目录上次读取：{new Date(catalog.dataUpdatedAt).toLocaleString('zh-CN')}（本机时间）</p><p className="ep-docs-caption">{currentCatalog.runtime_mode === 'mock' ? '当前服务处于演示模式，目录不代表真实模型已连通。' : '下面读取当前服务端的对话模型目录。列出型号不代表每一次调用都能成功。'}</p><p>当前目录：{currentCatalog.agent_models.length ? currentCatalog.agent_models.map(model => model.label).join('、') : '暂无可选型号'}。</p><ModelControlPreview key={JSON.stringify(currentCatalog.agent_models)} catalog={currentCatalog} /><p>较高的思考强度可能带来更多推理输出、更长等待和更多积分消耗。没有思考强度选项的模型不会出现调节滑杆；不支持的档位也不会被补造出来。</p></>}</section>
        <section id="pricing" aria-labelledby="pricing-title"><h2 id="pricing-title">先看官方价格</h2><p>以下是官方标准 API 参考价，单位为 USD / 百万 tokens。它是理解相对用量的基准，不是平台采购价，也不是当前可用模型清单。</p><p className="ep-docs-caption">核验日期：<time dateTime={REFERENCE_PRICING.checkedOn}>{REFERENCE_PRICING.checkedOn}</time>。价格可能调整，点击模型名称查看原厂页面。</p><div className="ep-docs-table-scroll" tabIndex={0} role="region" aria-label="官方模型参考价格表，可横向滚动"><table><caption>标准 API 输入、缓存读取与输出价格</caption><thead><tr><th scope="col">模型 / 官方来源</th><th scope="col">输入</th><th scope="col">缓存读取</th><th scope="col">输出</th></tr></thead><tbody>{REFERENCE_PRICING.models.map(model => <tr key={model.id}><th scope="row"><a href={model.source} target="_blank" rel="noopener noreferrer">{model.name}<span className="ep-docs-sr-only">，官方价格，在新窗口打开</span></a></th><td>${numbers.format(model.input)}</td><td>${numbers.format(model.cachedInput)}</td><td>${numbers.format(model.output)}</td></tr>)}</tbody></table></div><ul className="ep-docs-notes">{REFERENCE_PRICING.models.map(model => <li key={model.id}><strong>{model.name}：</strong>{model.note}</li>)}</ul><p className="ep-docs-caption">Batch、Flex、Priority、区域处理和附加工具可能有不同费率，未混入上表。缓存读取价格不代表完整缓存成本。</p></section>
        <section id="free" aria-labelledby="free-title"><h2 id="free-title">Free 大致能用多少？</h2>{currentCatalog ? <FreeEstimate points={currentCatalog.free_weekly_points} resetDays={currentCatalog.reset_days} /> : <p>先等待当前 Free 额度加载。没有读取到额度时，不显示固定条数或过期估算。</p>}</section>
        <section id="plans" aria-labelledby="plans-title"><h2 id="plans-title">按你的使用节奏选择</h2><p>所有档位使用相同的开放模型范围。积分用量随模型、输入、输出、缓存及工具而变；账户用量页显示实际余额和扣费。</p>{currentCatalog ? <><SubscriptionPlanCards catalog={currentCatalog} /><p>订阅按各档位标注的天数计算，每 {currentCatalog.reset_days} 天进入新的额度周期。页面中的总积分是各周期配额之和，不代表开通时一次发放。</p><p>充值包：{money.format(currentCatalog.top_up_price_cny_fen / 100)} / {numbers.format(currentCatalog.top_up_points)} 积分。具体到账与到期规则以账户订阅页和已启用的服务为准。</p><p className="ep-docs-notice">{currentCatalog.payments_enabled ? '支付开通情况及可用操作请登录账户订阅页查看。' : '当前未接入真实支付。此处展示套餐与积分规则，不能在这里购买或充值。'}</p><Link className="ep-docs-text-link" to="/subscription">查看账户订阅与额度<ArrowUpRightIcon size={16} aria-hidden="true" /></Link></> : <p>套餐目录读取成功后，会在这里显示当前价格与额度。</p>}</section>
        <section id="appearance" aria-labelledby="appearance-title"><h2 id="appearance-title">让它成为你的 Everplain</h2><div className="ep-docs-columns ep-docs-columns--center"><div><p>设置里可以给你的 AI 起名、挑选角色外观，并调整说话风格。资料、对话和文稿仍围绕你的账户与私有知识库组织。</p><p>界面共用纸面、墨色、衬线标题和清晰的圆角控件；浅色与深色外观沿用工作台的设计变量。</p><Link className="ep-docs-text-link" to="/settings">打开设置<ArrowUpRightIcon size={16} aria-hidden="true" /></Link></div><AvatarPreview /></div></section>
        <section id="questions" aria-labelledby="questions-title"><h2 id="questions-title">常见问题</h2><details><summary>为什么长对话会更快消耗积分？</summary><p>后续请求可能再次携带历史内容、系统提示与检索片段。思考、工具和多轮执行也会增加用量。以账户中的实际扣费为准，不要用界面上消息的长度直接推算。</p></details><details><summary>换模型会丢掉资料吗？</summary><p>模型选择影响后续调用。你的资料、对话记录和文稿由工作区保存；不同模型的能力、上下文限制和响应仍可能不同。</p></details><details><summary>为什么看到了模型，但调用失败？</summary><p>目录说明服务允许选择的型号，不保证供应商持续在线。额度不足、模型服务异常或功能限制都可能导致调用失败。先阅读界面错误，再决定是否重试，避免连续重复提交。</p></details><details><summary>我可以在哪里查看隐私与数据操作？</summary><p>账户设置提供当前支持的数据导出、账号管理等操作。向外分享、发布知识库或接入外部服务前，请检查目标、内容和权限。</p></details></section>
        <footer className="ep-docs-footer"><p>准备好从一份资料开始了吗？</p><Link className="qx-btn qx-btn--primary" to="/library">进入个人知识库<ArrowUpRightIcon size={16} aria-hidden="true" /></Link><a href="https://github.com/huyanxius/everplain" target="_blank" rel="noopener noreferrer">项目与反馈</a></footer>
      </main>
    </div>
  </div>
}
