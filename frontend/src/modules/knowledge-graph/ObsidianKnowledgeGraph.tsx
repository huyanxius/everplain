import { graphColor } from '../../styles/resolveCssColor'
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CornersOutIcon, ShuffleIcon } from '@phosphor-icons/react'

import './ObsidianKnowledgeGraph.css'
import type { KnowledgeGraphProjection } from './types'
import { layoutCacheKey, positionedElements, readLayout, saveLayout } from './graphLayoutCache'
import { layoutOptions, fitView } from './graphLayout'
import { useGraphFullscreen } from './useGraphFullscreen'

interface ObsidianKnowledgeGraphProps {
  readonly layoutScope?: string
  readonly projection: KnowledgeGraphProjection
  readonly focusNodeId?: string
  readonly onExpandNode?: (nodeId: string) => void
  readonly onSelectEdge?: (edgeId: string) => void
  readonly onSelectKnowledge: (knowledgeId: string) => void
  readonly variant?: 'workspace' | 'preview'
  readonly personal?: boolean
  readonly renderControls?: (controls: { zoomIn: () => void; zoomOut: () => void; fit: () => void; relayout: () => void; enterFullscreen: () => void }) => ReactNode
}

function graphElements(
  projection: KnowledgeGraphProjection,
  focusNodeId?: string,
): ElementDefinition[] {
  const neighborIds = new Set(
    projection.edges.flatMap((edge) => (
      edge.source === focusNodeId ? [edge.target]
        : edge.target === focusNodeId ? [edge.source]
          : []
    )),
  )

  return [
    ...projection.nodes.map((node) => {
      const nodeType = node.nodeType ?? 'entry'
      const classes = [
        `node--${nodeType}`,
        node.id === focusNodeId ? 'node--focus' : '',
        neighborIds.has(node.id) ? 'node--neighbor' : '',
        focusNodeId && node.id !== focusNodeId && !neighborIds.has(node.id)
          ? 'node--context'
          : '',
      ].filter(Boolean).join(' ')
      return {
        classes,
        data: {
          id: node.id,
          label: node.label,
          nodeType,
          level: node.level ?? 2,
          image: node.image ?? '',
          focus: node.id === focusNodeId,
        },
      }
    }),
    ...projection.edges.map((edge) => ({
      classes: [
        `edge--${edge.layer ?? 'reviewed'}`,
        edge.source === focusNodeId || edge.target === focusNodeId
          ? 'edge--neighbor'
          : 'edge--context',
        edge.direction === 'directed' || edge.direction === 'outbound'
          ? 'edge--directed'
          : '',
        edge.direction === 'bidirectional' ? 'edge--bidirectional' : '',
      ].filter(Boolean).join(' '),
      data: {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.layer === 'candidate'
          ? `候选 · ${edge.relationType}`
          : edge.relationType,
        layer: edge.layer ?? 'reviewed',
      },
    })),
  ]
}

function shuffled<T>(values: readonly T[]): T[] {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    const current = result[index]
    result[index] = result[swapIndex]
    result[swapIndex] = current
  }
  return result
}

function revealBatches(projection: KnowledgeGraphProjection): string[][] {
  if (projection.nodes.length === 0) return []

  const adjacency = new Map(
    projection.nodes.map((node) => [node.id, new Set<string>()]),
  )
  projection.edges.forEach((edge) => {
    adjacency.get(edge.source)?.add(edge.target)
    adjacency.get(edge.target)?.add(edge.source)
  })

  const root = [...projection.nodes].sort((left, right) => {
    const degreeDifference = (adjacency.get(right.id)?.size ?? 0)
      - (adjacency.get(left.id)?.size ?? 0)
    if (degreeDifference !== 0) return degreeDifference
    if (left.nodeType === right.nodeType) return 0
    return left.nodeType === 'dimension' ? -1 : 1
  })[0]
  const distance = new Map<string, number>([[root.id, 0]])
  const queue = [root.id]

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const nodeId = queue[cursor]
    const nextDistance = (distance.get(nodeId) ?? 0) + 1
    adjacency.get(nodeId)?.forEach((neighborId) => {
      if (distance.has(neighborId)) return
      distance.set(neighborId, nextDistance)
      queue.push(neighborId)
    })
  }

  const layers = new Map<number, string[]>()
  projection.nodes.forEach((node) => {
    const layer = distance.get(node.id) ?? Number.MAX_SAFE_INTEGER
    const layerNodes = layers.get(layer) ?? []
    layerNodes.push(node.id)
    layers.set(layer, layerNodes)
  })

  return [...layers.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([, nodeIds]) => {
      const orderedIds = shuffled(nodeIds)
      const batchSize = Math.max(1, Math.ceil(orderedIds.length / 3))
      const batches: string[][] = []
      for (let index = 0; index < orderedIds.length; index += batchSize) {
        batches.push(orderedIds.slice(index, index + batchSize))
      }
      return batches
    })
}

