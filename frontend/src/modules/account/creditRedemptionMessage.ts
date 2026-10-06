import type { CreditRedemption } from './accountManagementModels'

export function creditRedemptionMessage(redemption: CreditRedemption, locale = 'zh-CN') {
  const english = locale === 'en-US'
  const format = (value: string | null | undefined) => value
    ? new Date(value).toLocaleString(locale, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : (english ? 'Pending confirmation' : '待确认')
  if (redemption.action !== 'membership') {
    const expiry = redemption.quotaPeriodExpiresAt
      ? (english ? ` Allowance expiry recorded for this code: ${format(redemption.quotaPeriodExpiresAt)}.` : `该兑换记录的额度截止时间：${format(redemption.quotaPeriodExpiresAt)}。`)
      : ''
    // A replay returns the current balance with the original receipt's deadline.
    return (english ? `Code redemption confirmed. Current balance: ${redemption.balance} points.` : `兑换已确认。当前余额：${redemption.balance} 积分。`) + expiry
  }
  const name = ({ plus: 'Plus', pro: 'PRO', max: 'Max' } as Record<string, string>)[redemption.planId ?? ''] ?? redemption.planId ?? ''
  const scheduled = Boolean(redemption.membershipStartsAt && Date.parse(redemption.membershipStartsAt) > Date.now())
  const dates = english
    ? `Starts ${format(redemption.membershipStartsAt)}; expires ${format(redemption.membershipExpiresAt)}.`
    : `生效时间：${format(redemption.membershipStartsAt)}；到期时间：${format(redemption.membershipExpiresAt)}。`
  if (english) return `Code redeemed. ${name} membership ${scheduled ? 'is scheduled after your current membership, with your current allowance unchanged' : 'is active'}. ${dates}`
  return `兑换成功。${name} 会员${scheduled ? '已安排在当前会员到期后生效，当前额度保持不变' : '已生效'}。${dates}`
}
