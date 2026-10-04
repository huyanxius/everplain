export function splitMarkdown(markdown: string) {
  const match = /^(---\r?\n[\s\S]*?\r?\n---(?:\r?\n(?:\r?\n)?)?)/.exec(markdown)
  const frontmatter = match?.[0] ?? ''
  return {
    frontmatter,
    body: markdown.slice(frontmatter.length),
    properties: frontmatter ? frontmatter.split(/\r?\n/).slice(1, -1).filter(line => /^[\w-]+:/.test(line)).map(line => ({ key: line.slice(0, line.indexOf(':')), value: line.slice(line.indexOf(':') + 1).trim() })) : [],
  }
}
export function joinMarkdown(frontmatter: string, body: string) { return frontmatter + body }
/** Complex YAML must remain in source mode; a scalar table must never flatten it. */
export function canEditProperties(frontmatter: string) {
  return !frontmatter || frontmatter.trim().split(/\r?\n/).slice(1, -1).every(line => /^[\w-]+:\s*\S[^\r\n]*$/.test(line))
}
