import {
  ArrowUpRightIcon,
  CrosshairIcon,
  ListBulletsIcon,
  QuestionIcon, EyeIcon, BooksIcon, TargetIcon, WarningCircleIcon, IntersectIcon, FileTextIcon,
  ArrowsClockwiseIcon, ArrowsOutIcon,
  QuotesIcon,
  XIcon,
} from '@phosphor-icons/react'
import {
  BaseEdge, EdgeLabelRenderer, getBezierPath, applyNodeChanges,
  type EdgeProps,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  NodeToolbar,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
  type XYPosition,
} from '@xyflow/react'
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import type {
  ResearchCanvasEdge,
  ResearchCanvasNode,
  ResearchCanvasNodeKind,
  ResearchCanvasProjection,
} from '../../modules/research-workspace'
import { resolveCssColor } from '../../styles/resolveCssColor'
import { arrangeResearchCanvas, researchCanvasStages, CANVAS_CARD_SIZE, CANVAS_COLUMN_GAP } from '../../modules/research-workspace'
import { canvasSuggestions, type AgentConversation } from '../../modules/research-agent'
import { CanvasCardEditor, type CanvasCardDraft } from './CanvasCardEditor'
import { ResearchAgentBot } from '../agent/ResearchAgentBot'
import '@xyflow/react/dist/style.css'
import './research-map-canvas.css'

type ResearchMapCanvasProps = {
  readonly conversation?: AgentConversation | null
  readonly onConversationChange?: (conversation: AgentConversation) => void
  readonly projection: ResearchCanvasProjection
  readonly idleActions?: ReactNode
  readonly selectedNodeId?: string | null
  readonly onSelectNode?: (node: ResearchCanvasNode) => void
  readonly onClearSelection?: () => void
  readonly onContinueNode?: (node: ResearchCanvasNode) => void
  readonly onOpenCitation?: (citationId: string) => void
  readonly expandedNodeContent?: Readonly<Record<string, ReactNode>>
}

type ArgumentNodeData = {
  node: ResearchCanvasNode
  stage?: number
  hasSuggestion?: boolean
  onFocus: (node: ResearchCanvasNode) => void
  onContinue: (node: ResearchCanvasNode) => void
  sourcePosition?: Position
  targetPosition?: Position
}

type ArgumentFlowNode = Node<ArgumentNodeData, 'argument'>
type FocusDepth = 1 | 2 | 'all'

const EMPTY_EXPANDED_NODE_CONTENT: Readonly<Record<string, ReactNode>> = {}
const ExpandedNodeContentContext = createContext<Readonly<Record<string, ReactNode>>>(EMPTY_EXPANDED_NODE_CONTENT)

const kindLabels: Record<ResearchCanvasNodeKind, string> = {
  question: '研究问题',
  phenomenon: '核心现象',
  theory: '理论视角',
  claim: '核心主张',
  evidence: '经验依据',
  gap: '证据缺口',
  synthesis: '阶段综合',
  document: '研究章节',
}

const nodeStatusLabels: Record<ResearchCanvasNode['status'], string> = {
  developing: '形成中',
  grounded: '已有依据',
  open: '待处理',
  verified: '已核验',
  challenged: '有争议',
  complete: '已完成',
}

const relationLabels: Record<ResearchCanvasEdge['relation'], string> = {
  explains: '解释',
  supports: '支持',
  challenges: '质疑',
  derives: '推导',
  refines: '细化',
}

const kindIcons = { question: QuestionIcon, phenomenon: EyeIcon, theory: BooksIcon, claim: TargetIcon,
  evidence: QuotesIcon, gap: WarningCircleIcon, synthesis: IntersectIcon, document: FileTextIcon }

function CardHandles() {
  return <>{[Position.Left, Position.Right, Position.Top, Position.Bottom].map(position => <span key={position}>
    <Handle id={`in-${position}`} type="target" position={position} className="research-argument-node__handle" />
    <Handle id={`out-${position}`} type="source" position={position} className="research-argument-node__handle" />
  </span>)}</>
}

