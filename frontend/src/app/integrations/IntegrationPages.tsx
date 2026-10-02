import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router'
import { ArrowLeftIcon, ArrowRightIcon, ArrowUpRightIcon, CheckIcon, CopyIcon, KeyIcon, LinkIcon, MagnifyingGlassIcon, PlusIcon, ShieldCheckIcon, SparkleIcon, XIcon } from '@phosphor-icons/react'
import * as api from '../../modules/product-integrations'
import { useAccount } from '../../modules/account'
import { PageContent, PageShell } from '../ui/PageShell'
import { ErrorState, LoadingState } from '../ui/States'
import './integrations.css'

function Shell({ active, title, subtitle, children }: { active: string; title: string; subtitle: string; children: ReactNode }) {
  return <PageShell wide><PageContent><main className="ep-hub"><Link className="ep-hub-back" to="/app"><ArrowLeftIcon size={15} />我的空间</Link><header><p>MORE ROOM TO THINK</p><h1>{title}</h1><span>{subtitle}</span></header><nav className="ep-hub-nav" aria-label="知识空间设置">{[['sharing','共享知识库'],['discover','公共主题'],['connections','外部连接'],['subscription','模型与套餐']].map(([id,label]) => <Link key={id} to={`/${id}`} aria-current={active === id ? 'page' : undefined}>{label}</Link>)}</nav>{children}</main></PageContent></PageShell>
}
function useIdentityKey() { const account=useAccount(); return account.sessionState.status==='authenticated'?account.sessionState.session.user.userId:null }
function message(e: unknown) { return e instanceof Error ? e.message : '暂时未完成，请重试' }

