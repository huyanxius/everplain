# 飞书和 Telegram：实际发布接线与安全接入

本次是在 PR125 原实现上正常合并最新 main 与 PR130 后的增量。代码交付、CI 镜像构建、主机运行与实号验收是四个独立阶段；平台凭据未安全配置时不能标记机器人已上线。

## 发布机制

既有 `Release Everplain` 主线工作流继续执行同提交检查、构建和既有受限 SSH 发布。新增 gateway 镜像与 API/Web 一同固定为源提交和不可变镜像 digest，独立 Python 依赖锁不影响后端。

- 发布器只操作 Everplain 的 API、Web 和 `everplain-channel-gateway`，沿用原网络和 HTTPS 入口，不更改 DNS、隧道或共享反代。
- 只有操作员在 `/etc/everplain/channel-gateway.env` 安全配置后才启用机器人。文件须 root 所有、0600、不可为符号链接；父目录须 root 所有且不可被组/其他用户写入。没有该文件时正常 Web/API 发布继续，结果明确包含 `channel_configured=false`。
- 网关有独立持久目录 `/srv/everplain-updates/channel-gateway/data`，容器仅挂载此目录到 `/data`；不与网站数据库混用，不把数据加入发布包。升级保留原数据与旧容器；不能清空卷。
- 服务仅绑定宿主 `127.0.0.1:8298`。Web 生成两个精确 POST 路由 `/webhooks/telegram`、`/webhooks/feishu`，拒绝其他 HTTP 方法，128KiB 请求上限。网关健康和队列统计不通过公网 webhook 转发。
- 配置完整性先在禁网容器验证，然后才进入既有停写/迁移/切换路径。网关在 API 停写前停止，在新 API 健康后启动并检验精确版本，再验证 Web 的 Nginx 配置。
- 外部平台和网关到后台均走 HTTPS。后台鉴权仅加入与此机器人对应的服务身份，保留其他设置和已配置的服务身份。
- `channel_local_health_verified=true` 仅表示进程/版本正常，不能替代平台或模型验收。实号验证仍需逐项记录，不能把平台设置缺失当成已经部署成功。

## 用户最小输入与安全入口

先让既有发布任务只读核对已授权配置里非秘密的 Bot ID、飞书 App ID、tenant key 和试点 subject ID，避免重复要求用户填写。不得显示 token、密钥或原始环境文件。

Telegram：
- 用户自己的现有 Bot token，以及 Bot ID/用户名（已有时直接核实）。
- 已批准的私聊用户 ID；Telegram 私聊 chat ID 必须等于该用户 ID。
- 当前 Bot 的 webhook secret 与独立后台服务 secret；均须至少32字符，webhook secret仅允许ASCII字母/数字/下划线/连字符。
- 设置 `https://e.qunxue.xyz/webhooks/telegram`；allowed updates 仅 `message`，不丢弃未处理消息。

飞书：
- 现有企业自建应用的 App ID、tenant key、App Secret、Encrypt Key 和 Verification Token。
- 用户自己的应用范围 open_id 与私聊 chat_id；启动白名单使用已批准的 open_id。
- 独立后台服务 secret，至少32字符。
- 开启应用机器人、仅批准私聊接收与应用发送消息能力；订阅 `im.message.receive_v1`，选择 HTTPS 回调 `https://e.qunxue.xyz/webhooks/feishu`，发布/安装到批准的租户与试点可见范围。

密钥只能由用户在已验证的官方控制台及其授权的安全配置入口输入，再由获授权的发布任务安装到上述私有文件。不在聊天、源代码、PR、CI artifact、恢复包或公开日志提供值。本代码不生成/保存新 token、不建立 OAuth grant、不调用 setWebhook，也不发送任何实号测试消息。首次持久接入、凭据配置和平台权限必须取得对应审批。没有已经核实的本人 subject ID 时，生产试点模式拒绝启动。

私有文件只允许 `EVERPLAIN_GATEWAY_` 的：
- 共用：`BACKEND_URL=https://e.qunxue.xyz`，可选 `MAX_PENDING`、`MAX_ATTEMPTS`。
- Telegram：`TELEGRAM_TOKEN`、`TELEGRAM_WEBHOOK_SECRET`、`TELEGRAM_BACKEND_SECRET`、`TELEGRAM_ALLOWED_SUBJECT_IDS`（JSON字符串数组）。
- 飞书：`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_ENCRYPT_KEY`、`FEISHU_VERIFICATION_TOKEN`、`FEISHU_TENANT_KEY`、`FEISHU_BACKEND_SECRET`、`FEISHU_ALLOWED_SUBJECT_IDS`（JSON字符串数组）。

可仅启用一个平台，但其字段必须完整。禁止代理、任意环境变量或来自其他产品的配置。版本、数据库路径及 `PILOT_ONLY=true` 由发布器固定，不能用私有文件绕过白名单。

## 协议与实号验收

1. 用户在 Everplain 设置中明确同意私聊资料/用量接入并生成一次性绑定码，然后自己向已批准的机器人私聊发送绑定命令。绑定码不进入运维日志。
2. 验证平台签名/secret与app/tenant；durable inbox先提交再ACK。错签名、他人ID、群聊、转发和错租户均不可进入个人 Agent。
3. 网关 `POST /api/channel-gateway/dispatch` 使用 `Prefer: respond-async`；持久预约提交后返回202，GET `/api/channel-gateway/events/{event_key}?after=<cursor>` 只读取同一 Agent durable journal，GET不启动模型/工具。最终答案分片发送，仍不宣称逐 token 平台流式。
4. 在真实模型允许的试点预算内，比较平台最终答案与网站同一 run；核对只产生一次逻辑操作、真实用量按原账务策略记录。取消/失败不意味着免费或自动退款。
5. 在运行中重启网关，确认通过已存 cursor继续GET而非再次POST。正常退出立即归还自身队列lease，异常退出在15秒订阅lease过期后恢复，保持后台 run不重复执行。后台进程丢失后只能按相同事件/原 runtime 恢复规则重试。
6. 用户在同一私聊发送 `/cancel`。独立控制队列可越过长任务；取消仅定位该绑定与私聊作用域。取消申请持久保存，包括后台模型尚未开始的窗口；已生成正文仍保留，结尾明确本轮已停止。
7. 对长于30秒的任务、重复回调、运行中/投递前解绑与禁用账号核对账本和owner隔离。每个分片发送前重新授权，撤销后不得发私人答案。
8. 合成测试完成429/截断响应/重试和稳定飞书UUID；实号测试不得故意大量打平台制造限流。Telegram模糊投递不盲重发；飞书固定UUID重试在平台去重窗口内结束。dead/ambiguous必须告警并人工核对，不伪称exactly-once。

官方依据：[Telegram Bot API](https://core.telegram.org/bots/api)、[飞书消息发送](https://open.feishu.cn/document/server-docs/im-v1/message/create)、[飞书订阅方式与回调](https://open.feishu.cn/document/server-docs/event-subscription-guide/event-subscription-configure-/request-url-configuration-case)。核验日期：2026-10-05。