function ArgumentNode({ data, selected }: NodeProps<ArgumentFlowNode>) {
  const { node } = data
  const expandedContent = useContext(ExpandedNodeContentContext)[node.id]
  const Icon = kindIcons[node.kind]
  if (data.stage !== undefined) {
    const stage = researchCanvasStages[data.stage]
    return <div className="ep-map__stage"><span>0{data.stage + 1}</span><div><h2>{stage.title}</h2><p>{stage.description}</p></div></div>
  }
  if (expandedContent) {
    return (
      <article className="research-document-map-node is-expanded nodrag nowheel">
        <CardHandles />
        {expandedContent}

      </article>
    )
  }
  return (
    <article className={`qx-card research-argument-node is-${node.kind} ${selected ? 'is-selected' : ''}`}>
      <CardHandles />
      <NodeToolbar isVisible={selected} position={Position.Top} offset={10}>
        <div className="research-argument-node__toolbar">
          <button type="button" className="qx-btn qx-btn--ghost nodrag" onClick={() => data.onFocus(node)}><CrosshairIcon size={13} />聚焦</button>
          <button type="button" className="qx-btn qx-btn--ghost nodrag" onClick={() => data.onContinue(node)}>继续研究<ArrowUpRightIcon size={13} /></button>
        </div>
      </NodeToolbar>
      <div className="research-argument-node__meta"><span><Icon size={16} />{kindLabels[node.kind]}</span></div>
      <h3>{node.title}</h3>
      {node.summary ? <p>{node.summary}</p> : null}
      <footer><span>{nodeStatusLabels[node.status]}</span><span>{data.hasSuggestion ? '有改写建议' : node.userEdited ? '你已修改' : node.citationIds.length ? `${node.citationIds.length} 条依据` : node.kind === 'gap' ? '等待补证' : node.kind === 'document' ? '打开文稿' : '研究中'}</span></footer>


    </article>
  )
}

const nodeTypes = { argument: ArgumentNode }

function MapIdleNote({ actions }: { readonly actions?: ReactNode }) {
  return (
    <div className="ep-map__idle-state">
      <div className="ep-map__idle-content">
        <ResearchAgentBot />
        <div className="ep-map__idle-note" aria-label="画布说明">
          <h2 className="qx-section-title">从一个问题开始</h2>
          <p>对话中形成的研究结构会在这里展开。</p>
          {actions}
        </div>
      </div>
    </div>
  )
}

