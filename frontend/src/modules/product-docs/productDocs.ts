import * as api from './productCatalogApi'

export function readPublicProductCatalog(signal?: AbortSignal) {
  return api.readPublicProductCatalog(signal)
}
export type PublicProductCatalog = Awaited<ReturnType<typeof readPublicProductCatalog>>

export function supportedPublicModels(models: PublicProductCatalog['agent_models']) {
  return api.supportedPublicModels(models)
}
