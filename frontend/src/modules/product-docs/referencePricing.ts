/** Public list prices only. This is not the provider procurement or billing ledger. */
export const REFERENCE_PRICING = {
  checkedOn: '2026-10-05',
  currency: 'USD',
  unitTokens: 1_000_000,
  referenceCnyPerUsd: 6.7351,
  referenceCnyPerPoint: 0.1,
  example: { inputTokens: 2_000, outputTokens: 1_000 },
  models: [
    {
      id: 'gpt-6-luna', name: 'GPT 6 Luna', input: 0.1, cachedInput: 0.01, output: 0.5,
      source: 'https://developers.openai.com/api/docs/models/gpt-6-luna',
      note: '缓存写入 $0.125 / 百万 tokens。输入超过 272K 时，整次请求输入及缓存费率 ×2、输出费率 ×1.5。',
    },
    {
      id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', input: 1.5, cachedInput: 0.15, output: 9,
      source: 'https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-flash',
      note: '文本、图像、视频输入档；输出包含 thinking tokens。缓存存储 $1 / 百万 tokens·小时；音频和工具另计。',
    },
    {
      id: 'deepseek-v4.1-flash-peak', name: 'DeepSeek V4.1 Flash · 高峰', input: 0.3, cachedInput: 0.006, output: 1.2,
      source: 'https://api-docs.deepseek.com/quick_start/pricing',
      note: '周一至周五北京时间 09:00–12:00、14:00–18:00 为高峰，中国法定节假日除外。',
    },
    {
      id: 'deepseek-v4.1-flash-offpeak', name: 'DeepSeek V4.1 Flash · 低谷', input: 0.15, cachedInput: 0.003, output: 0.6,
      source: 'https://api-docs.deepseek.com/quick_start/pricing',
      note: '其余时间、周末及中国法定节假日为低谷；按请求在服务端发出时所属时段计。',
    },
    {
      id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', input: 2, cachedInput: 0.2, output: 10,
      source: 'https://platform.claude.com/docs/en/about-claude/pricing',
      note: '5 分钟缓存写入 $2.50，1 小时缓存写入 $4 / 百万 tokens；工具等另计。',
    },
  ],
} as const

export type ReferenceModel = typeof REFERENCE_PRICING.models[number]
export type TokenEstimate = { calls: number; inputTokens: number; outputTokens: number; pointsPerCall: number }

/** Floor complete calls. Guard every input rather than displaying NaN or infinity. */
export function estimateReferenceUsage(
  price: { input: number; output: number },
  points: number,
  inputTokens: number = REFERENCE_PRICING.example.inputTokens,
  outputTokens: number = REFERENCE_PRICING.example.outputTokens,
): TokenEstimate | null {
  if (![points, price.input, price.output, inputTokens, outputTokens].every(Number.isFinite)
    || points < 0 || price.input < 0 || price.output < 0
    || !Number.isSafeInteger(inputTokens) || !Number.isSafeInteger(outputTokens)
    || inputTokens < 0 || outputTokens < 0) return null
  const costUsd = (inputTokens * price.input + outputTokens * price.output) / REFERENCE_PRICING.unitTokens
  const pointsPerCall = costUsd * REFERENCE_PRICING.referenceCnyPerUsd / REFERENCE_PRICING.referenceCnyPerPoint
  if (pointsPerCall <= 0 || !Number.isFinite(pointsPerCall)) return null
  const calls = Math.floor(points / pointsPerCall)
  if (![calls, calls * inputTokens, calls * outputTokens].every(Number.isSafeInteger)) return null
  return { calls, inputTokens: calls * inputTokens, outputTokens: calls * outputTokens, pointsPerCall }
}
