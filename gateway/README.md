# Everplain 私聊机器人网关

Issue [#74](https://github.com/huyanxius/everplain/issues/74) 的第一阶段。独立 Python 进程和 SQLite 数据卷，使用 aiogram 3.31.0 与飞书官方 lark-oapi 1.7.3；不包含模型客户端、第二套账号库、RAG 或计费引擎。[选型与官方来源](../docs/architecture/bot-gateway-research.md)。

## 已实现与边界

- Telegram webhook 私聊文本（包含 `message_thread_id` 主题）、飞书应用机器人 webhook 私聊文本。
- 飞书原始 body 签名、五分钟时间窗、token、app/tenant 校验；SDK 解密和事件模型；Telegram secret header。飞书挑战校验 token，不把 challenge 当消息。
- 同步提交 SQLite inbox 后 ACK；同身份每分钟/待处理最多 20 条，总待处理上限 10,000；重复 provider ID 不重复入队，改写内容冲突拒绝。
- 站内登录用户生成 192-bit、十分钟、一次性绑定码。按平台机器人绑定，不接受平台请求指定站内 user/conversation/material/model。撤销、停用、旧绑定前排队消息均复核。
- 与网页相同 `DisciplinaryAgentApplication.run_turn`、用户身份、个人记忆/权限、对话和计费路径。私聊会把回答交给对应平台，绑定时必须明确同意此数据流与正常用量。无模型配置时沿用现有 runtime 的明确“模型未配置”结果，绝不宣称真实模型成功。
- 5 秒续租、fencing、300 秒协作取消；相同 event 的模型幂等键持久化。2 秒仍未完成时发一条不含私人数据的处理提示；最后发送纯文本结果，不逐 token 编辑。
- 独立 outbox，限长分片、按顺序发送、429 等待、有限重试；每一片发前向后端重新校验绑定。运行模型与重复投递分离。
- Telegram `sendMessage` 超时或进程中途退出可能已送达，状态为 `ambiguous`，不自动重发。飞书固定 UUID 只在首次尝试后 55 分钟内自动重试（官方去重一小时），过窗同样转 `ambiguous`。
- 群聊/频道、机器人消息、Telegram 转发、编辑消息、附件、飞书线程主题暂不进入个人 runtime。首期不支持平台长连接、QQ/微信及外部网站嵌入；这些不能被本地测试视为已交付。原网站仍用原登录/SSE接口。
- 账户设置 → 聊天平台提供用户绑定管理界面：明确同意、一次性命令、复制、自动确认、过期隐藏、作废绑定码和本人解除绑定。代码不写浏览器存储、不放URL；切换用户/关闭页面不会重新显示迟到的命令。平台实号验收前仍按受控技术预览运行。

## 配置与启动

本次开发没有注册平台账号、生成真实密钥、配置 webhook 或真实外发。上线由拥有相应平台权限的操作员完成，凭据只通过秘密管理注入环境变量。所有新配置为 `EVERPLAIN_`。

后端先迁移到 `20261003_0540`（前置写作 `20261003_0530`）。设置 `EVERPLAIN_CHANNEL_GATEWAY_CREDENTIALS` 为 JSON，键形如 `telegram:<bot-id>` 或 `feishu:<app-id>:<tenant-key>`，值为至少 32 字符的专用 service secret。不要复用用户 cookie、MCP令牌或模型 API key。未配置时，所有 gateway 调用默认拒绝。

网关必须完整配置至少一个平台：

| 变量（统一前缀 `EVERPLAIN_GATEWAY_`） | 用途 |
|---|---|
| `DATABASE_PATH` | 独立持久卷，默认 `var/everplain-gateway.db` |
| `BACKEND_URL` | 后端 origin，默认 `http://127.0.0.1:8297`；非 loopback 强制 HTTPS，无凭据/query/redirect |
| `TELEGRAM_TOKEN` | Telegram Bot token，Bot ID 从 token 的公开数字前缀取得 |
| `TELEGRAM_WEBHOOK_SECRET` | 至少 32 字符，平台 webhook secret_token 对应值 |
| `TELEGRAM_BACKEND_SECRET` | 后端为此 Bot 配置的专用 service secret |
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | 飞书应用身份与应用 secret |
| `FEISHU_ENCRYPT_KEY` / `FEISHU_VERIFICATION_TOKEN` | 两者均必须设置，不依赖 SDK 的空值降级行为 |
| `FEISHU_TENANT_KEY` | 允许接入的唯一租户，跨租户事件拒绝，租户同时进入后端绑定与事件身份键 |
| `FEISHU_BACKEND_SECRET` | 后端为此应用配置的专用 service secret |
| `MAX_PENDING` / `MAX_ATTEMPTS` | 默认 10000 / 8，有限容量与重试次数 |

```sh
cd gateway
uv sync --frozen
uv run everplain-gateway
```

默认监听 `127.0.0.1:8298`。反向代理仅公开 `/webhooks/telegram` 与 `/webhooks/feishu` 的 HTTPS，限制 body 为 128 KiB；不要扩大后端 CORS，不把 service secret 放浏览器。`/health` 只供本机/运维查询，返回 `local-ready` 和队列计数，并不证明模型或平台连通。

Telegram 操作员按[官方 setWebhook](https://core.telegram.org/bots/api#setwebhook)设置此 HTTPS 地址、同一 secret_token、只订阅 message；不得为方便而 `drop_pending_updates=true`。飞书启用应用机器人，订阅 `im.message.receive_v1`，仅申请接收单聊消息及以应用发送消息等所需最小权限，配置本文约束的加密/key/tenant。普通群自定义 webhook 不是双向 BOT 接口。不同 Bot/tenant 使用不同凭据；本期一个网关实例只承载一个 TG Bot 与一个飞书租户应用。

## 绑定与撤销

用户在“账户设置 → 聊天平台”选择机器人，读明数据与用量说明并同意后生成命令，只发送到目标机器人的私聊。页面会轮询本人绑定状态；“作废绑定码”会在服务器取消尚未使用的代码，关闭页面只隐藏命令。以下 owner API 使用已有 Everplain 登录 cookie，仅由账号本人发起，操作员不能替用户隐式绑定。

1. `POST /api/channels/link-codes`：`{"gateway_id":"telegram:<bot-id>","acknowledge_private_data_and_usage":true}`。该确认表示：私聊使用本人 Everplain 数据、个人记忆与正常用量，回答交给此平台；code 只返回一次且 `Cache-Control: no-store`。
2. 十分钟内在目标机器人的**私聊**发送 `/bind <code>`。此平台身份已有绑定时不覆盖原绑定；需本人先解除旧绑定。
3. 后续私聊使用独立渠道对话，可在原网页会话列表读取。`GET /api/channels/bindings`只列本人绑定；`DELETE /api/channels/bindings/{binding_id}`仅允许本人撤销。换绑创建新 generation，不承接旧消息/旧对话。

出站每片发送前重新校验当前授权；撤销不能撤回已经发给第三方的内容，校验与平台实际接受之间仍有不可消除的网络竞态。本期不开放私人记忆到群聊。

`GET /api/channels/gateways`只返回已配置的公开机器人名称/入口，不返回service secret。`DELETE /api/channels/link-codes?gateway_id=...`作废本人该平台未使用的码，已有绑定不受影响。

操作员可设置 `EVERPLAIN_CHANNEL_GATEWAY_DISPLAY` JSON，为凭据字典中已有gateway ID提供 `name` 和可选 `bot_url`。入口须由操作员核验；仅允许HTTPS的 t.me 机器人名或飞书官方 app link，飞书链接的appId必须与配置一致。未提供时UI明确提示入口未设置，不猜账号地址。

## 故障与恢复

- inbox/outbox 均保存在此独立 SQLite 文件。必须持久化并与 Everplain 主数据库一起纳入授权备份；这是包含私人输入/待发送回答的用户数据，不是普通日志。限制卷访问、按组织策略静态加密；不要把数据库提交仓库或转发。
- inbox 运行 lease 为 360 秒，重启后到期重领；同 scope FIFO。后端的 45 秒渠道 lease 与原 30 秒 runtime lease 每 5 秒续租。
- 同 event id/hash 的重试复用已执行 turn；模型完成后丢失 HTTP 响应可从同幂等记录重建回复，避免重复扣费。执行中真正中断的恢复仍由原 runtime/billing 决定，不能把真实 provider 不确定成本当成零。
- outbox 崩溃后 Telegram 标为 ambiguous，飞书在固定 UUID 窗口内恢复。已送达文本与已完成 inbox 输入被擦除；幂等 digest 留存。失败输入/未发送文本保留供限期排障，绑定码本身十分钟即失效。
- dead（达到八次/一天、永久错误）和 ambiguous 会出现在健康计数；inbox 重试耗尽会另发固定失败提示。运维必须告警；单靠进程活着不代表队列正常。
- ambiguous 必须先在平台确认是否已送达，不能直接重复投递或重新运行模型。终止分片会阻止其后续分片，避免把缺头答案当成成功。撤销的回答所有待发送片同时 suppressed。
- 网关运行一个普通 inbox worker、一个独立取消控制 worker 与一个 outbox worker；长生成不会阻塞 webhook 或进度/结果投递。首期吞吐是受控预览级，不宣称多实例/高可用能力。
- 平台有各自保留窗口，不能承诺无限离线补偿。定期按用户数据保留政策处理已终结收据/失败内容；本期未提供自动清理或 dead-letter 操作控制台。

## 确定性验收

```sh
cd gateway
uv sync --frozen
uv run ruff check .
uv run pytest
# 仓库根目录：
make contract
make check-backend
cd frontend && npm run typecheck
```

测试使用合成 webhook / 假第三方 transport / 合成模型边界，真实执行 SQLite、owner授权、会话和积分/持久计费代码。覆盖并发重复、变体重放、过期/错误签名、跨app/tenant、一次性绑定、撤销与禁用、余额不足、runtime提交后重试、线程目标、FIFO/过期lease、旧worker fencing、429、去重窗口、Unicode分片及模糊投递。第三方 SDK 的弃用警告不等于实号失败。

## 上线前尚需实证

- 官方应用/Bot配置、最小权限、TLS反代及独立卷；由操作员批准配置，不在测试阶段自动开通。
- 真实站内用户绑定、真实模型/账单、平台最终答案与网页同一 run 一致；重复事件、超过30秒长任务、重启、撤销实号验证。
- 容器运行、网络故障、告警与恢复演练；本期附 Dockerfile，未以构建/health代替真实容器验收。
- 浏览器交互/移动布局的CI隔离验收；群安全 runtime；外部网站短期授权契约；按官方路线分别接入 QQ、腾讯 ClawBot/企业微信等。见调研文档，不能把不同微信产品混为一种权限。

## 跨进程与浏览器契约验收

`gateway/integration/`在两个独立Python环境启动真实Everplain API与网关，第三方模型/平台端点仅替换为loopback合成服务。实际使用官方aiogram/lark SDK发HTTP，不用假SDK发送方法；验证ACK持久化、并发重放、重启、账本、平台/网页答案一致、429、固定uuid和撤销分片。先同步两个锁文件，再运行：

```sh
cd gateway && uv run pytest integration/test_http_contract.py
```

fixture必须设置专用测试开关且只监听loopback，不可用作生产服务。测试临时创建的账号、密钥和平台记录都是无真实用户资料的合成数据。测试子进程明确移除继承的HTTP/SOCKS代理，不要求为本地loopback安装代理支持。

`gateway/browser/`使用GitHub Runner隔离浏览器检查真实设置界面，服务均由测试自建，不借用运行中的预览、真实session或平台secret；关闭截图、trace、video。此测试准备不代表浏览器已通过，须看精确PR head的CI结果。

## 2026-10-05 主线接入

异步 admission、只读 durable GETcursor、运行中重启恢复与私聊 `/cancel` 已实现；生产发布新增不可变 gateway 镜像、独立持久目录和精确 webhook 接线。详见 [DEPLOYMENT.md](DEPLOYMENT.md)。平台凭据、安全审批与本人试点白名单尚需在授权环境核实；它们不在源码交付内。