// 颜色在创建图谱时才解析：模块加载时全局样式还没注入，读不到 token。
const graphStyle = (): cytoscape.StylesheetJson => [
  {
    selector: 'node',
    style: {
      'background-color': graphColor('faint'),
      'border-color': graphColor('surface'),
      'border-width': 1.5,
      color: graphColor('ink-soft'),
      'font-size': 10,
      height: 10,
      label: 'data(label)',
      'min-zoomed-font-size': 8,
      opacity: 0.92,
      shape: 'ellipse',
      'text-background-color': graphColor('surface'),
      'text-background-opacity': 0,
      'text-background-padding': '2px',
      'text-background-shape': 'roundrectangle',
      'text-halign': 'center',
      'text-margin-y': -8,
      'text-outline-color': graphColor('surface'),
      'text-outline-opacity': 0.92,
      'text-outline-width': 2,
      'text-valign': 'top',
      'transition-duration': 420,
      'transition-property': 'background-color, border-color, height, opacity, text-opacity, width, underlay-opacity, underlay-padding',
      'transition-timing-function': 'ease-out-cubic',
      width: 10,
      'z-index': 2,
    },
  },
  {
    selector: 'node.node--dimension',
    style: {
      'background-color': graphColor('info'),
      'border-color': graphColor('rule'),
      'border-width': 2,
      color: graphColor('info'),
      'font-size': 10,
      'font-weight': 700,
      height: 16,
      'min-zoomed-font-size': 9,
      'text-margin-y': -10,
      width: 16,
      'z-index': 8,
    },
  },
  {
    selector: 'node.node--category',
    style: {
      'background-color': graphColor('faint'),
      height: 12,
      width: 12,
      'z-index': 5,
    },
  },
  {
    selector: 'node.node--neighbor',
    style: {
      'background-color': graphColor('info'),
      height: 11,
      opacity: 1,
      width: 11,
      'z-index': 7,
    },
  },
  {
    selector: 'node.node--focus',
    style: {
      'background-color': graphColor('info'),
      'border-color': graphColor('info', 45),
      'border-width': 3,
      color: graphColor('info'),
      'font-size': 11,
      'font-weight': 700,
      height: 16,
      'min-zoomed-font-size': 9,
      'text-margin-y': -11,
      'underlay-color': graphColor('info', 45),
      'underlay-opacity': 0.2,
      'underlay-padding': 5,
      'underlay-shape': 'ellipse',
      width: 16,
      'z-index': 12,
    },
  },
  {
    selector: 'node.node--unreviewed',
    style: { 'border-color': graphColor('warning') },
  },
  {
    selector: 'node.node--context',
    style: { opacity: 0.62 },
  },
  {
    selector: 'node.is-hovered, node:selected',
    style: {
      'background-color': graphColor('info'),
      'border-color': graphColor('info', 45),
      'border-width': 4,
      opacity: 1,
      'z-index': 14,
    },
  },
  {
    selector: 'node.is-dimmed',
    style: { opacity: 0.12 },
  },
  {
    selector: 'edge',
    style: {
      'curve-style': 'straight',
      'line-color': graphColor('rule-strong'),
      opacity: 0.72,
      'target-arrow-shape': 'none',
      'transition-duration': 480,
      'transition-property': 'line-color, opacity, width',
      'transition-timing-function': 'ease-out-cubic',
      width: 0.8,
      'z-index': 1,
    },
  },
  {
    selector: 'edge.edge--structure',
    style: {
      'line-color': graphColor('rule-strong'),
      opacity: 0.58,
      width: 0.7,
    },
  },
  {
    selector: 'edge.edge--reviewed',
    style: {
      'line-color': graphColor('info'),
      opacity: 0.9,
      'target-arrow-color': graphColor('info'),
      width: 1.8,
    },
  },
  {
    selector: 'edge.edge--candidate',
    style: {
      'line-color': graphColor('warning'),
      'line-style': 'dashed',
      opacity: 0.88,
      'target-arrow-color': graphColor('warning'),
      width: 1.6,
    },
  },
  {
    selector: 'edge.edge--directed',
    style: {
      'arrow-scale': 0.65,
      'target-arrow-shape': 'triangle',
    },
  },
  {
    selector: 'edge.edge--bidirectional',
    style: {
      'arrow-scale': 0.65,
      'source-arrow-color': graphColor('info'),
      'source-arrow-shape': 'triangle',
      'target-arrow-shape': 'triangle',
    },
  },
  {
    selector: 'edge.edge--context',
    style: { opacity: 0.42 },
  },
  {
    selector: 'edge.is-hovered, edge:selected',
    style: {
      color: graphColor('ink-soft'),
      'font-size': 9,
      label: 'data(label)',
      opacity: 1,
      'text-background-color': graphColor('surface'),
      'text-background-opacity': 0.92,
      'text-background-padding': '3px',
      width: 2.2,
      'z-index': 10,
    },
  },
  {
    selector: 'edge.is-dimmed',
    style: { opacity: 0.08 },
  },
]

