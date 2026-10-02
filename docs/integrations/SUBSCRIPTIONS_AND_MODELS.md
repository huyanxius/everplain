# 可配置模型目录与可选订阅基础（Issue #15）

本次为隔离环境内的实现和测试。未创建 Stripe 账号、价格、Checkout 或 webhook，未调用真实支付或模型服务，未部署。不将配置齐全、单元测试或 HTTP 模拟测试描述为真实集成验收。

## 接口

- `GET /api/models`：登录后读取当前运行配置中的模型，字段 `availability=configured` 仅表示本机配置具备调用条件，不代表已探测成功；演示模式的聊天模型为 `unavailable`。不会返回密钥或提供商地址。
- `GET /api/subscription`：只读当前账号的本地订阅状态与已配置方案。`available` 仅代表 Checkout 配置完整，不是商户或支付联通性验证。
- `POST /api/subscription/checkout`：登录、`Idempotency-Key` 和 `{ "plan_id": "…" }` 必填。用户、价格、成功/取消跳转地址由服务端决定。不接受客户端的价格或其他账号 ID。
- `POST /api/subscription/portal`：登录后创建当前账号的 Stripe 账单门户链接；可无请求体或发送空对象，不接受客户 ID 或跳转地址。只使用已持久化订阅的客户 ID；没有门户返回地址配置时为 503，没有订阅记录时为 409。
- `POST /api/subscription/webhook`：读取未经转换的字节及 `Stripe-Signature`。只处理 `customer.subscription.created`、`customer.subscription.updated`、`customer.subscription.deleted`；其他有效签名事件记录后忽略。不依据浏览器跳转或 checkout completed 事件授予订阅状态。

订阅尚未接入点数增加、模型权限或套餐容量。用户可经商户已配置的 Stripe 账单门户自行管理或取消，应用不代替用户执行远端取消。方案价格在商户自己的 Stripe 价格对象与 Stripe 托管结账页维护，应用没有虚构价格、币种、税费或商户资料。

## 配置

`adapters/commerce_config.py` 中的独立 `CommerceSettings` 只读取 `EVERPLAIN_`；默认不读取任何环境文件。组合入口应明确传入与应用一致的 `.env` 路径或构造实例。

- `EVERPLAIN_MODEL_CATALOG`：可选 JSON 数组，描述 `id`、`source`、`display_name`、`provider` 与 `capabilities`。source 为 `chat:primary`、`chat:fallback-N`、`embedding`、`reranker`、`transcription`。能力是运营配置声明，未运行能力探测；请勿配置提供商不支持的能力。对应源没有真实配置的模型名时不列出。未填写目录时只展示当前运行模型及最小能力。
- `EVERPLAIN_SUBSCRIPTION_PLANS`：JSON 数组，每项 `id`、`name`、`description`（可选）、实际商户提供的 `price_id`。ID 和价格不能重复；仅支持每个订阅一个固定价格项。
- `EVERPLAIN_STRIPE_ENABLED`：默认 false，只有明确开启且所有字段齐全才开放 Checkout。
- `EVERPLAIN_STRIPE_SECRET_KEY`、`EVERPLAIN_STRIPE_WEBHOOK_SECRET`：必须由部署方安全配置。不得入库。密钥 test/live 前缀必须匹配下一个设置。
- `EVERPLAIN_STRIPE_LIVE_MODE`：默认 false，webhook 的 livemode 必须一致；使用 Connect account 的通知不接收。
- `EVERPLAIN_STRIPE_SUCCESS_URL`、`EVERPLAIN_STRIPE_CANCEL_URL`：服务端固定跳转地址，仅允许 HTTPS 或本机 HTTP，无内嵌账号密码。成功页应读取订阅接口，不把跳转成功当作支付证明。
- `EVERPLAIN_STRIPE_PORTAL_RETURN_URL`：可选服务端固定门户返回地址，与其他跳转地址使用相同 HTTPS 验证。未配置时门户返回 503；门户能管理的操作由商户 Stripe 门户配置决定。
- `EVERPLAIN_STRIPE_TIMEOUT_SECONDS`：默认 10，最大 30。
- `EVERPLAIN_STRIPE_WEBHOOK_TOLERANCE_SECONDS`：默认 300，范围 1–600，不能关闭时间验证。

生产开启前，需由有权限的运营方配置商户、周期价格、商户条款、受支持支付区域、退款/取消流程和 HTTPS webhook，并通过单独授权的 Stripe 测试环境验收。当前代码不执行这些步骤。