export function SharingPage() {
  const userKey = useIdentityKey()
  return <SharingContent key={userKey ?? 'anonymous'} />
}
function SharingContent() {
  const [params] = useSearchParams()
  const userKey = useIdentityKey()
  const list = useQuery({ queryKey: ['share-libraries', userKey], queryFn: api.libraries })
  const [invite, setInvite] = useState(params.get('invite') ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [publishing, setPublishing] = useState<string>()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [topics, setTopics] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [copied, setCopied] = useState('')
  async function run(action: () => Promise<unknown>) { setBusy(true); setError(''); try { await action(); await list.refetch() } catch (e) { setError(message(e)) } finally { setBusy(false) } }
  return <Shell active="sharing" title="分享一份理解，开启一场交流。" subtitle="你的资料默认私有。邀请他人只读，或把选定的资料发布成公共主题，都由你决定。">
    <section className="ep-hub-join"><LinkIcon size={22} weight="light" /><div><h2>收到一份邀请？</h2><p>粘贴邀请链接或邀请口令，加入对方的只读知识库。</p></div><form onSubmit={e => { e.preventDefault(); let token = invite.trim(); try { token = new URL(token).searchParams.get('invite') ?? token } catch { /* plain token */ } void run(() => api.join(token)) }}><input aria-label="邀请链接或口令" value={invite} onChange={e => setInvite(e.target.value)} required placeholder="粘贴邀请链接或口令" /><button disabled={busy}>加入<ArrowRightIcon size={14} /></button></form></section>
    {error && <p role="alert" className="ep-hub-error">{error}</p>}{list.isPending ? <LoadingState message="正在读取知识库" /> : list.isError ? <ErrorState detail={list.error.message} onRetry={() => { void list.refetch() }} /> : <div className="ep-hub-cards">{list.data?.map(kb => <article className="ep-hub-card" key={kb.id}><small>{kb.viewer_access === 'owner' ? '我拥有的知识库' : '加入的只读知识库'}</small><h2>{kb.name}</h2><p>{kb.description || '收藏的资料，在这里慢慢形成联系。'}</p><span className="ep-hub-count">{kb.ready_document_count} 份可读资料</span><div className="ep-hub-card-actions"><Link to={kb.viewer_access === 'owner' ? `/library?kb_id=${kb.id}` : `/shared/${kb.id}`}>打开 <ArrowUpRightIcon size={13} /></Link>{kb.viewer_access === 'owner' ? <button disabled={busy} onClick={() => { void run(() => api.sharing(kb.id, !kb.sharing_enabled)) }}>{kb.sharing_enabled ? '关闭邀请共享' : '开启只读邀请'}</button> : <button disabled={busy} onClick={() => { void run(() => api.leave(kb.id)) }}>退出知识库</button>}</div>
      {kb.viewer_access === 'owner' && kb.sharing_enabled && kb.share_token && <div className="ep-hub-invite"><p>持有此链接并登录的人可加入，只能阅读。关闭共享会撤销成员访问和旧邀请。</p><button onClick={() => { void navigator.clipboard.writeText(`${window.location.origin}/sharing?invite=${encodeURIComponent(kb.share_token!)}`).then(() => setCopied(kb.id)).catch(() => setError('复制失败，请手动复制链接')) }}>{copied === kb.id ? <CheckIcon size={14} /> : <CopyIcon size={14} />}{copied === kb.id ? '已复制邀请链接' : '复制邀请链接'}</button></div>}
      {kb.viewer_access === 'owner' && <footer>{kb.publication ? <><span>已公开 {kb.publication.document_count} 份资料</span><button disabled={busy} onClick={() => { void run(() => api.unpublish(kb.id)) }}>撤回公开</button></> : <button onClick={() => { setPublishing(kb.id); setTitle(kb.name ?? ''); setDescription(kb.description ?? ''); setTopics(''); setConfirm(false) }}>发布到公共主题 <ArrowUpRightIcon size={12} /></button>}</footer>}
    </article>)}{list.data?.length === 0 && <div className="ep-hub-empty"><h2>从一个自己的知识库开始。</h2><Link to="/imports">导入资料 <ArrowRightIcon size={14} /></Link></div>}</div>}
    {publishing && <div className="ep-hub-modal-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="public-title" className="ep-hub-modal"><header><h2 id="public-title">把这份知识带给更多人。</h2><button aria-label="关闭发布" disabled={busy} onClick={() => setPublishing(undefined)}><XIcon size={18} /></button></header><form onSubmit={e => { e.preventDefault(); if (!confirm) return; void run(async () => { await api.publish(publishing,{title,description,topics:topics.split(/[、,，]/).map(x=>x.trim()).filter(Boolean),confirm_public_content:true});setPublishing(undefined) }) }}><label>公共标题<input required maxLength={100} value={title} onChange={e=>setTitle(e.target.value)} /></label><label>主题简介<textarea maxLength={1000} value={description} onChange={e=>setDescription(e.target.value)} /></label><label>主题标签<input value={topics} onChange={e=>setTopics(e.target.value)} placeholder="用顿号分隔，最多 12 个" /></label><label className="ep-hub-check"><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)} />我确认将当前 {list.data?.find(x=>x.id===publishing)?.ready_document_count ?? 0} 份可读资料及原文公开，任何人都可阅读。以后新增的资料不会自动公开。</label><button className="ep-hub-primary" disabled={busy || !confirm}>确认公开当前资料</button></form></section></div>}
  </Shell>
}

export function PublicDirectoryPage() {
  const [query,setQuery]=useState('')
  const list=useQuery({queryKey:['public-directory',query],queryFn:()=>api.directory(query)})
  return <Shell active="discover" title="沿着别人的思考，发现新的方向。" subtitle="这些主题由所有者主动公开，资料与原文可以直接阅读。"><label className="ep-hub-search"><MagnifyingGlassIcon size={18}/><input aria-label="搜索公共主题" value={query} onChange={e=>setQuery(e.target.value)} placeholder="找一个感兴趣的主题……"/></label>{list.isPending?<LoadingState message="正在寻找公开主题"/>:list.isError?<ErrorState detail={list.error.message}/>:<div className="ep-hub-cards">{list.data?.map(p=><Link className="ep-hub-card" key={p.knowledge_base_id} to={`/discover/${p.knowledge_base_id}`}><small>{p.document_count} 份公开资料</small><h2>{p.title}</h2><p>{p.description}</p><div className="ep-hub-tags">{p.topics.map(t=><span key={t}>{t}</span>)}</div><footer>打开主题<ArrowUpRightIcon size={14}/></footer></Link>)}{list.data?.length===0&&<div className="ep-hub-empty"><SparkleIcon size={28} weight="light"/><h2>这里还留着很多可能。</h2><p>{query?'换个关键词，看看别的方向。':'还没有公开主题。你可以先整理自己的知识库，再决定是否分享。'}</p><Link to="/sharing">管理我的分享<ArrowRightIcon size={14}/></Link></div>}</div>}</Shell>
}

export function SharedReaderPage({publicView=false}:{publicView?:boolean}) {
  const {libraryId=''} = useParams()
  const userKey = useIdentityKey()
  return <SharedReaderContent key={`${publicView}:${libraryId}:${userKey ?? 'anonymous'}`} publicView={publicView} />
}
function SharedReaderContent({publicView=false}:{publicView?:boolean}) {
  const {libraryId=''}=useParams()
  const userKey = useIdentityKey()
  const [selected,setSelected]=useState<string>()
  const value=useQuery({queryKey:['shared-reader',publicView,libraryId,publicView?'public':userKey],queryFn:async()=>publicView?api.publicLibrary(libraryId):api.library(libraryId)})
  const source=useQuery({queryKey:['shared-reader-source',publicView,libraryId,selected,publicView?'public':userKey],queryFn:()=>publicView?api.publicSource(libraryId,selected!):api.privateSource(libraryId,selected!),enabled:Boolean(selected)})
  if(value.isPending)return <LoadingState message="正在读取资料"/>
  if(value.isError)return <ErrorState detail={value.error.message}/>
  const title='publication' in value.data&&value.data.publication?value.data.publication.title:'name' in value.data?value.data.name:'公开主题'
  const documents=value.data.documents??[]
  return <Shell active={publicView?'discover':'sharing'} title={title??'知识库'} subtitle="只读原文，保留出处。所有者撤销访问后，这些资料将不可继续读取。"><div className="ep-hub-reader"><aside>{documents.map(d=><button key={d.id} aria-pressed={selected===d.id} onClick={()=>setSelected(d.id)}>{d.filename}<ArrowRightIcon size={12}/></button>)}</aside><article>{!selected?<p className="ep-hub-muted">选择一份资料开始阅读。</p>:source.isPending?<LoadingState message="正在打开原文"/>:source.isError?<ErrorState detail={source.error.message}/>:<><h2>{source.data?.document.filename}</h2>{source.data?.segments.map(s=><p key={s.segment_id}>{s.text}</p>)}</>}</article></div></Shell>
}

export function ConnectionsPage() {
  const userKey = useIdentityKey()
  return <ConnectionsContent key={userKey ?? 'anonymous'} />
}
function ConnectionsContent() {
  const userKey=useIdentityKey()
  const list=useQuery({queryKey:['external-connections',userKey],queryFn:api.connections})
  const libs=useQuery({queryKey:['share-libraries',userKey],queryFn:api.libraries})
  const [name,setName]=useState('');const [ids,setIds]=useState<string[]>([]);const [days,setDays]=useState(30)
  const [secret,setSecret]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false)
  async function create(){setBusy(true);setError('');try{const result=await api.createConnection({name,library_ids:ids,expires_at:new Date(Date.now()+days*86400000).toISOString()});setSecret(result.secret);setName('');setIds([]);await list.refetch()}catch(e){setError(message(e))}finally{setBusy(false)}}
  return <Shell active="connections" title="让你选的工具，读懂你的资料。" subtitle="每个连接只读指定知识库，有效期明确，可以随时撤销。"><div className="ep-hub-two-columns"><section className="ep-hub-panel"><KeyIcon size={26} weight="light"/><h2>建立一个受限连接</h2><form onSubmit={e=>{e.preventDefault();void create()}}><label>连接名称<input value={name} maxLength={80} required onChange={e=>setName(e.target.value)} placeholder="例如：我的桌面 Agent"/></label><fieldset><legend>允许阅读哪些知识库？</legend>{libs.isPending && <p>正在读取知识库…</p>}{libs.isError && <p role="alert">{libs.error.message}</p>}{libs.data?.filter(l=>l.viewer_access==='owner').map(l=><label className="ep-hub-check" key={l.id}><input type="checkbox" checked={ids.includes(l.id)} onChange={e=>setIds(e.target.checked?[...ids,l.id]:ids.filter(id=>id!==l.id))}/>{l.name}</label>)}</fieldset><label>有效期<select value={days} onChange={e=>setDays(Number(e.target.value))}><option value={7}>7 天</option><option value={30}>30 天</option><option value={90}>90 天</option></select></label><p className="ep-hub-muted">创建后请你手动配置 MCP 客户端。密钥仅显示一次，不要发送给不信任的人。</p><button className="ep-hub-primary" disabled={busy||!ids.length}>{busy?'正在创建…':'创建只读连接'}<PlusIcon size={14}/></button></form>{error&&<p role="alert" className="ep-hub-error">{error}</p>}{secret&&<div className="ep-hub-secret"><strong>请现在保存，关闭后不会再次显示</strong><textarea aria-label="一次性连接密钥" readOnly value={secret}/><p>MCP：{window.location.origin}{list.data?.mcp_endpoint??'/api/mcp'}</p><p>认证方式：Bearer Token</p><button onClick={()=>setSecret('')}>我已保存，关闭密钥</button></div>}</section><section><h2 className="ep-hub-section-title">现有连接</h2>{list.isError&&<p role="alert">{list.error.message}</p>}{list.data?.connections.map(c=><article className="ep-hub-connection" key={c.connection_id}><ShieldCheckIcon size={21} weight="light"/><div><strong>{c.name}</strong><p>{c.library_ids.length} 个知识库 · {new Date(c.expires_at).toLocaleDateString()} 到期</p><span>{c.status==='active'?'有效':c.status==='expired'?'已到期':'已撤销'}</span></div>{c.status==='active'&&<button disabled={busy} onClick={()=>{setBusy(true);void api.revokeConnection(c.connection_id).then(()=>list.refetch()).catch(e=>setError(message(e))).finally(()=>setBusy(false))}}>撤销</button>}</article>)}{list.data?.connections.length===0&&<p className="ep-hub-muted">还没有外部连接。你的资料不会自动开放给其他工具。</p>}</section></div></Shell>
}

export function SubscriptionPage() {
  const userKey=useIdentityKey()
  const catalog=useQuery({queryKey:['model-catalog',userKey],queryFn:api.models});const subscription=useQuery({queryKey:['subscription',userKey],queryFn:api.subscription})
  const [busy,setBusy]=useState(false);const [error,setError]=useState('')
  async function redirect(action:()=>Promise<{checkout_url:string}|{portal_url:string}>){setBusy(true);setError('');try{const result=await action();const url='checkout_url'in result?result.checkout_url:result.portal_url;if(new URL(url).protocol!=='https:')throw new Error('支付服务返回了无效地址');window.location.assign(url)}catch(e){setError(message(e));setBusy(false)}}
  return <Shell active="subscription" title="合适的能力，陪你多想一步。" subtitle="模型能力以服务配置为准。套餐的金额与支付条款会在正式结算页显示。"><section className="ep-hub-models"><h2>当前模型目录</h2>{catalog.isPending?<LoadingState message="正在读取模型配置"/>:catalog.isError?<ErrorState detail={catalog.error.message}/>:<div className="ep-hub-cards">{catalog.data?.map(m=><article className="ep-hub-card" key={m.id}><small>{m.provider}</small><h2>{m.display_name}</h2><p>{m.model}</p><div className="ep-hub-tags">{m.capabilities.map(c=><span key={c}>{c}</span>)}</div><footer>{m.availability==='configured'?'已配置 · 待实际调用验证':'尚未配置'}</footer>{m.unavailable_reason&&<p className="ep-hub-muted">{m.unavailable_reason}</p>}</article>)}</div>}</section><section className="ep-hub-billing"><h2>订阅与用量方案</h2>{subscription.isPending?<LoadingState message="正在读取套餐"/>:subscription.isError?<ErrorState detail={subscription.error.message}/>:<>{!subscription.data?.available&&<p className="ep-hub-muted">{subscription.data?.unavailable_reason||'支付服务尚未配置，当前不会产生扣款。'}</p>}{subscription.data?.subscription&&<div className="ep-hub-subscription"><span>当前状态：{subscription.data.subscription.status}{subscription.data.subscription.cancel_at_period_end?' · 本期结束后取消':''}</span><button disabled={busy||!subscription.data.available} onClick={()=>{void redirect(api.portal)}}>管理订阅<ArrowUpRightIcon size={14}/></button></div>}<div className="ep-hub-cards">{subscription.data?.plans.map(p=><article className="ep-hub-card" key={p.id}><h2>{p.name}</h2><p>{p.description}</p><button className="ep-hub-primary" disabled={busy||!subscription.data?.available} onClick={()=>{void redirect(()=>api.checkout(p.id))}}>查看正式结算<ArrowUpRightIcon size={14}/></button></article>)}</div></>}{error&&<p role="alert" className="ep-hub-error">{error}</p>}</section></Shell>
}