export function ResearchMapCanvas({
  projection,
  conversation = null,
  onConversationChange,
  idleActions,
  selectedNodeId = null,
  onSelectNode,
  onClearSelection,
  onContinueNode,
  onOpenCitation,
  expandedNodeContent = EMPTY_EXPANDED_NODE_CONTENT,
}: ResearchMapCanvasProps) {
  const canvasRef = useRef<HTMLElement>(null)
  const draftCache = useRef(new Map<string, CanvasCardDraft>())
  const [flowNodes, setFlowNodes] = useState<ArgumentFlowNode[]>([])
  const [flowEdges, setFlowEdges] = useState<Edge[]>([])
  const [listOpen, setListOpen] = useState(false)
  const [focusDepth, setFocusDepth] = useState<FocusDepth>('all')
  const [allRelations, setAllRelations] = useState(false)
  const [layoutRevision, setLayoutRevision] = useState(0)
  const positionsRef = useRef(new Map<string, XYPosition>())
  const hasFitted = useRef(false)
  const flowRef = useRef<ReactFlowInstance<ArgumentFlowNode, Edge> | null>(null)
  const onSelectNodeRef = useRef(onSelectNode)
  const onContinueNodeRef = useRef(onContinueNode)
  onSelectNodeRef.current = onSelectNode
  onContinueNodeRef.current = onContinueNode

  const selectedNode = projection.nodes.find((node) => node.id === selectedNodeId) ?? null
  const hasDocumentNodes = projection.nodes.some((node) => node.kind === 'document')
  const focusedDocumentContent = Object.values(expandedNodeContent)[0] ?? null
  const visibleProjection = useMemo(
    () => filterProjection(projection, selectedNodeId, focusDepth),
    [focusDepth, projection, selectedNodeId],
  )
  useEffect(() => {
    positionsRef.current.clear(); hasFitted.current = false
    setLayoutRevision(value => value + 1)
  }, [conversation?.conversation_id])
  useEffect(() => {
    positionsRef.current = arrangeResearchCanvas(projection.nodes, positionsRef.current)
    if (!hasFitted.current && projection.nodes.length) {
      hasFitted.current = true
      requestAnimationFrame(() => { void flowRef.current?.fitView({ padding: 0.15, maxZoom: 0.9, duration: 300 }) })
    }
  }, [projection.nodes, layoutRevision])

  useEffect(() => {
    const positions = arrangeResearchCanvas(projection.nodes, positionsRef.current)
    positionsRef.current = positions
    const visibleIds = new Set(visibleProjection.nodes.map(node => node.id))
    const nodes: ArgumentFlowNode[] = projection.nodes.map(node => ({
      id: node.id, type: 'argument', position: positions.get(node.id)!, selected: node.id === selectedNodeId,
      hidden: !visibleIds.has(node.id), style: CANVAS_CARD_SIZE,
      data: { node, hasSuggestion: !!conversation?.research_map?.nodes.some(item => item.id === node.id && canvasSuggestions(conversation, item).length > 0), onFocus: value => { onSelectNodeRef.current?.(value); setFocusDepth(1) }, onContinue: value => onContinueNodeRef.current?.(value) },
      ariaLabel: `${kindLabels[node.kind]}：${node.title}`,
    }))
    if (projection.nodes.length) researchCanvasStages.forEach((stage, index) => {
      if (!projection.nodes.some(node => (stage.kinds as readonly string[]).includes(node.kind))) return
      nodes.push({ id: `canvas-stage-${index}`, type: 'argument', position: { x: index * CANVAS_COLUMN_GAP, y: 0 },
        selectable: false, draggable: false, focusable: false, style: { width: CANVAS_CARD_SIZE.width, height: 60 },
        data: { node: projection.nodes[0], stage: index, onFocus: () => {}, onContinue: () => {} } })
    })
    setFlowNodes(nodes)
    setFlowEdges(visibleProjection.edges.filter(edge => positions.has(edge.source) && positions.has(edge.target)).map((edge, index) => {
      const from = positions.get(edge.source)!, to = positions.get(edge.target)!
      const sameColumn = Math.abs(from.x - to.x) < CANVAS_CARD_SIZE.width
      const backwards = from.x > to.x
      const sameNode = edge.source === edge.target
      const bypass = sameColumn && Math.abs(from.y - to.y) > 300
      const sourceSide = sameNode || bypass ? Position.Right : sameColumn ? (from.y < to.y ? Position.Bottom : Position.Top) : backwards ? Position.Left : Position.Right
      const targetSide = sameNode ? Position.Bottom : bypass ? Position.Right : sameColumn ? (from.y < to.y ? Position.Top : Position.Bottom) : backwards ? Position.Right : Position.Left
      const active = edge.source === selectedNodeId || edge.target === selectedNodeId
      return { id: edge.id, source: edge.source, target: edge.target, type: 'researchCurve',
        sourceHandle: `out-${sourceSide}`, targetHandle: `in-${targetSide}`,
        data: { label: edge.label === '' ? '' : edge.label || relationLabels[edge.relation], visible: allRelations || active, lane: index % 4, loop: edge.source === edge.target },
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: relationColor(edge.relation) },
        style: { stroke: relationColor(edge.relation), strokeWidth: active ? 1.8 : 1.25, opacity: selectedNodeId && !active && !allRelations ? 0.12 : 0.55,
          strokeDasharray: edge.relation === 'challenges' ? '5 4' : undefined },
      }
    }))
  }, [projection, visibleProjection, selectedNodeId, allRelations, layoutRevision, conversation])

  useEffect(() => {
    if (!listOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setListOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [listOpen])

  const counts = useMemo(() => Object.fromEntries(
    Object.keys(kindLabels).map((kind) => [kind, projection.nodes.filter((node) => node.kind === kind).length]),
  ) as Record<ResearchCanvasNodeKind, number>, [projection.nodes])

  function selectNode(node: ResearchCanvasNode) {
    onSelectNode?.(node)
  }

  function clearSelection() {
    setFocusDepth('all')
    onClearSelection?.()
  }

  return (
    <section ref={canvasRef} className="ep-map" aria-label="研究论证地图">
      {!focusedDocumentContent && projection.nodes.length > 0 ? <header className="ep-map__header"><h2 className="qx-heading">研究地图</h2>            <div className="ep-map__toolbar">
              <nav className="ep-map__depth" aria-label="画布聚焦层级">
                <span>关联范围</span>
                {([1, 2, 'all'] as const).map((depth) => (
                  <button
                    key={depth}
                    type="button"
                    className={["qx-btn qx-btn--ghost", focusDepth === depth ? 'is-active' : ''].filter(Boolean).join(' ')}
                    disabled={depth !== 'all' && !selectedNode}
                    aria-pressed={focusDepth === depth}
                    onClick={() => setFocusDepth(depth)}
                  >{depth === 'all' ? '全部' : depth === 1 ? '直接相关' : '延伸关联'}</button>
                ))}
              </nav>
              <button type="button" className="qx-btn qx-btn--ghost ep-map__directory-toggle" aria-label="显示全部关系" aria-pressed={allRelations} onClick={() => setAllRelations(value => !value)}>关系</button>
              <button type="button" className="qx-btn qx-btn--ghost ep-map__directory-toggle" aria-label="展开画布" onClick={() => { void canvasRef.current?.requestFullscreen?.().catch(() => undefined) }}><ArrowsOutIcon size={16} /></button>
              <button type="button" className="qx-btn qx-btn--ghost ep-map__directory-toggle" aria-label="重新整理画布" onClick={() => { positionsRef.current.clear(); hasFitted.current = false; setLayoutRevision(value => value + 1) }}><ArrowsClockwiseIcon size={16} /></button>
              <button className="qx-btn qx-btn--ghost ep-map__directory-toggle" type="button" title="节点目录" aria-label="打开节点目录" aria-pressed={listOpen} onClick={() => setListOpen((value) => !value)}><ListBulletsIcon size={16} /></button>
            </div>
</header> : null}
      <div className={`ep-map__canvas-wrap${projection.nodes.length ? '' : ' is-empty'}`}>
        {focusedDocumentContent ? (
          <div className="ep-map__document-focus">
            <article className="research-document-map-node is-expanded nodrag nowheel">
              {focusedDocumentContent}
            </article>
          </div>
        ) : (
        <ExpandedNodeContentContext.Provider value={expandedNodeContent}>
        <ReactFlow<ArgumentFlowNode, Edge>
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={changes => setFlowNodes(nodes => applyNodeChanges(changes, nodes))}
          onNodeDragStop={(_, node) => { positionsRef.current.set(node.id, node.position); setLayoutRevision(value => value + 1) }}
          onInit={(instance) => { flowRef.current = instance }}
          onNodeClick={(_, flowNode) => { if (flowNode.data.stage === undefined) selectNode(flowNode.data.node) }}
          onNodeDoubleClick={(_, flowNode) => { if (flowNode.data.stage === undefined) onContinueNode?.(flowNode.data.node) }}
          onPaneClick={clearSelection}
          nodesDraggable
          nodesConnectable={false}
          elementsSelectable
          fitView
          minZoom={0.08}
          maxZoom={1.7}
          proOptions={{ hideAttribution: true }}
          aria-label={projection.nodes.length ? '可缩放、可拖动的研究画布' : '空白研究画布'}
        >
          {projection.nodes.length ? <Background variant={BackgroundVariant.Dots} gap={24} size={1} color={resolveCssColor('var(--qx-color-rule-strong)')} /> : null}
          {projection.nodes.length ? <Controls position="bottom-left" showInteractive={false} /> : null}
          {!hasDocumentNodes && projection.nodes.length >= 16 ? (
            <MiniMap
              position="bottom-left"
              pannable
              zoomable
              nodeColor={(node) => minimapColor((node.data as ArgumentNodeData).node.kind)}
              maskColor={resolveCssColor('color-mix(in srgb, var(--qx-color-canvas) 72%, transparent)')}
            />
          ) : null}
        </ReactFlow>
        </ExpandedNodeContentContext.Provider>
        )}
        {!projection.nodes.length ? <MapIdleNote actions={idleActions} /> : null}
        {projection.nodes.length && !focusedDocumentContent ? (
          <>
            {['thinking', 'retrieving', 'answering'].includes(projection.status) ? <div className="ep-map__layout-status" role="status">{projection.status === 'retrieving' ? 'Agent 正在查找依据…' : 'Agent 正在推进研究…'}{selectedNode ? ` · ${selectedNode.title}` : ''}</div> : null}


            {selectedNode && selectedNode.kind !== 'document' ? (
              <aside className="qx-card ep-map__inspector" aria-label="节点检查器">
                <header><span>{kindLabels[selectedNode.kind]}</span><button className="qx-btn qx-btn--ghost" type="button" aria-label="关闭节点检查器" onClick={clearSelection}><XIcon size={15} /></button></header>
                <div className={`ep-map__inspector-mark is-${selectedNode.kind}`}>{(() => { const Icon = kindIcons[selectedNode.kind]; return <Icon size={17} /> })()}</div>
                <h3 className="qx-card__title">{selectedNode.title}</h3>
                <p className="qx-card__body">{selectedNode.summary || '这个节点暂时没有补充说明。你可以让 Agent 继续拆解或补证。'}</p>
                <dl>
                  <div><dt>状态</dt><dd>{nodeStatusLabels[selectedNode.status]}</dd></div>
                  <div><dt>连接</dt><dd>{connectionCount(projection.edges, selectedNode.id)} 条关系</dd></div>
                  <div><dt>依据</dt><dd>{selectedNode.citationIds.length ? `${selectedNode.citationIds.length} 条` : '尚未绑定'}</dd></div>
                </dl>
                {selectedNode.citationIds.length ? (
                  <div className="ep-map__inspector-citations">
                    {selectedNode.citationIds.map((id, index) => <button className="qx-btn qx-btn--ghost" type="button" key={id} onClick={() => onOpenCitation?.(id)}>依据 {index + 1}<ArrowUpRightIcon size={12} /></button>)}
                  </div>
                ) : null}
                {conversation && onConversationChange && conversation.research_map?.nodes.some(node => node.id === selectedNode.id) ? <CanvasCardEditor key={`${conversation.conversation_id}:${selectedNode.id}`} draftCache={draftCache.current} conversation={conversation} node={conversation.research_map.nodes.find(node => node.id === selectedNode.id)!} onSaved={onConversationChange} /> : <p className="ep-map__formal-note">此卡来自正式研究记录，可与 Agent 讨论后在对应研究环节修改。</p>}
                <button type="button" className="qx-btn qx-btn--primary ep-map__inspector-primary" onClick={() => onContinueNode?.(selectedNode)}>让 Agent 继续推进<ArrowUpRightIcon size={14} /></button>
              </aside>
            ) : null}

            {listOpen ? (
              <aside className="ep-map__list qx-card" role="region" aria-label="研究节点目录">
                <div className="ep-map__list-header"><h3 className="qx-heading">结构目录 <span className="qx-meta">{projection.nodes.length}</span></h3><button className="qx-btn qx-btn--ghost" type="button" aria-label="关闭节点目录" onClick={() => setListOpen(false)}><XIcon size={15} /></button></div>
                <div className="ep-map__list-groups">
                  {(Object.keys(kindLabels) as ResearchCanvasNodeKind[]).map((kind) => counts[kind] ? (
                    <section key={kind}>
                      <h3>{kindLabels[kind]}<span>{counts[kind]}</span></h3>
                      {projection.nodes.filter((node) => node.kind === kind).map((node) => (
                        <button type="button" key={node.id} className={["qx-item", node.id === selectedNodeId ? 'is-selected' : ''].filter(Boolean).join(' ')} onClick={() => { selectNode(node); setListOpen(false); void flowRef.current?.fitView({ nodes: [{ id: node.id }], padding: .4, maxZoom: .95, duration: 250 }) }}><i className={`is-${kind}`} /><span>{node.title}</span></button>
                      ))}
                    </section>
                  ) : null)}
                </div>
              </aside>
            ) : null}
          </>
        ) : null}
      </div>

    </section>
  )
}

function ResearchCurve(props: EdgeProps) {
  const [hovered, setHovered] = useState(false)
  const data = props.data as { label: string; visible: boolean; lane: number; loop: boolean }
  let [path, x, y] = getBezierPath({ ...props, curvature: 0.4 })
  if (data.loop) {
    const right = props.sourceX + 90
    path = `M ${props.sourceX} ${props.sourceY} C ${right} ${props.sourceY}, ${right} ${props.targetY + 70}, ${props.targetX} ${props.targetY + 70} C ${props.targetX} ${props.targetY + 50}, ${props.targetX} ${props.targetY + 30}, ${props.targetX} ${props.targetY}`
    x = right; y = (props.sourceY + props.targetY) / 2
  } else if (Math.abs(props.sourceX - props.targetX) < 2 && props.sourcePosition !== props.targetPosition) {
    const direction = props.targetY > props.sourceY ? 1 : -1
    path = `M ${props.sourceX} ${props.sourceY} C ${props.sourceX + 26} ${props.sourceY + 20 * direction}, ${props.targetX + 26} ${props.targetY - 20 * direction}, ${props.targetX} ${props.targetY}`
    x = props.sourceX + 19; y = (props.sourceY + props.targetY) / 2
  } else if (Math.abs(props.sourceY - props.targetY) < 2) {
    const lift = data.loop ? 100 : 28 + data.lane * 12
    path = `M ${props.sourceX} ${props.sourceY} C ${props.sourceX + (props.targetX > props.sourceX ? 60 : -60)} ${props.sourceY - lift}, ${props.targetX + (props.targetX > props.sourceX ? -60 : 60)} ${props.targetY - lift}, ${props.targetX} ${props.targetY}`
    x = (props.sourceX + props.targetX) / 2; y = props.sourceY - lift * .75
  }
  return <g onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
    <BaseEdge {...props} path={path} />
    {(data.visible || hovered) && data.label ? <EdgeLabelRenderer><span className="ep-map__relation-label" style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}>{data.label}</span></EdgeLabelRenderer> : null}
  </g>
}
const edgeTypes = { researchCurve: ResearchCurve }

