# Everplain 跨平台 BOT 网关：调研、选型与独立验收标准

核验日期：2026-10-03 UTC。对应实现 Issue [#74](https://github.com/huyanxius/everplain/issues/74)。本文件是技术决策与验收标准，不代表平台实号联调或上线完成。

## 1. 决策

首期采用独立 Python 3.12 / FastAPI 网关，复用 aiogram 3.31.0 和飞书官方 lark-oapi 1.7.3，独立依赖锁文件与 SQLite 数据卷。网关只承担平台验签、事件规范化、持久化 inbox/outbox、调度、结果投递；Everplain 仍是账号、授权、会话、研究 runtime 和用量的唯一业务源。

最小首期支持飞书应用机器人、Telegram Bot 的绑定私聊与文本结果。网站聊天继续使用 Everplain 现有登录、Agent 会话和 SSE；外部网站接入另以短期限定 scope 的服务契约实现，不开放匿名用户编号或任意 CORS。群聊暂拒绝，因为现有 runtime 默认使用个人记忆，简单按群号隔离不能证明私人资料不会被发到群里。附件与真正逐 token 展示可以按 capability 增补，不能在尚未实现时声称支持。

选择 SDK 复用而非另建平台 HTTP 客户端：两端成熟的类型、上传下载、错误分类、认证和API升级维护可直接利用；自己新增的持久化、绑定与用量授权是 Everplain 特定业务，现成机器人框架无法替代。

## 2. 核验方法与同类方案

实际读取默认分支 commit 元数据、LICENSE/包元数据以及入口、发送、队列相关源文件；不以 README 平台列表或星数证明可靠性。下列活跃度是本次读取的默认分支最近提交日期，不是维护承诺。

| 方案 | 许可证及核验版本 | 直接可复用部分 | 与 Everplain 的适配判断 |
|---|---|---|---|
| NoneBot2 + adapters | MIT；核心 d598f117（2026-09-28）；飞书 45149062（2026-09-08，2.7.2）；TG 55ebcd09（2026-07-11，0.1.0b20） | Python异步框架、事件/消息模型、平台API、QQ官方adapter | 语言兼容好；不是 durable queue。TG 与飞书 webhook 在创建内存 task 后ACK；直接插件中入库来不及保证不丢事件。若将来复用，应把持久化接收放在最外层。 |
| Koishi / Satori | 主仓MIT；Koishi 5525cfd0（2026-08-28）；Satori c466fb01（2026-08-17） | TS多平台adapter、统一消息协议、账号绑定生态 | 最适合多语言统一总线备选，但首期多出Node运行时。核查的TG server将token放URL query且setWebhook使用drop_pending_updates=true；不原样采用。Koishi附加WebUI项目的许可证不等同于核心MIT，应逐包核查。 |
| LangBot | Apache-2.0；dcc7e17d（2026-10-03） | 平台消息/附件转换、飞书CardKit、流水线/权限/观察能力 | 功能丰富但完整产品的pipeline、provider、RAG、WebUI、plugin runtime会与Everplain重叠。实际Lark适配器约149KB，依赖LangBot Application/SDK；直接摘入并不“小”。QueryPool内存列表也不能自动提供重启恢复。适合独立整套采用的产品，而非首期runtime外挂。 |
| AstrBot | AGPL-3.0；a6265fa6（2026-10-03） | 多IM Agent产品、媒体与插件生态，可作能力参考 | 也是完整Agent平台；不复制其代码到本期。AGPL有网络服务源码义务，应在采用前做单独许可证审查。 |
| aiogram + lark-oapi | 两者MIT；稳定发布3.31.0 / 1.7.3 | Telegram API10.3类型/错误分类/媒体；飞书官方token缓存/签名解密/IM/CardKit | 选用。薄适配层和平台SDK边界清晰，现有FastAPI/httpx/Pydantic环境相近，独立venv避免影响主后端。 |

主要代码证据：
- [NoneBot TG ingress/polling](https://github.com/nonebot/adapter-telegram/blob/55ebcd09eb596ef8770395ece3bc8be1a1b56f78/nonebot/adapters/telegram/adapter.py)：handle_http先create_task再204；poll offset仅内存保存并在业务处理前前移。
- [NoneBot飞书 ingress](https://github.com/nonebot/adapter-feishu/blob/451490626ae74bdf66575128d7a34534c7ddf6be/nonebot/adapters/feishu/adapter.py)：解密/token校验后create_task并200，非持久化事务。
- [Satori TG server](https://github.com/satorijs/satori/blob/c466fb01c5629a0d73f1c01205127b737b6fadd6/adapters/telegram/src/server.ts)、[Satori飞书server](https://github.com/satorijs/satori/blob/c466fb01c5629a0d73f1c01205127b737b6fadd6/adapters/lark/src/http.ts)。
- [LangBot Lark](https://github.com/langbot-app/LangBot/blob/dcc7e17d7751c33e8db95ea90fef2e283a8b683b/src/langbot/pkg/platform/sources/lark.py)、[Telegram](https://github.com/langbot-app/LangBot/blob/dcc7e17d7751c33e8db95ea90fef2e283a8b683b/src/langbot/pkg/platform/sources/telegram.py)、[QueryPool](https://github.com/langbot-app/LangBot/blob/dcc7e17d7751c33e8db95ea90fef2e283a8b683b/src/langbot/pkg/pipeline/pool.py)。
- [AstrBot LICENSE](https://github.com/AstrBotDevs/AstrBot/blob/a6265fa6c9471d499574c119edeba54a125db314/LICENSE)。

## 3. 选中依赖与正确用法

### 飞书

- 使用官方企业自建应用或获授权应用的机器人能力与消息事件。普通群“自定义机器人webhook”仅能作为出站通知入口，不能替代双向应用机器人。
- SDK：[larksuite/oapi-sdk-python](https://github.com/larksuite/oapi-sdk-python)，[PyPI lark-oapi 1.7.3](https://pypi.org/project/lark-oapi/1.7.3/)；该版本于2026-08-19发布。曾有1.6.0–1.6.3因Webhook签名兼容问题被撤回，采用当前稳定锁定版本。
- 复用 [EventDispatcherHandler](https://github.com/larksuite/oapi-sdk-python/blob/0b9e6e48b74bb4b34462fc67b7e738b27e73e697/lark_oapi/event/dispatcher_handler.py)、[AESCipher](https://github.com/larksuite/oapi-sdk-python/blob/0b9e6e48b74bb4b34462fc67b7e738b27e73e697/lark_oapi/core/utils/decryptor.py)、[TokenManager](https://github.com/larksuite/oapi-sdk-python/blob/0b9e6e48b74bb4b34462fc67b7e738b27e73e697/lark_oapi/core/token/manager.py) 与 im.v1.message.acreate。发送的 [body.uuid](https://github.com/larksuite/oapi-sdk-python/blob/0b9e6e48b74bb4b34462fc67b7e738b27e73e697/lark_oapi/api/im/v1/model/create_message_request_body.py)应由稳定outbox ID派生。
- SDK webhook do()同步执行注册的processor。该回调只做验证后的同步inbox事务，不执行长LLM任务。FastAPI外层读取有大小限制的原始bytes并传RawRequest；数据库失败返回非成功，让平台可重投。
- SDK不是全部安全边界：encrypt_key空时不验签；缺token不会由其拒绝；URL验证challenge走特殊分支；SDK本身没有时间窗或持久化去重。入口补足配置fail-closed、事件app/tenant匹配、必需字段、恒时比较、时间窗、唯一事件键。challenge至少校验对应应用的验证token；不要走do_without_validation。
- 关闭SDK DEBUG及原始报文日志。官方SDK DEBUG包含headers/body。
- Feishu与Lark使用不同API域名，应显式配置枚举，不把用户任意URL直接当带认证的API地址。
- 原生CardKit文本流式可后续复用官方 [流式文本API](https://open.feishu.cn/document/cardkit-v1/card-element/content)，需要相应卡片权限，严格递增sequence和稳定每次操作uuid。权限未获批准时使用静态消息降级。

### Telegram

- [Bot API](https://core.telegram.org/bots/api)当前10.3（2026-08-24）。使用Bot账户，不使用个人账户MTProto会话替代。
- [aiogram 3.31.0](https://pypi.org/project/aiogram/3.31.0/)于2026-08-26发布，MIT、Python>=3.10。直接使用Bot API client与types，不使用会提前ACK的默认webhook后台处理器。
- 自有webhook使用独立高熵X-Telegram-Bot-Api-Secret-Token恒时校验。不要把bot token放回调路径/query，禁止自动drop_pending_updates。
- getUpdates与webhook互斥；官方只保留未取回更新24小时。event唯一键包括bot标识与update_id。
- [aiogram BaseSession](https://github.com/aiogram/aiogram/blob/b17c710ca9a05559e2141e1d16338b83dd50a445/aiogram/client/session/base.py)把retry_after转换为TelegramRetryAfter，可直接分类处理；429等待，不重跑runtime。
- 普通sendMessage没有客户端幂等键。网络读超时或发送成功后本地落库前崩溃可能无法判定结果；必须保留ambiguous状态/恢复提示，不能许诺严格端到端exactly-once。对已知message_id的edit更容易安全重试。
- 文本以纯文本作为可靠基线，分片保证中文/emoji无丢失，单条不超过4096字符限制；未来Markdown必须按平台转义，不能直接发送任意模型Markdown。
- [sendMessageDraft](https://core.telegram.org/bots/api#sendmessagedraft)是私聊临时预览，最终必须另发sendMessage。中间流可丢、最终结果须持久化。若首期只有“已收取/处理中+最终答案”，应如此说明，不称逐token流式。
- 附件未来应使用getFile取得平台对象并安全下载，不把带bot token的下载URL交给模型或前端。设置小于平台上限的本地字节限制、类型检查、隔离存储和清理。
- 不启用allow_paid_broadcast，不引入Telegram收款/订阅；平台限流和模型用量属于不同维度。

## 4. 独立网关结构与授权边界

平台回调 → 验证/归一化 → 同事务inbox(唯一event key) → ACK → 串行worker → 后端service-auth窄契约 → 原DisciplinaryAgentApplication.run_turn → 持久化outbox → 平台SDK。

1. 会话scope至少涵盖platform、bot/app、tenant、chat、thread和外部user；首期仅DM，不让chat ID单独决定Everplain所有者。
2. 绑定由已登录网页生成短期随机一次性码，在对应bot私聊兑换。数据库只存码摘要、到期时间、使用状态、平台限制；显式撤销。绑定消耗应原子化并有爆破限流，不以昵称、手机号或用户输入的user_id识别主体。
3. backend仅接受已知网关服务身份和已验证外部身份字段，自行查有效绑定、账号状态与会话映射。每次执行时复查授权，不能信任排队时缓存。禁止网关直接读Everplain数据库或拿管理员会话代所有用户调用。
4. gateway request_id和backend idempotency_key稳定关联同一事件。断线重试应找已有run/result，不能重复生成、重复预留额度或重复扣量。
5. 继承backend run状态、额度reserve/settle/release与工具授权，不在网关另算账、不绕过credits.ensure_can_start，不保存另一套私人记忆。
6. worker租约要有超时恢复与心跳，单会话串行、多会话有限并行；设队列上限、单用户速率、重试上限、死信/ambiguous可观测状态。单实例SQLite应明确，不冒称多实例高可用。
7. outbox将已成功分片和待发分片区分；一条输出后半段失败不能重发已经成功的前半段。最终结果发送失败不重跑模型。
8. 长任务展示“已接收/运行中/失败或完成”，保留request/run ID和网页恢复入口。停止、解绑、账号停用需有真实效果，不能只改显示。
9. 平台secret仅进私有配置/Secret管理，不进日志、绑定二维码内容、浏览器、git、异常trace。开发/test不会自动注册webhook或创建平台账号。

## 5. QQ、微信后续路线

### QQ官方机器人

官方 [启动接入](https://bot.q.qq.com/wiki/develop/api-v2/)与[2026-09变更记录](https://bot.q.qq.com/wiki/develop/api-v2/changelog.html)确认独立机器人可在单聊、群聊、频道使用。它与个人QQ账号自动化是不同能力。官方 [消息规则](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/overview.html)列出C2C流式入口；本次文档显示被动C2C窗口60分钟/4次，群5分钟/5次，需按场景构建长任务投递策略，而非照搬TG。

可优先评估MIT [NoneBot QQ adapter](https://github.com/nonebot/adapter-qq/tree/9bf584471e4fa658f276903481b99373c43016fd)（2026-09-26，1.7.3），再决定复用事件/API模块；其webhook/Ed25519和token刷新有现成实现。官方[botpy](https://github.com/tencent-connect/botpy)本次最近默认分支提交仍为2024-09-14，不能只因“官方SDK”就假设覆盖2026 API。当前官方域名已统一为api.bot.qq.com。

不接NapCat、Lagrange、Mirai等个人号协议作为承诺能力；OneBot只是协议形态，不能证明其底层个人号接入获得平台支持。

### 微信官方 ClawBot / iLink

2026已有腾讯官方 [Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin)，不能沿用“微信完全无官方Bot”的旧结论。实际核验24de5c9e（2026-09-21）、package 2.4.9与LICENSE正文为MIT，GitHub机器识别NOASSERTION并不代表没有许可。

- [channel.ts](https://github.com/Tencent/openclaw-weixin/blob/24de5c9eb0dd5e595d7e2d090ed8a3f82870d42c/src/channel.ts)明确capabilities.chatTypes=[direct]，支持媒体和分块输出。不能由protocol类型里出现group_id推导支持普通微信群。
- [官方协议说明](https://github.com/Tencent/openclaw-weixin/blob/24de5c9eb0dd5e595d7e2d090ed8a3f82870d42c/docs/protocol.md)与[src/api/api.ts](https://github.com/Tencent/openclaw-weixin/blob/24de5c9eb0dd5e595d7e2d090ed8a3f82870d42c/src/api/api.ts)可用于后续独立适配。扫码授权获得bot身份，long-poll getupdates，回复携带context_token。协议文档自己明确其客户端行为不代表完整服务端合同，不能把字段可选理解为权限无限。
- 复用对象：API请求/types、媒体CDN加解密、消息构造、错误分类；不把OpenClaw runtime整体引入Everplain。官方包有OpenClaw peer依赖，直接npm装包不会变成独立SDK。
- 当前[monitor](https://github.com/Tencent/openclaw-weixin/blob/24de5c9eb0dd5e595d7e2d090ed8a3f82870d42c/src/monitor/monitor.ts)在业务处理前写新cursor；独立网关应先把整批消息与新cursor同事务持久化，再推进cursor，避免崩溃丢消息。
- 未来需要用户授权扫码与安全保存token，且真实验证账号资格、会话范围、限流和到达结果。本期不创建授权、不登录。它不等同于接管个人号联系人/所有聊天。

### 企业微信、公众号、微信客服

这些是分别授权的官方产品，应建立不同adapter/capability，不合并成一个含糊“微信”。企业微信群webhook通知机器人也不等于智能机器人双向API。

[WecomTeam/aibot-node-sdk](https://github.com/WecomTeam/aibot-node-sdk/tree/80615b987ef69c6028ad764924609247c0725955)本次核验1.0.6、2026-04-07，README与package标MIT但仓库未见独立LICENSE文件，正式vendoring前补核对分发许可。src/client.ts有replyStream、sendMessage及媒体方法；src/ws.ts提供内存队列、5秒ACK超时和重连，仍不替代durable inbox/outbox。可作为企微官方长连接路线；不推导企业外部客户群支持。

企业微信官网API文档与微信公众号文档本次抓取返回Site Unavailable，不能把旧博客里的48小时、5条等数值当成已核验最新规则。后续实施公众号/客服前，必须核对官方账号类型、接口资格、用户交互窗口、回调加密和可发送条数；当前只确立平台边界，不声称已支持或承诺具体额度。

## 6. 验收门槛

### A. 确定性测试，提交前必需

- 配置关闭/无凭据时不启动外呼；health区分进程可用、配置齐全、真实连接状态。
- TG错/missing secret，飞书错签名/错token/缺字段/篡改body/过期签名/错app或tenant拒绝；合法challenge通过、非法challenge不回显。
- 同event串行及20路并发重复投递：只有一个runtime请求、一份账单、唯一outbox。
- 验证inbox事务提交先于成功ACK；模拟DB写失败无成功ACK；重启后pending恢复。
- worker在claim后、backend返回后、outbox分片中间被中断：lease正确恢复，稳定幂等键，无重复扣量；已发送分片不重发；不确定送达有明确状态。
- 绑定码过期、重复兑换、竞争兑换、平台不匹配、跨用户查看/删除、撤销后排队任务都不能越权。
- payload中的任意user_id/conversation_id不能绕过服务端身份映射；账号停用、余额不足与资源所有权在BOT和Web保持一致。
- 不同bot/tenant/user/chat/thread不串上下文；群聊、频道、bot自身消息和不支持的事件不会触发个人runtime。
- 同scope串行；不同scope并发有限；总队列/单身份限流有上限，重试不放大流量。
- 429 honor retry_after，永久4xx停止，传输错误分类明确；仅重试投递不重新运行模型。
- 超长中英文/emoji分片拼接后完全一致且≤平台上限；空输出、错误输出、链接、特殊Markdown字符有可用降级。
- 事件正文不可信：附件URL不任意访问内网、文件名无路径穿越、尺寸上限、秘密不进日志。若首期拒绝附件，要测拒绝反馈而非静默丢失。
- backend/frontend公共契约再生成无漂移，受影响ruff/pytest/typecheck/build通过，原Agent与计费回归通过。

### B. 运行集成验证

用临时隔离SQLite、假平台HTTP服务器/受控transport和真实本地backend HTTP栈验证完整流程。测试替身只替换第三方网络和LLM；证明的是确定性业务链路，不是第三方实号接入。验证容器打包、独立数据卷、重启、配置预检；若Docker不可用须记录未执行。

### C. 外部实号验收，缺凭据时明确待办

用户配置官方飞书应用/TG Bot与安全注入凭据后，依次验证：合法平台事件到达→网页绑定→私聊真实runtime→原计费记账→平台最终答案与网页同一run→重复事件→长任务→撤销→重启恢复。必须见真实消息和日志关联证据，不能用Mock/health/build替代。平台账户/权限、TLS域名、目标服务器部署与费用授权是独立门槛。

### D. 发布结论格式

分别列“代码完成、自动化测试通过、容器验证、真实飞书验证、真实TG验证、生产部署”。未执行项写未执行及确切阻塞；第一期不支持的群聊/附件/更多平台写清楚。PR与CI必须对应精确head SHA。

## 7. 对既有 runtime 的额外核查

ffd5791 的原 `/api/agent/turns` 在 SSE 编排层每5秒维护 `app.heartbeat`，SQLite run租约约30秒；`run_turn`本身并不取代调用方的心跳循环。新service-auth turn端点必须保留 `on_run_started`、lease_token、独立心跳及取消/超时语义，否则超过30秒的长任务可能被读取会话时回收为interrupted。同一幂等键仍running时会抛 `RunAlreadyActive`，网关需要查询/等待现有run，不新建key重新生成。独立验收应加入>30秒真实时间/受控时间推进测试。

飞书出站uuid窗口补核验：[官方Go SDK生成文档](https://pkg.go.dev/github.com/larksuite/oapi-sdk-go/v3/service/im/v1#CreateMessageReqBodyBuilder.Uuid)规定相同uuid发送请求在1小时内至多成功发送一条。网关记录首次尝试时间；模糊重试必须保持同payload/uuid，限定在1小时窗口且留时间余量，跨窗口转ambiguous，不从每次重试重置起算时间；每个分片有独立稳定uuid。
