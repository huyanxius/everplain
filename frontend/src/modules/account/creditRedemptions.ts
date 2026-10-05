import { accountManagementApi } from './accountManagementApi'
import type { CreditRedemption, MutationIntent } from './accountManagementModels'

export async function redeemAccountCode(input: MutationIntent & { code: string }): Promise<CreditRedemption> {
  return accountManagementApi.redeemCredits(input)
}
