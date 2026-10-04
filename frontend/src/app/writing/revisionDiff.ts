/** Code-point aware compact diff: exact text is retained, including Markdown and emoji. */
export function revisionDiff(before: string, after: string) {
  const a = Array.from(before), b = Array.from(after)
  let start = 0, end = 0
  while (start < Math.min(a.length, b.length) && a[start] === b[start]) start++
  while (end < a.length - start && end < b.length - start && a[a.length - end - 1] === b[b.length - end - 1]) end++
  return { prefix: a.slice(0, start).join(''), deleted: a.slice(start, a.length - end).join(''), inserted: b.slice(start, b.length - end).join(''), suffix: end ? a.slice(a.length - end).join('') : '' }
}
