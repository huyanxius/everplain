# Issue #14：外部 Agent 的只读知识连接

## 安全边界

- 用户登录后手动创建连接，必须明确选择自己拥有的知识库并指定到期时间。加入他人知识库、公开发布或获取分享链接都不会扩大连接权限。
- 密钥使用 32 字节随机值，仅创建响应返回一次。数据库只保存 SHA-256 摘要；列表与撤销响应不含密钥或摘要。丢失后撤销旧连接并重新创建，不提供恢复接口。
- 最长有效期 365 天；最多 50 个有效连接，每个连接最多选择 50 个库。没有自动创建、默认全库授权或永久密钥。
- 每个请求重新验证密钥是否撤销/过期及账号是否 active。读工具再次检查库的当前所有者、未删除状态、当前库与资料关联、资料所有者和解析状态。账号禁用/注销、库移交/删除和资料移除后不保留历史访问。
- 仅有库/资料列表、原文文字搜索和原文分页读取。没有写入、上传、分享、删除、运行 Agent、模型调用或下载原始二进制文件工具。
- 密钥只通过 Authorization: Bearer 传入，不接受 Cookie、URL 查询参数或请求体作为 MCP 凭据。生产环境须使用 HTTPS；禁止记录 Authorization 或创建响应正文。
- 接入任何外部 Agent 前，用户应理解该 Agent 可读取所选库的原文，并只把密钥交给自己信任的客户端。前端只在创建成功时展示密钥，不将其存入 localStorage、日志或可恢复的列表。

## 管理 API

会话 Cookie 鉴权：

- GET `/api/external-agents/connections` 返回 `{connections, mcp_endpoint}`。
- POST 同路径接收 `{name, library_ids, expires_at}`，返回 201 `{connection, secret, mcp_endpoint}`。`expires_at` 必须包含时区且在未来。
- DELETE `/api/external-agents/connections/{connection_id}` 撤销自己的连接，返回连接元数据。重复撤销安全，不提供恢复动作。

Connection 字段：`connection_id`, `name`, `library_ids`, `created_at`, `expires_at`, `revoked_at`, `status`（active / expired / revoked）。客户端创建请求失败或响应丢失时不能恢复已生成的密钥，应查看列表撤销不再需要的连接。

所有管理成功响应和 MCP 成功响应均设置 `Cache-Control: no-store`。

## 最小 MCP HTTP 子集

实现固定兼容 **2025-11-25** 版本。接口为 `/api/mcp`，无持久 MCP 会话，不声明 SSE、资源订阅、提示词、任务、OAuth 发现或当前全部 MCP 能力。客户端需要支持自定义 Bearer 认证头；未对具体第三方客户端做联网兼容性验证。

POST 请求必须携带 `Content-Type: application/json`、`Accept: application/json, text/event-stream`；后续请求应携带 `MCP-Protocol-Version: 2025-11-25`。版本头存在但不支持时返回 400。请求体限 64 KiB，拒绝批量请求。

支持：

1. `initialize`：包含 protocolVersion、capabilities、clientInfo，返回协商版本与 tools 能力
2. `notifications/initialized` / `notifications/cancelled`：返回空的 202
3. `ping`：返回空对象
4. `tools/list`：返回四个只读工具与严格参数 schema
5. `tools/call`：返回文本 JSON 与 structuredContent；无权限资料统一返回不泄露身份的工具错误

四个工具：

- `list_libraries {}`：仅当前仍拥有的已选库
- `list_documents {library_id, offset?, limit?}`：已解析资料列表，每页最多 100 条
- `search_documents {query, library_id?, limit?}`：当前授权原文的本地文字匹配，最多 50 个片段；省略 library_id 仅搜索该连接显式选择且当前仍拥有的库
- `read_document {library_id, document_id, offset?, limit?}`：按字符分页原文，每页最多 20,000 字符，保留来源定位、总字符数和 next_offset

GET 返回 405（不提供 SSE）。所有支持的方法先校验可选 Origin：仅接受已有 `cors_allowed_origins` 中的精确来源，不从 Host 或转发头推断可信来源。无 Origin 的本机/服务端客户端仍须认证。没有新配置项。

## 协议调研依据

实现前读取以下 MCP 官方版本化规范；选择固定子集而不追踪 draft，避免初始化和传输语义随草案变化：

- [Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)：POST JSON 响应、通知 202、可选会话、无 SSE 时 GET 405、Origin 校验
- [Lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)：初始化参数、能力和版本协商
- [Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)：tools/list、tools/call、只读注解、文本与结构化结果、工具错误

## 装配与迁移

`20261002_0490` 继承 `20261002_0480`。新表 `external_agent_connections` 的 owner_user_id 引用 users 并 ON DELETE CASCADE；库 ID 保留为显式历史范围，每次访问重新查询当前所有权。

装配入口创建请求级数据库会话，组合：

- `ExternalAgentService(SqliteExternalAgentRepository(session))`
- `ExternalAgentApplication(service, identities=SqliteIdentityRepository(session), libraries=SharedKnowledgeService(SqliteSharedKnowledgeRepository(session)))`
- 赋值 `app.state.external_agents_scope` 并注册 `api.routes.external_agents.router`
- SQLite 注册表导入 `ExternalAgentConnectionRow`，架构模块注册 `external_agents` 为无依赖业务模块

`backend/tests/test_external_agents.py` 使用独立 SQLite 和内存 HTTP 客户端，覆盖密钥与所有权、到期撤销、移交/删除/移除、错误关联、协议校验及原文分页。没有真实凭据、外部模型、第三方 Agent 或公网请求；这些测试不代表真实客户端或生产部署验收。
