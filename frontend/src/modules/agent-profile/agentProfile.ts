import * as api from './agentProfileApi'

export const readAgentProfile = (...args: Parameters<typeof api.readAgentProfile>) => api.readAgentProfile(...args)
export const saveAgentProfile = (...args: Parameters<typeof api.saveAgentProfile>) => api.saveAgentProfile(...args)
export type PersonalAgentProfile = Awaited<ReturnType<typeof readAgentProfile>>
export type PersonalAgentProfileUpdate = Parameters<typeof saveAgentProfile>[0]
