import { accountManagementApi } from './accountManagementApi'
import type { AccountProfile } from './accountManagementModels'

/** 应用导航所需的当前账户资料，权限校验保留在服务端。 */
export async function readAccountProfile(): Promise<AccountProfile> {
  return accountManagementApi.getAccount()
}