function filterProjection(
  projection: ResearchCanvasProjection,
  selectedNodeId: string | null,
  depth: FocusDepth,
): ResearchCanvasProjection {
  if (!selectedNodeId || depth === 'all') return projection
  const visible = new Set([selectedNodeId])
  let frontier = new Set([selectedNodeId])
  for (let step = 0; step < depth; step += 1) {
    const next = new Set<string>()
    for (const edge of projection.edges) {
      if (frontier.has(edge.source)) next.add(edge.target)
      if (frontier.has(edge.target)) next.add(edge.source)
    }
    for (const id of next) visible.add(id)
    frontier = next
  }
  return {
    ...projection,
    nodes: projection.nodes.filter((node) => visible.has(node.id)),
    edges: projection.edges.filter((edge) => visible.has(edge.source) && visible.has(edge.target)),
  }
}

function connectionCount(edges: ResearchCanvasEdge[], nodeId: string) {
  return edges.filter((edge) => edge.source === nodeId || edge.target === nodeId).length
}

// 关系与节点类别的颜色和 research-map-canvas.css 里卡片用的是同一组类别色 token。
// React Flow 把颜色写进 SVG 属性，属性不认 var()，所以要先解析成具体色值。
const relationToken: Record<string, string> = { supports: 'data-green', challenges: 'data-rust', derives: 'data-blue', refines: 'data-amber' }
const kindToken: Record<string, string> = {
  question: 'accent', phenomenon: 'data-amber', theory: 'data-blue', claim: 'data-green',
  evidence: 'data-olive', gap: 'data-rust', document: 'ink-soft',
}

function relationColor(relation: ResearchCanvasEdge['relation']) {
  return resolveCssColor(`var(--qx-color-${relationToken[relation] ?? 'faint'})`)
}

function minimapColor(kind: ResearchCanvasNodeKind) {
  return resolveCssColor(`var(--qx-color-${kindToken[kind] ?? 'data-violet'})`)
}
