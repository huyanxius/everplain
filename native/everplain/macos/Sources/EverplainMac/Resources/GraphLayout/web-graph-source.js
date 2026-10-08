// Extracted from the authoritative Web ObsidianKnowledgeGraph.tsx. Type annotations only removed.
function graphElements(
  projection,
  focusNodeId,
) {
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
function layoutOptions(
  hasFocus,
  hasEdges,
  animate = false,
  animationDuration = 560,
  personal = false,
) {
  if (personal) return { name: 'concentric', animate: false, fit: true, padding: 80,
    minNodeSpacing: 38, avoidOverlap: true, equidistant: true,
    concentric: (node) => 4 - (node.data('level') ?? 2),
    levelWidth: () => 1,
  }
  if (!hasFocus && !hasEdges) {
    return {
      name: 'circle',
      animate,
      animationDuration: animate ? animationDuration : 1200,
      animationEasing: 'ease-out-cubic',
      fit: true,
      padding: 96,
      spacingFactor: 1.35,
    }
  }
  return {
    name: 'cose',
    animate: animate ? 'end' : false,
    animationDuration: animate ? animationDuration : 1200,
    animationEasing: 'ease-out-cubic',
    componentSpacing: 56,
    edgeElasticity: 120,
    fit: true,
    gravity: 0.34,
    idealEdgeLength: 54,
    nestingFactor: 1.15,
    nodeOverlap: 14,
    nodeRepulsion: 90000,
    numIter: 800,
    padding: 72,
    randomize: true,
  }
}
function fitView(graph, focusNodeId, preview = false) {
  if (!focusNodeId) {
    const container = graph.container?.()
    const nodes = graph.nodes?.()
    const bounds = nodes?.boundingBox?.({ includeLabels: false })
    if (!bounds) return
    if (!container || bounds.w <= 0 || bounds.h <= 0) return
    const padding = preview
      ? 34
      : Math.min(container.clientWidth, container.clientHeight) * 0.22
    const zoom = Math.max(
      graph.minZoom(),
      Math.min(
        graph.maxZoom(),
        (container.clientWidth - padding * 2) / bounds.w,
        (container.clientHeight - padding * 2) / bounds.h,
      ) * (preview ? 0.9 : 1),
    )
    graph.viewport({
      zoom,
      pan: {
        x: container.clientWidth / 2 - (bounds.x1 + bounds.w / 2) * zoom,
        y: container.clientHeight / 2 - (bounds.y1 + bounds.h / 2) * zoom,
      },
    })
    return
  }
  const focus = graph.getElementById(focusNodeId)
  const container = graph.container()
  if (focus.empty() || !container) {
    graph.fit(graph.elements(), 72)
    return
  }
  const bounds = graph.elements().boundingBox({ includeLabels: false })
  const position = focus.position()
  const padding = 72
  const halfWidth = Math.max(position.x - bounds.x1, bounds.x2 - position.x, 1)
  const halfHeight = Math.max(position.y - bounds.y1, bounds.y2 - position.y, 1)
  const zoom = Math.max(
    graph.minZoom(),
    0.8,
    Math.min(
      graph.maxZoom(),
      (container.clientWidth - padding * 2) / (halfWidth * 2),
      (container.clientHeight - padding * 2) / (halfHeight * 2),
    ),
  )
  graph.viewport({
    zoom,
    pan: {
      x: container.clientWidth / 2 - position.x * zoom,
      y: container.clientHeight / 2 - position.y * zoom,
    },
  })
}
const graphStyle = () => [
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
      'transition-property': 'background-color, border-color, height, opacity, text-opacity, width',
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

const workspaceGraphStyle = () => [
  ...graphStyle().map((rule) => {
    if (
      !('style' in rule)
      || (rule.selector !== 'node' && rule.selector !== 'edge')
    ) return rule
    return {
      ...rule,
      style: {
        ...rule.style,
        'transition-duration': 0,
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
