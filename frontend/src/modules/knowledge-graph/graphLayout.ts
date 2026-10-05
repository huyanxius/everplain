import type { Core } from 'cytoscape'

export function layoutOptions(
  hasFocus: boolean,
  hasEdges: boolean,
  animate = false,
  animationDuration = 560,
  _personal = false,
) {
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
    randomize: false,
  }
}

export function fitView(graph: Core, focusNodeId?: string, preview = false, duration = 0) {
  const applyViewport = (viewport: { zoom: number; pan: { x: number; y: number } }) => {
    if (duration > 0) graph.stop().animate(viewport, { duration, easing: 'ease-out-cubic', queue: false })
    else graph.viewport(viewport)
  }
  if (!focusNodeId) {
    const container = graph.container?.()
    const nodes = graph.nodes?.()
    const bounds = nodes?.boundingBox?.({ includeLabels: false })
    if (!bounds) return
    if (!container || container.clientWidth <= 0 || container.clientHeight <= 0 || bounds.w <= 0 || bounds.h <= 0) return
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
    applyViewport({
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
    Math.min(
      graph.maxZoom(),
      (container.clientWidth - padding * 2) / (halfWidth * 2),
      (container.clientHeight - padding * 2) / (halfHeight * 2),
    ),
  )
  applyViewport({
    zoom,
    pan: {
      x: container.clientWidth / 2 - position.x * zoom,
      y: container.clientHeight / 2 - position.y * zoom,
    },
  })
}

