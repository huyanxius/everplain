/*
 * 把 CSS 颜色表达式（通常是 `var(--qx-color-*)` 或基于它的 color-mix）解析成具体色值。
 *
 * 给不认 CSS 变量的地方用：cytoscape 的 canvas 样式、React Flow 写进 SVG 属性的 fill/stroke。
 * 能写进 CSS 或 style 属性的地方直接写 var()，不要绕这一层。
 *
 * scheme 决定 light-dark() 取哪一边。cytoscape 图谱固定传 'light'：深色模式下 system-theme.css
 * 会给整张画布加反色滤镜，这里再给深色值就被反转两次了。React Flow 不传，跟随当前外观。
 *
 * 解析失败（测试环境的 jsdom 不算 light-dark）时返回 fallback，默认是中性灰关键字。
 */
export function resolveCssColor(expression: string, scheme?: 'light' | 'dark', fallback = 'gray'): string {
  if (typeof document === 'undefined' || !document.body) return fallback
  const probe = document.createElement('i')
  probe.style.position = 'absolute'
  probe.style.visibility = 'hidden'
  if (scheme) probe.style.colorScheme = scheme
  probe.style.color = expression
  document.body.append(probe)
  const resolved = getComputedStyle(probe).color
  probe.remove()
  return resolved && !resolved.includes('var(') && !resolved.includes('light-dark') ? resolved : fallback
}

/** cytoscape 专用：一律取浅色值，见上面关于反色滤镜的说明。 */
export function graphColor(token: string, percent?: number): string {
  const ref = `var(--qx-color-${token})`
  return resolveCssColor(percent === undefined ? ref : `color-mix(in srgb, ${ref} ${percent}%, transparent)`, 'light')
}