## 装配与迁移

生产装配只放在现有 bootstrap，不新增顶层入口。下面片段置于 `create_app`，使用其已解析 `resolved_database` 与 `resolved_settings`；初始化本身不发起网络连接。传入 config 的环境文件策略需与主应用一致。测试文件内有独立的 HTTP fake 装配。

```python
from qunxue_api.adapters.commerce_config import CommerceSettings, build_model_catalog
from qunxue_api.adapters.sqlite.subscriptions import SqliteSubscriptionRepository
from qunxue_api.adapters.stripe_subscriptions import StripeSubscriptionGateway
from qunxue_api.api.routes.commerce import router as commerce_router
from qunxue_api.application.subscriptions import SubscriptionApplication

commerce_settings = CommerceSettings()  # Explicitly pass _env_file if desired.

@contextmanager
def subscription_repository_scope():
    with resolved_database.session() as session:
        yield SqliteSubscriptionRepository(session)

app.state.model_catalog = build_model_catalog(resolved_settings, commerce_settings)
app.state.subscription_application = SubscriptionApplication(
    subscription_repository_scope,
    StripeSubscriptionGateway(commerce_settings),
    plans=commerce_settings.plans(),
    unavailable_reason=commerce_settings.unavailable_reason,
    success_url=commerce_settings.stripe_success_url,
    cancel_url=commerce_settings.stripe_cancel_url,
    portal_return_url=commerce_settings.stripe_portal_return_url,
)
app.include_router(commerce_router)
```

SQLite registry 导入 `SubscriptionRow`、`SubscriptionCheckoutRow`、`SubscriptionWebhookRow`，它们在 `adapters/sqlite/subscriptions.py`。迁移 `20261002_0500` 依赖 `20261002_0490`。

## 幂等性、安全与限制

- 本地持久化 Checkout 请求及固定参数先提交，再调用 Stripe。重试复用基于账号和请求键的散列 ID；不会把一个账号的会话返回给另一个账号。
- 结账有效期为一小时；同一账号在有效期内不能新建第二个结账请求。未获得确定响应的请求在 25 分钟后停止自动重试，以免提交失效的 Stripe 到期参数；可等待原会话一小时过期后用新请求键重新开始。
- 验签使用原始字节、HMAC-SHA256、常量时间比较、时间窗与多 v1 签名支持。请求正文上限 1 MiB；不记录原始通知或签名。
- 事件 ID 插入和状态更新在同一个 SQLite 事务。插入取得写锁，再查询 Stripe 当前 subscription 状态，所以不使用可能乱序的事件快照或秒级 created 时间判断先后。远端读取失败则全部回滚，允许 Stripe 重投；已处理事件不再请求提供商。
- 当前实现为了保证顺序，在短事务中进行提供商读取，适合低流量单机。高流量部署前需队列与按订阅串行处理，不能简单把远端读取移到事务前。
- 用户读取以登录账号为准；通知不能改绑已记录订阅或客户到其他账号。延迟通知不会重建已删除或停用账号的数据。订阅与 Checkout 记录均为删除级联；纯事件回放账本不含用户资料。
- 删除本地账号不会取消 Stripe 循环扣款。账号删除适配器已在同一事务取得写锁后调用 `has_open_billing_commitment(session, user_id, now)`，阻止非终态订阅或未过期 Checkout 的账号删除，提示先处理订阅；只有 canceled、incomplete_expired 或无订阅且无未过期 Checkout 才能继续。它只反映已接收本地状态；漏收 webhook 的账务仍需运营对账，不能宣称删除账号等于取消付款。
- webhook 需选择与部署兼容的 Stripe API 版本并单独验收；代码兼容顶层或 subscription item 内的 current_period_end。未匹配到配置价格时保留状态但 plan_id 为空，不擅自授予套餐。

## 依据与验证

实现前阅读官方文档：

- https://docs.stripe.com/webhooks （原始请求体验签、重复事件、乱序、重试与时间容差）
- https://docs.stripe.com/api/customer_portal/sessions/create （客户门户只使用持久化 customer 与配置 return_url）
- https://docs.stripe.com/api/checkout/sessions/create （订阅 Checkout、价格项、metadata 与跳转地址）

定向测试：`PYTHONPATH=backend/src python -m pytest backend/tests/test_commerce.py`。全部数据在临时 SQLite，HTTP 仅使用 `MockTransport`，没有真实请求。