const workspaceGraphStyle = (motion = 0): cytoscape.StylesheetJson => [
  ...graphStyle().map((rule) => {
    if (
      !('style' in rule)
      || (rule.selector !== 'node' && rule.selector !== 'edge')
    ) return rule
    return {
      ...rule,
      style: {
        ...rule.style,
        'transition-duration': motion,
      },
    }
  }),
  {
    selector: 'node',
    style: {
      'background-color': graphColor('faint'),
      'border-color': graphColor('surface'),
      color: graphColor('ink-soft'),
      'text-background-color': graphColor('surface'),
      'text-outline-color': graphColor('surface'),
      'font-family': '"Songti SC", "Noto Serif CJK SC", Georgia, serif',
      'min-zoomed-font-size': 0,
    },
  },
  {
    selector: 'node.node--dimension',
    style: {
      'background-color': graphColor('ink'),
      'border-color': graphColor('rule'),
      color: graphColor('ink'),
      height: 20,
      'text-margin-y': -12,
      width: 20,
    },
  },
  {
    selector: 'node.node--category',
    style: { 'background-color': graphColor('muted') },
  },
  {
    selector: 'node.node--neighbor',
    style: { 'background-color': graphColor('accent-hover') },
  },
  {
    selector: 'node.node--focus',
    style: {
      'background-color': graphColor('ink'),
      'border-color': graphColor('rule-strong'),
      color: graphColor('ink'),
      'underlay-color': graphColor('faint'),
    },
  },
  {
    selector: 'node.node--context',
    style: { opacity: 0.42, 'text-opacity': 0 },
  },
  {
    selector: 'node.is-hovered, node:selected',
    style: {
      'background-color': graphColor('ink'),
      'border-color': graphColor('rule-strong'),
      'text-opacity': 1,
    },
  },
  {
    selector: 'node.is-grabbed',
    style: { 'underlay-color': graphColor('faint'), 'underlay-opacity': 0.2, 'underlay-padding': 6, 'border-color': graphColor('rule-strong') },
  },
  {
    selector: 'node.is-entering',
    style: { opacity: 0, 'text-opacity': 0 },
  },
  {
    selector: 'edge.is-entering',
    style: { opacity: 0 },
  },
  {
    selector: 'edge.edge--reviewed',
    style: {
      'line-color': graphColor('muted'),
      'target-arrow-color': graphColor('muted'),
    },
  },
  {
    selector: 'edge.edge--bidirectional',
    style: { 'source-arrow-color': graphColor('muted') },
  },
]

