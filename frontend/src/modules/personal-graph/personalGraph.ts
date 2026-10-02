import * as api from './personalGraphApi'
export const readPersonalGraph = (...args: Parameters<typeof api.readPersonalGraph>) => api.readPersonalGraph(...args)
export const rebuildPersonalGraph = (...args: Parameters<typeof api.rebuildPersonalGraph>) => api.rebuildPersonalGraph(...args)
export type PersonalGraph = Awaited<ReturnType<typeof readPersonalGraph>>
