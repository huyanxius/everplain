import { apiClient } from '../../api/client'
import { ApiRequestError } from '../../api/error'
import {
  cancelChannelLinkCodes, createChannelLinkCode, listChannelBindings,
  listChannelGateways, revokeChannelBinding,
} from '../../api/generated'

function data<T>(result: { data?: T; error?: unknown; response?: Response }): T {
  if (result.error || result.data === undefined) throw new ApiRequestError('聊天平台请求未完成。', result.response?.status)
  return result.data
}
function empty(result: { error?: unknown; response?: Response }) {
  if (result.error || !result.response?.ok) throw new ApiRequestError('聊天平台请求未完成。', result.response?.status)
}
export const channelGatewayApi = {
  async gateways(signal?: AbortSignal) { return data(await listChannelGateways({ client: apiClient, signal })) },
  async bindings(signal?: AbortSignal) { return data(await listChannelBindings({ client: apiClient, signal })) },
  async createCode(gatewayId: string, signal?: AbortSignal) {
    return data(await createChannelLinkCode({ client: apiClient, signal, body: { gateway_id: gatewayId, acknowledge_private_data_and_usage: true } }))
  },
  async cancelCode(gatewayId: string, signal?: AbortSignal) {
    empty(await cancelChannelLinkCodes({ client: apiClient, signal, query: { gateway_id: gatewayId } }))
  },
  async revoke(bindingId: string, signal?: AbortSignal) {
    empty(await revokeChannelBinding({ client: apiClient, signal, path: { binding_id: bindingId } }))
  },
}
export type ChannelGatewayApi = typeof channelGatewayApi
export type ChannelGateway = Awaited<ReturnType<ChannelGatewayApi['gateways']>>[number]
export type ChannelBinding = Awaited<ReturnType<ChannelGatewayApi['bindings']>>[number]
export type ChannelGrant = Awaited<ReturnType<ChannelGatewayApi['createCode']>>
export function isSessionFailure(error: unknown) { return error instanceof ApiRequestError && error.status === 401 }