const previewGraphStyle = (): cytoscape.StylesheetJson => [
  ...workspaceGraphStyle(),
  {
    selector: 'node',
    style: {
      'font-size': 11,
      height: 13,
      'min-zoomed-font-size': 7,
      'text-margin-y': -9,
      'transition-duration': 780,
      width: 13,
    },
  },
  {
    selector: 'edge',
    style: { 'transition-duration': 920 },
  },
  {
    selector: 'node.node--dimension',
    style: { 'font-size': 12, height: 22, width: 22 },
  },
  {
    selector: 'node.node--category',
    style: { height: 17, width: 17 },
  },
  {
    selector: 'edge.edge--structure',
    style: { opacity: 0.68, width: 1.05 },
  },
  {
    selector: 'node.node--neighbor',
    style: {
      height: 18,
      opacity: 1,
      width: 18,
    },
  },
  {
    selector: 'node.node--focus',
    style: {
      'border-width': 3.5,
      'font-size': 13,
      height: 26,
      'min-zoomed-font-size': 8,
      'text-background-opacity': 0.9,
      'text-margin-y': -15,
      'underlay-opacity': 0.28,
      'underlay-padding': 9,
      width: 26,
    },
  },
  {
    selector: 'node.node--context',
    style: { opacity: 0.3 },
  },
  {
    selector: 'edge.edge--neighbor',
    style: {
      'line-color': graphColor('warning'),
      opacity: 0.96,
      width: 2,
    },
  },
  {
    selector: 'edge.edge--context',
    style: { opacity: 0.2 },
  },
  {
    selector: 'node.is-awaiting-reveal',
    style: {
      height: 2,
      opacity: 0,
      'text-opacity': 0,
      width: 2,
    },
  },
  {
    selector: 'edge.is-awaiting-reveal',
    style: { opacity: 0, width: 0.1 },
  },
]

