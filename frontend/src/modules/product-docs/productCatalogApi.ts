import { apiClient } from '../../api/client'
import { getPublicProductCatalog, type AgentModelChoiceResponse, type MembershipCatalogResponse } from '../../api/generated'

type PublicProductCatalog = MembershipCatalogResponse
type ReasoningEffort = AgentModelChoiceResponse['reasoning_efforts'][number]
const knownEfforts: readonly string[] = ['none', 'enabled', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const isEffort = (value: string): value is ReasoningEffort => knownEfforts.includes(value)

/** A newer server's control options must not make the rest of the docs disappear. */
export function supportedPublicModels(models: PublicProductCatalog['agent_models']): AgentModelChoiceResponse[] {
  const result: AgentModelChoiceResponse[] = []
  const ids = new Set<string>()
  for (const model of models) {
    if (!model.model_id || !model.label || ids.has(model.model_id)
      || !model.reasoning_efforts.every(isEffort)
      || new Set(model.reasoning_efforts).size !== model.reasoning_efforts.length) continue
    let defaultEffort: ReasoningEffort | null = null
    if (model.default_reasoning_effort !== null) {
      if (!isEffort(model.default_reasoning_effort) || !model.reasoning_efforts.includes(model.default_reasoning_effort)) continue
      defaultEffort = model.default_reasoning_effort
    } else if (model.reasoning_efforts.length !== 0) continue
    ids.add(model.model_id)
    result.push({ ...model, reasoning_efforts: model.reasoning_efforts, default_reasoning_effort: defaultEffort })
  }
  return result
}

/** Public read only: no account mutation, model request or checkout. */
export async function readPublicProductCatalog(signal?: AbortSignal): Promise<PublicProductCatalog> {
  const result = await getPublicProductCatalog({ client: apiClient, signal })
  if (!result.data || result.error) throw new Error('暂时无法读取模型与订阅目录。')
  return result.data
}
