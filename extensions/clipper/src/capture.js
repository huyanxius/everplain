import Defuddle from 'defuddle'
const result = new Defuddle(document).parse()
globalThis.__everplainCapture = { title: result.title || document.title, html: result.content, url: location.href }