export function ObsidianKnowledgeGraph({
  projection,
  layoutScope = '',
  focusNodeId,
  onExpandNode,
  onSelectEdge,
  onSelectKnowledge,
  variant = 'workspace',
  personal = false,
  renderControls,
}: ObsidianKnowledgeGraphProps) {
  const { fullscreenRef, isFullscreen, mode, notice, enterFullscreen, exitFullscreen } = useGraphFullscreen<HTMLElement>()
  const canvasRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<Core | undefined>(undefined)
  const focusNodeIdRef = useRef(focusNodeId)
  focusNodeIdRef.current = focusNodeId
  const onExpandNodeRef = useRef(onExpandNode)
  const onSelectEdgeRef = useRef(onSelectEdge)
  const onSelectKnowledgeRef = useRef(onSelectKnowledge)
  onExpandNodeRef.current = onExpandNode
  onSelectEdgeRef.current = onSelectEdge
  onSelectKnowledgeRef.current = onSelectKnowledge
  const [unavailable, setUnavailable] = useState(false)
  const [hoveredLabel, setHoveredLabel] = useState('')
  const [tourLabel, setTourLabel] = useState('')
  const [activationPoint, setActivationPoint] = useState<{
    key: number
    x: number
    y: number
  }>()
  const activationTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Workspace selection updates classes in place; only previews embed focus at creation.
  const initialFocus = !personal && variant === 'preview' ? focusNodeId : undefined
  const elements = useMemo(
    () => graphElements(projection, initialFocus),
    [projection, initialFocus],
  )
  const cacheKey = useMemo(() => layoutCacheKey(projection, `${layoutScope}:${personal ? 'personal' : variant}`), [projection, layoutScope, personal, variant])
  const hasEdges = projection.edges.length > 0
  const reduceMotion = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const animateLayout = variant === 'preview' && !reduceMotion
  const layoutDuration = variant === 'preview' ? 1900 : 560

  useEffect(() => () => {
    if (activationTimerRef.current) clearTimeout(activationTimerRef.current)
  }, [])

  const motionDuration = useCallback(() => {
    if (reduceMotion || !canvasRef.current) return 0
    const token = getComputedStyle(canvasRef.current).getPropertyValue('--qx-motion-base').trim()
    const value = Number.parseFloat(token) * (token.endsWith('ms') ? 1 : 1000)
    return Number.isFinite(value) ? value : 240
  }, [reduceMotion])

  const fit = useCallback(() => {
    if (graphRef.current) fitView(graphRef.current, focusNodeId, variant === 'preview', personal ? motionDuration() : 0)
  }, [focusNodeId, variant, personal, motionDuration])

  const relayout = useCallback(() => {
    const graph = graphRef.current
    if (!graph) return
    graph.one('layoutstop', () => { saveLayout(cacheKey, graph); fitView(graph, focusNodeId, variant === 'preview') })
    graph.layout(layoutOptions(
      Boolean(focusNodeId),
      hasEdges,
      !reduceMotion,
      layoutDuration,
      personal,
    )).run()
  }, [focusNodeId, hasEdges, layoutDuration, reduceMotion, variant, personal, cacheKey])

  useEffect(() => {
    if (!canvasRef.current || elements.length === 0) return
    const canvas = canvasRef.current
    const motionToken = getComputedStyle(canvas).getPropertyValue('--qx-motion-base').trim()
    const motionMs = Number.parseFloat(motionToken) * (motionToken.endsWith('ms') ? 1 : 1000)
    const motion = reduceMotion ? 0 : (Number.isFinite(motionMs) ? motionMs : 240)
    setUnavailable(false)
    setTourLabel('')
    let graph: Core | undefined
    let resizeObserver: ResizeObserver | undefined
    let visibilityObserver: IntersectionObserver | undefined
    let frame = 0
    let tourInterval: ReturnType<typeof setInterval> | undefined
    let tourStartTimer: ReturnType<typeof setTimeout> | undefined
    let entryTimer: ReturnType<typeof setTimeout> | undefined
    const revealTimers: Array<ReturnType<typeof setTimeout>> = []
    let revealStarted = false
    let revealComplete = variant !== 'preview' || reduceMotion
    let pointerInside = false
    let dragging = false
    let inViewport = variant !== 'preview'
    let documentVisible = typeof document === 'undefined'
      || document.visibilityState !== 'hidden'
    let previousTourNodeId = ''
    let tourQueue: string[] = []

    const clearTourSchedule = () => {
      if (tourInterval) clearInterval(tourInterval)
      if (tourStartTimer) clearTimeout(tourStartTimer)
      tourInterval = undefined
      tourStartTimer = undefined
    }

    const canTour = () => (
      variant === 'preview'
      && !reduceMotion
      && !focusNodeIdRef.current
      && revealComplete
      && inViewport
      && documentVisible
      && !pointerInside
      && Boolean(graph)
    )

    const refillTourQueue = () => {
      if (!graph) return
      const candidates = graph.nodes()
        .filter((node) => node.data('nodeType') === 'entry' && node.degree(false) > 0)
        .map((node) => node.id())
      tourQueue = shuffled(candidates)
      if (
        tourQueue.length > 1
        && tourQueue[0] === previousTourNodeId
      ) {
        const first = tourQueue.shift()
        if (first) tourQueue.push(first)
      }
    }

    const focusTourNode = (nodeId: string) => {
      if (!graph) return
      const selectedNode = graph.getElementById(nodeId)
      if (selectedNode.empty()) return
      const neighborIds = new Set(
        selectedNode.neighborhood('node').map((node) => node.id()),
      )

      graph.batch(() => {
        graph?.nodes().forEach((node) => {
          node.removeClass('node--focus node--neighbor node--context')
          if (node.id() === nodeId) node.addClass('node--focus')
          else if (neighborIds.has(node.id())) node.addClass('node--neighbor')
          else node.addClass('node--context')
        })
        graph?.edges().forEach((edge) => {
          edge.removeClass('edge--neighbor edge--context')
          if (edge.source().id() === nodeId || edge.target().id() === nodeId) {
            edge.addClass('edge--neighbor')
          } else {
            edge.addClass('edge--context')
          }
        })
      })
      previousTourNodeId = nodeId
      setTourLabel(selectedNode.data('label') ?? '')
    }

    const advanceTour = () => {
      if (!canTour()) return
      if (tourQueue.length === 0) refillTourQueue()
      const nextNodeId = tourQueue.shift()
      if (nextNodeId) focusTourNode(nextNodeId)
    }

    const scheduleTour = (delay = 720) => {
      clearTourSchedule()
      if (!canTour()) return
      tourStartTimer = setTimeout(() => {
        if (!canTour()) return
        advanceTour()
        tourInterval = setInterval(advanceTour, 4800)
      }, delay)
    }

    const revealPreview = () => {
      if (!graph || revealStarted || variant !== 'preview') return
      revealStarted = true
      if (reduceMotion) {
        graph.elements().removeClass('is-awaiting-reveal')
        revealComplete = true
        return
      }

      const batches = revealBatches(projection)
      batches.forEach((nodeIds, index) => {
        const timer = setTimeout(() => {
          if (!graph) return
          graph.batch(() => {
            nodeIds.forEach((nodeId) => {
              graph?.getElementById(nodeId).removeClass('is-awaiting-reveal')
            })
            graph.edges().forEach((edge) => {
              if (
                !edge.source().hasClass('is-awaiting-reveal')
                && !edge.target().hasClass('is-awaiting-reveal')
              ) {
                edge.removeClass('is-awaiting-reveal')
              }
            })
          })
        }, 280 + index * 180)
        revealTimers.push(timer)
      })

      const completionTimer = setTimeout(() => {
        graph?.elements().removeClass('is-awaiting-reveal')
        revealComplete = true
        scheduleTour(1500)
      }, 520 + batches.length * 180)
      revealTimers.push(completionTimer)
    }

    const pauseForPointer = () => {
      pointerInside = true
      clearTourSchedule()
    }

    const resumeAfterPointer = () => {
      pointerInside = false
      setHoveredLabel('')
      scheduleTour(1500)
    }

    const handleVisibilityChange = () => {
      documentVisible = document.visibilityState !== 'hidden'
      if (documentVisible) {
        graph?.resize()
        if (graph) fitView(graph, focusNodeIdRef.current, variant === 'preview')
        scheduleTour(1000)
      }
      else clearTourSchedule()
    }

    try {
      const saved = variant === 'workspace' ? readLayout(cacheKey, projection.nodes.map(n => n.id)) : undefined
      graph = cytoscape({
        autoungrabify: false,
        boxSelectionEnabled: false,
        container: canvas,
        elements: positionedElements(elements, saved),
        layout: { name: 'preset', fit: false, animate: false },
        maxZoom: 3.2,
        minZoom: 0.01,
        style: personal ? [...workspaceGraphStyle(motion),
          { selector: 'node.node--self', style: { width: 70, height: 70, 'background-opacity': 0, 'border-width': 0, 'background-image': 'data(image)', 'background-fit': 'contain', 'text-margin-y': -5 } },
          { selector: 'node.node--topic', style: { width: 18, height: 18, 'background-color': graphColor('faint'), 'font-size': 12 } },
          { selector: 'node.node--knowledge', style: { width: 6, height: 6, 'background-color': graphColor('faint'), 'font-size': 9 } },
        ] : variant === 'preview' ? previewGraphStyle() : workspaceGraphStyle(),
        userPanningEnabled: true,
        userZoomingEnabled: variant === 'workspace',
      })
      graphRef.current = graph
      const activeGraph = graph
      // Register before run: non-animated layouts emit layoutstop synchronously.
      activeGraph.one('layoutstop', () => {
        if (variant === 'workspace') saveLayout(cacheKey, activeGraph)
        fitView(activeGraph, focusNodeIdRef.current, variant === 'preview')
      })
      activeGraph.on('dragfree', 'node', () => saveLayout(cacheKey, activeGraph))
      if (!saved) activeGraph.layout(layoutOptions(Boolean(focusNodeIdRef.current), hasEdges, animateLayout, layoutDuration, personal)).run()
      else fitView(activeGraph, focusNodeIdRef.current, variant === 'preview')
      if (variant === 'preview') {
        if (!reduceMotion) graph.elements().addClass?.('is-awaiting-reveal')
        graph.one('layoutstop', () => fitView(graph!, focusNodeIdRef.current, true))
      } else if (!reduceMotion) {
        graph.elements().addClass?.('is-entering')
        entryTimer = setTimeout(() => {
          graph?.elements().removeClass('is-entering')
        }, 80)
      }
      graph.on('tap', 'node', (event) => {
        const nodeType = event.target.data('nodeType') ?? 'entry'
        const nodeId = event.target.id()
        if (!reduceMotion) {
          const point = event.target.renderedPosition?.()
          if (point) {
            setActivationPoint({ key: Date.now(), x: point.x, y: point.y })
            if (activationTimerRef.current) clearTimeout(activationTimerRef.current)
            activationTimerRef.current = setTimeout(() => {
              setActivationPoint(undefined)
            }, 520)
          }
        }
        if (nodeType === 'entry' || nodeType === 'document' || nodeType === 'knowledge') onSelectKnowledgeRef.current(nodeId)
        else onExpandNodeRef.current?.(nodeId)
      })
      graph.on('tap', 'edge', (event) => {
        event.target.select()
        onSelectEdgeRef.current?.(event.target.id())
      })
      graph.on('grab', 'node', (event) => {
        dragging = true
        activeGraph.stop()
        canvas.style.cursor = 'grabbing'
        event.target.addClass('is-grabbed')
      })
      graph.on('free', 'node', (event) => {
        dragging = false
        canvas.style.cursor = 'pointer'
        event.target.removeClass('is-grabbed')
      })
      graph.on('mouseover', 'node', (event) => {
        if (dragging) return
        const neighborhood = event.target.closedNeighborhood()
        canvas.style.cursor = 'pointer'
        activeGraph.batch(() => {
          activeGraph.elements().addClass('is-dimmed')
          neighborhood.removeClass('is-dimmed').addClass('is-hovered')
        })
        setHoveredLabel(event.target.data('label') ?? '')
      })
      graph.on('mouseout', 'node', () => {
        if (dragging) return
        canvas.style.cursor = ''
        graph?.elements().removeClass('is-dimmed is-hovered')
        setHoveredLabel('')
      })
      graph.on('mouseover', 'edge', (event) => event.target.addClass('is-hovered'))
      graph.on('mouseout', 'edge', (event) => event.target.removeClass('is-hovered'))
      canvas.addEventListener('pointerenter', pauseForPointer)
      canvas.addEventListener('pointerleave', resumeAfterPointer)
      document.addEventListener('visibilitychange', handleVisibilityChange)
      frame = globalThis.requestAnimationFrame?.(() => {
        if (graph) fitView(graph, focusNodeIdRef.current, variant === 'preview')
      }) ?? 0
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => {
          if (!graph || canvas.clientWidth <= 0 || canvas.clientHeight <= 0) return
          graph.resize()
          fitView(graph, focusNodeIdRef.current, variant === 'preview')
        })
        resizeObserver.observe(canvas)
      }
      if (variant === 'preview' && typeof IntersectionObserver !== 'undefined') {
        visibilityObserver = new IntersectionObserver(([entry]) => {
          inViewport = entry?.isIntersecting ?? false
          if (inViewport) {
            revealPreview()
            scheduleTour(1200)
          } else {
            clearTourSchedule()
          }
        }, { threshold: 0.28 })
        visibilityObserver.observe(canvas)
      } else if (variant === 'preview') {
        inViewport = true
        revealPreview()
      }
    } catch {
      setUnavailable(true)
    }

    return () => {
      if (frame) globalThis.cancelAnimationFrame?.(frame)
      clearTourSchedule()
      if (entryTimer) clearTimeout(entryTimer)
      revealTimers.forEach((timer) => clearTimeout(timer))
      resizeObserver?.disconnect()
      visibilityObserver?.disconnect()
      canvas.removeEventListener('pointerenter', pauseForPointer)
      canvas.removeEventListener('pointerleave', resumeAfterPointer)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      graphRef.current = undefined
      graph?.destroy()
    }
  }, [
    animateLayout,
    cacheKey,
    personal,
    elements,
    hasEdges,
    layoutDuration,
    projection,
    reduceMotion,
    variant,
  ])

  useEffect(() => {
    const graph = graphRef.current
    if (!graph || variant === 'preview') return
    const nodeClasses = graphElements(projection, focusNodeId)
    graph.batch(() => {
      if (!personal) {
        // The previous single-library rebuild cleared native node selection.
        graph.nodes().unselect()
        // Keep an edge selected when its details replace the node focus.
        if (focusNodeId) graph.edges().unselect()
      }
      for (const element of nodeClasses) {
        const target = graph.getElementById(String(element.data.id))
        target.removeClass('node--focus node--neighbor node--context edge--neighbor edge--context')
        target.addClass(element.classes as string)
      }
    })
    fitView(graph, focusNodeId, false, personal ? motionDuration() : 0)
  }, [focusNodeId, projection, variant, personal, motionDuration, cacheKey])

  const zoomBy = (factor: number) => {
    const graph = graphRef.current
    if (!graph) return
    const level = Math.min(graph.maxZoom(), Math.max(graph.minZoom(), graph.zoom() * factor))
    const center = { x: graph.width() / 2, y: graph.height() / 2 }
    if (reduceMotion || !personal) {
      graph.zoom({ level, renderedPosition: center })
      return
    }
    const ratio = level / graph.zoom()
    const pan = graph.pan()
    const duration = motionDuration()
    graph.stop().animate({ zoom: level, pan: { x: center.x - (center.x - pan.x) * ratio, y: center.y - (center.y - pan.y) * ratio } }, { duration: Number.isFinite(duration) ? duration : 240, easing: 'ease-out-cubic', queue: false })
  }
  const visibleLabel = hoveredLabel || tourLabel

  return (
    <section ref={fullscreenRef} className={`obsidian-knowledge-graph obsidian-knowledge-graph--${variant}${isFullscreen ? ' obsidian-knowledge-graph--fullscreen' : ''}`} data-fullscreen-mode={mode} aria-label="节点式知识图谱">
      {isFullscreen && <button className="qx-btn qx-btn--secondary obsidian-knowledge-graph__fullscreen-exit" type="button" data-graph-fullscreen-exit aria-label="退出全屏" title={notice || "退出全屏"} onClick={() => void exitFullscreen()}>退出全屏</button>}
      {notice && <p className="obsidian-knowledge-graph__fullscreen-notice" role="status">{notice}</p>}
      {!isFullscreen && (renderControls ? renderControls({ zoomIn: () => zoomBy(1.2), zoomOut: () => zoomBy(1 / 1.2), fit, relayout, enterFullscreen: () => void enterFullscreen() }) : <div className="obsidian-knowledge-graph__controls">
        <span>{projection.nodes.length} 节点 · {projection.edges.length} 关系</span>
        {variant === 'workspace' ? (
          <div>
            <button className="qx-btn qx-btn--ghost" type="button" data-graph-fullscreen-enter aria-label="全屏" title="全屏" onClick={() => void enterFullscreen()}>
              <CornersOutIcon size={15} aria-hidden="true" />
            </button>
            <button className="qx-btn qx-btn--ghost" type="button" aria-label="重新布局" title="重新布局" onClick={relayout}>
              <ShuffleIcon size={15} aria-hidden="true" />
            </button>
          </div>
        ) : (
          <span className="obsidian-knowledge-graph__tour-status">
            <i aria-hidden="true" />
            {reduceMotion ? '拖动节点探索' : '自动巡游 · 移入接管'}
          </span>
        )}
      </div>)}
      {!isFullscreen && visibleLabel ? (
        <p className="obsidian-knowledge-graph__hover">
          <span>{hoveredLabel ? '当前节点' : '正在巡游'}</span>
          {visibleLabel}
        </p>
      ) : null}
      {!isFullscreen && variant === 'workspace' && activationPoint ? (
        <i
          key={activationPoint.key}
          className="obsidian-knowledge-graph__activation"
          style={{ left: activationPoint.x, top: activationPoint.y }}
          aria-hidden="true"
        />
      ) : null}
      {unavailable ? (
        <p className="obsidian-knowledge-graph__notice" role="alert">
          {variant === 'preview'
            ? '节点画布暂时不可用，可以进入完整图谱继续浏览。'
            : '节点画布暂时不可用；右侧搜索、详情与证据仍可继续使用。'}
        </p>
      ) : null}
      {!isFullscreen && variant === 'preview' && !focusNodeId && !hasEdges ? (
        <p className="obsidian-knowledge-graph__notice" role="status">
          七维入口已就绪。搜索条目，或选择维度节点开始探索。
        </p>
      ) : null}
      {!isFullscreen && variant === 'workspace' && !personal && !focusNodeId && !hasEdges ? (
        <div className="obsidian-knowledge-graph__start" role="status">
          <strong>选择一个维度开始</strong>
          <span>或在右侧搜索具体概念</span>
        </div>
      ) : null}
      <div
        ref={canvasRef}
        className="obsidian-knowledge-graph__canvas"
        role="img"
        aria-label={variant === 'preview' ? '节点式知识图谱画布' : 'Obsidian 式节点知识图谱'}
        hidden={unavailable}
      />
    </section>
  )
}
