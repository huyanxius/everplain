# 个人 7 天额度与 bank RESET

Free 满额为 30。付费套餐使用 EVERPLAIN_BILLING_PLAN_WEEKLY_POINTS 的显式 JSON 映射（键为 subscriptions.plan_id，值为正整数积分）；未配置的付费套餐不能重置或发放额度，不回退为 10,000。管理员豁免保留。

用户首次有效消息操作开启个人 168 小时周期；注册和首次 GET 不开启。GET 可将已有到期周期按原始 168 小时锚点续期，下一次操作也会续期。首次启用把既有余额和精度封存至 legacy epoch 0，新周期恢复当前套餐满额。只追加余额净差收据，不回写或追扣历史请求。

bank RESET 码一次性消费，兑换将余额替换为当前套餐满额，并从兑换时间重新计算 168 小时。重复兑换返回原收据，不再次恢复余额或重启周期。ledger.points 记录 after-before 的净差，可能为零或负数；redeemed_points 是恢复后的套餐满额，action=bank_reset。

每个周期持久化独立余额和精确分数余额。旧请求回调只结算它开启时的 epoch；过期 epoch 不能发起新的模型请求。当前余额仅镜像当前 epoch。迁移为 0580 之后的单一 additive revision 0600，保留旧账、价格快照、billing_precision_adjustments 和既有 reset terminal fence。

上线只通过既有部署、迁移；不批量 RESET 真实用户、不清理历史账。生产执行由发布 owner 单写入。
