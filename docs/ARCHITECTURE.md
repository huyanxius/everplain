# Everplain 当前工程架构

历史核对日期：2026-10-07。本文原实现基线是 [`027e878909bf888065c45f23c58fca9fe70cac7b`](https://github.com/huyanxius/everplain/tree/027e878909bf888065c45f23c58fca9fe70cac7b)，tree `bbe14fa0d89fe5d5326c429b6ea252e9c78b8423`。这是原 `20f764f` 文档的源码核对后继，只描述该冻结源码的职责、入口和限制；测试、合并、部署及真实模型/浏览器验收分别以对应提交的证据为准，不将本文当作当前线上版本证明，整体审计仍开放。后续事实以单独标明日期和源码身份的增量补充，不覆盖该历史核对。

2026-10-08 局部增量核对：以下会话控制器、写作/记忆/研究创建用例和测试登记事实固定于 [`800ef6b199134edc5c95603993c862a9e122f355`](https://github.com/huyanxius/everplain/tree/800ef6b199134edc5c95603993c862a9e122f355)，tree `fb7f1c0a8950fe52b06787888c42bb7c0486a6d4`；不是整篇在该提交上的逐文件重审。该提交属于 [PR #289](https://github.com/huyanxius/everplain/pull/289)，对应 [Release 37776513148](https://github.com/huyanxius/everplain/actions/runs/37776513148) 的成功部署回执是该版本的独立发布证据；当时外部 health/revision 复核返回 403，未建立独立端点版本证明，也不构成真实用户、浏览器或 Provider 全链路验收。

Everplain 是个人私有知识与研究产品，主入口是 `/library`、`/agent`、`/writing`。保留 `qunxue_api`、`shared_knowledge`、`CoursesPage` 等兼容名称，不据此恢复公共学科、课程或竞赛前提。产品范围见 [当前产品说明](product/README.md)；历史决策有效性见 [架构记录索引](architecture/README.md)。

## 运行形态与依赖方向

核心仍是 **FastAPI + SQLite 模块化单体**，React/Vite 为独立前端构建。生产 API 启动脚本固定单 worker；当前 SQLite Session 使用提交/回滚/关闭作用域、外键和 WAL。渠道网关是外围协议进程，拥有独立投递数据库，不是第二个 Agent、身份或账务核心。

```text
Web 页面 → 产品模块 index.ts → 模块 API/传输适配器 → Everplain HTTP/SSE
渠道 webhook → gateway inbox/outbox → 后端渠道鉴权/绑定 → 同一 Agent 用例
                                                   ↓
HTTP 契约/鉴权 → application 编排 → modules 规则和端口
                                   ↑
                         adapters：SQLite、模型、检索、解析、外部服务
bootstrap.py / account_extension.py：装配具体实现和作用域
```

- `modules/` 拥有业务规则、领域数据与端口；不得引入 FastAPI、Pydantic、SQLAlchemy、具体模型 SDK 或外层业务编排。
- `application/` 编排跨模块用例，通过模块包根使用公共能力；`api/` 处理 HTTP DTO、鉴权、错误和传输。`adapters/` 实现技术边界，不建立另一套业务所有权。
- `bootstrap.py` 是主组合根；`account_extension.py` 是显式账号装配扩展。大组合根仍存在，不能将局部提取称为整体装配重构完成。
- 新模块和依赖要登记在现有架构守卫中，不沿用旧四模块图推断全图。当前静态守卫通过也不等于动态依赖、运行事务或全仓逐文件审计完成。

源码：[装配](../backend/src/qunxue_api/bootstrap.py)、[账号装配](../backend/src/qunxue_api/account_extension.py)、[数据库作用域](../backend/src/qunxue_api/adapters/sqlite/database.py)、[单 worker 启动](../ops/start-api.sh)、[后端依赖规则](../backend/tests/test_architecture.py)。

## 能力与数据责任

表中是当前装配关系，不是新的通用服务层或数据库拆分计划。读取、引用、导出、删除必须由后端依据资源所有者或明确分享授权校验；登录本身不构成资源授权。

| 能力 | 规则/编排责任 | 数据及适配边界 |
| --- | --- | --- |
| 身份与账号 | `identity`、`account_management`；`application/oauth_login.py` | 用户、会话、关联身份、偏好与账号操作由对应 SQLite 仓储处理；OAuth 客户端在外层装配。导出使用显式字段/owner/JSON 契约，见 [账号导出](ACCOUNT_DATA_EXPORT.md)。OAuth-only 没有本地密码恢复或自助注销路径，见 [登录边界](OAUTH_LOGIN.md)。 |
| 私有库与导入 | `shared_knowledge`、`knowledge_import`；对应 application | 库、文档、解析片段、知识条目及导入任务/请求收据由对应仓储持有；明确分享与公开发布也在该边界。文件/网页/媒体获取是 adapter；这不等于恢复历史公共学科目录。 |
| 研究材料 | `research_materials`；`ResearchMaterialApplication` | 原件、parse、segment、ingestion job 与材料向量由材料仓储/缓存持有；`ResearchMaterialIndexer` 在外部调用后重验 owner、task、material、parse 与 attempt 再写入。生命周期资源管理仍有后续候选。 |
| 检索与来源 | `SharedKnowledgeReferences`、材料工具调用方；`adapters/retrieval/` | 调用方提供当前可读片段和 scoped vector cache；`HybridRetriever.search_chunks` 组合词法、语义、RRF 与 reranker，不另建个人向量库。索引命中和模型生成的 citation/locator 都不能自行授予正文访问权。 |
| 研究项目与文稿 | `research_intake`、`research_analysis`、`research_method`、`research_cycle`、`research_framework`；对应 application | 项目、分析、计划、章节文稿、提议与交换审计通过各自仓储编排。旧理论匹配等类型仍为兼容能力；不能将旧 M4/M5 占位说明当作当前全部实现。 |
| Agent 会话与执行 | `agent_conversation`；`DisciplinaryAgentApplication`；HTTP Agent routes | 对话、turn、逻辑 run、租约、输出 attempt/event 与恢复投影归会话边界；模型协议和工具适配在 `adapters/research_agent/`。详见下节。 |
| 个人记忆与上下文 | `agent_memory`、`agent_profile`；memory/summary applications | 记忆、画像、学习进度和会话摘要缓存使用独立仓储作用域；派生摘要、卡片不应成为可绕过来源权限的另一份正文。 |
| 私有写作 | `writing`；`WritingApplication` | 文稿版本、样文、pending 修订和幂等操作由写作仓储持有；Agent 通过用例提议，领域层统一精确目标，预览 ready 不等于用户接受。 |
| 用量、配额与订阅 | `billing`、`subscriptions`、`model_catalog`；billing/model adapters 与 subscription application | 用量回执、结算、积分/周期与订阅状态各有记录；`OperationScope` 连接真实调用与账务，不能用正文终态代替费用终态。Stripe 装配存在不证明真实支付已经开通或验收。 |
| 渠道接入 | `channel_gateway` + `ChannelGatewayApplication`；外围 `gateway/` | 主库持有一次性绑定、用户映射、渠道事件及执行关联；独立网关库持有 inbox/outbox、游标和投递状态。模型、私有资料权限和账务继续走主后端。 |

装配定位：[身份/材料](../backend/src/qunxue_api/bootstrap.py#L566)、[库/导入/项目](../backend/src/qunxue_api/bootstrap.py#L765)、[Agent](../backend/src/qunxue_api/bootstrap.py#L1061)、[记忆/写作/索引](../backend/src/qunxue_api/bootstrap.py#L1322)、[外部授权/订阅/渠道](../backend/src/qunxue_api/bootstrap.py#L1529)。检索责任见 [shared_knowledge.py](../backend/src/qunxue_api/adapters/research_agent/shared_knowledge.py)、[hybrid.py](../backend/src/qunxue_api/adapters/retrieval/hybrid.py)、[indexing.py](../backend/src/qunxue_api/adapters/research_materials/indexing.py)。当前 [EmptyKnowledgeCatalog](../backend/src/qunxue_api/adapters/empty_catalog.py) 不把历史公共 release 作为个人产品默认证据。

## Agent：执行、正文、回执分别拥有状态

1. **执行命令**：`POST /api/agent/turns` 使用 owner 范围的 idempotency key。租约有效的运行中请求或已完成的同键请求观察原 run；失败或租约过期后的重新执行仍需 POST 命令，不能由订阅自动触发。当前路由在响应消费前启动 daemon thread，并通过原租约和进程内取消登记监督执行。
2. **订阅与停止**：`GET /api/agent/runs/{run_id}/events` 接受 `after` / `Last-Event-ID`，只读已有事件；lookup 也是只读核对。断开订阅不等于取消。显式 `POST /api/agent/runs/{run_id}/stop` 申请取消；这不是强制终止任意同步工具的保证。
3. **正文保全**：run、output attempt、event cursor 与最终 turn 是不同身份。正常 journal 路径先独立提交再交付正文，后续较短/失败 attempt 不替换旧原文；`partial_answer` 只是兼容投影。日志写入失败时可向当前页面展示明确未保存的正文，不能承诺刷新或重启后恢复。来源失效仍须隐藏派生正文和重放。
4. **用量与结算**：`OperationScope.delivery_state` 分开暴露 output finish、usage、settlement、receipt persistence 和 quota 状态。当前新 `agent_turn`、`user_research`、`conversation_summary` 操作选择 `actual_usage_v2`；其他阶段与历史操作仍须按各自策略解释。缺失/矛盾用量是 pending，不能伪造成零；回执写失败只重试回执，不能因此重发模型请求。完整正文可与 pending/unsaved 账务同时存在；真实上游 length 仍是未完整输出。
5. **Runner 与工具事务**：`pydantic_runner.py` 保留模型选择、提示词/研究策略和编排；`model_protocol.py` 负责 SDK 协议，`stream_events.py` 负责响应投影，`tool_runtime.py` 负责运行内取消/工具结果交付，`tool_bindings/` 显式登记工具。非 web 工具在 SDK 中串行；五项共享 Session 业务命令经应用的 owner/run/lease/cancel fence 后提交，失败回滚当前命令，独立输出 journal、写作/记忆/账务作用域各自保留。后继 [同步工具所有权](../backend/src/qunxue_api/adapters/research_agent/tool_runtime.py#L50-L128) 将完整调用、回调和异常清理保持在 run-local owner 内：保留底层 executor Future，并在取消后等已开始的同步调用退出；尚未开始的排队调用不得再触碰依赖。Runner 的 [when_idle 轮询/检查点](../backend/src/qunxue_api/adapters/research_agent/pydantic_runner.py#L1103-L1111) 与工具启动共用锁，避免 Session owner 活跃时并发轮询或 checkpoint；这不是强杀同步线程或有界停机。起始职责与事务提取见 [执行边界](AGENT_EXECUTION_BOUNDARIES.md)，后继回归见 [工具生命周期测试](../backend/tests/test_agent_tool_lifetime.py)。
6. **前端会话边界与未完成恢复**：[PR #262](https://github.com/huyanxius/everplain/pull/262) 已实现 [会话控制器](AGENT_CONVERSATION_CONTROLLER.md)：控制器持有 run/attempt 身份及 observation generation，恢复 codec 与投影分离，显式命令 POST、只读恢复 GET、detach 和服务端确认后的 stop 各有边界；证据限于合成/UI 单元验证，不代表真实浏览器或 Provider 验收。HTTP 路由仍监督进程内线程；输出 journal、游标重连、工具事务提取及前端控制器没有实现任意工作流跨进程自动续跑，不能以取消权限/预算或抹去未知费用来实现“不中断”。

直接入口：[Agent HTTP 路由](../backend/src/qunxue_api/api/routes/agent.py#L467)、[run/attempt/event 领域数据](../backend/src/qunxue_api/modules/agent_conversation/domain.py#L73)、[账务作用域选择](../backend/src/qunxue_api/adapters/model/billing_operations.py#L44)、[计量与回执降级](../backend/src/qunxue_api/adapters/model/metering.py#L140)。已有回归分别覆盖 [原始正文与事务隔离](../backend/tests/test_agent_output_journal.py)、[断线/丢响应/多游标](../backend/tests/test_agent_event_reconnect.py)、[输出与账务状态](../backend/tests/test_agent_delivery_output_state.py)。专项说明见 [输出生命周期](AGENT_OUTPUT_LIFECYCLE.md)、[用量交付](AGENT_USAGE_DELIVERY.md)。

## 写作与渠道边界

写作 Agent 的 `validate_agent_context`、`read_agent_document`、`propose_agent_edit` 已通过 [PR #215](https://github.com/huyanxius/everplain/pull/215) 集中到 [WritingApplication](../backend/src/qunxue_api/application/writing.py#L238-L290)。预览和提议共用精确目标规则，保留 owner、文稿版本、UTF-16 选区、pending 及 run/lease 执行 fence；实时路径使用 pending 存在性/指定修订查询。完整历史接口仍存在，不声称整个数据库成本恒定。[写作页面重读](../frontend/src/app/writing/WritingDocumentPage.tsx#L115) 已复用初始读取流程，同时恢复文稿、修订和当前账号/文稿范围的本地草稿，拒收中止请求的迟到结果；读取本身不清除草稿。用例边界详见 [写作实时编辑边界](WRITING_EDIT_BOUNDARY.md)。

后继 [PR #275](https://github.com/huyanxius/everplain/pull/275) 和 [PR #277](https://github.com/huyanxius/everplain/pull/277) 将 `save_document`、`resolve_revision`、`create_sample`、`create_document` 四个具体命令收归应用层，保留原 operation target/payload、owner/version/idempotency、事务及 pending/显式接受语义；HTTP 传入普通命令参数，不再传这些 mutation 的仓储 callback。透明 CRUD 与历史读取不因此成为待包装的重构项。当前 [preview_edit_target](../backend/src/qunxue_api/application/writing.py#L323-L349) 仍逐片读取完整 `style_samples`；上述局部提取不构成整体 A04/B10 完成或生产性能/时延改善证明。

[ChannelGatewayApplication](../backend/src/qunxue_api/application/channel_gateway.py) 从已验证绑定确定用户，并调用同一 `runtime.run_turn`；平台请求不能自行指定站内用户、资料或模型。外围 [Worker](../gateway/src/everplain_gateway/worker.py) 分离 admission、GET 游标观察与 outbox 投递；每次受保护投递前回主后端确认授权，`dead` / `ambiguous` 不冒充成功或 exactly-once。源码已有条件部署接线，见 [网关部署说明](../gateway/DEPLOYMENT.md)；旧 [接入 checkpoint](architecture/channel-gateway-integration.md) 中“未接 CD”的陈述只描述其当时增量。凭据配置、实号绑定/收发、恢复与运维验收仍须另有证据。

## 前端与契约

当前 [App.tsx](../frontend/src/app/App.tsx#L286) 组合私有库、Agent、写作、项目工作区、设置和集成页面；`/shared/:libraryId` 与 `/discover/*` 对应显式分享/公开发布。旧 `/knowledge/*`、`/courses/*` 跳转个人库，旧研究步骤路径跳转项目工作区。受保护页面区分 loading、authenticated、anonymous、expired、error；客户端路由保护不替代服务端 owner 校验。写作文稿页已使用 [lazy/Suspense](../frontend/src/app/App.tsx#L47-L49) 及受保护路由内的 [PageLoading fallback](../frontend/src/app/App.tsx#L311)，不据此声称全部路由均已按需加载。

- 页面持有路由/导航与组合，模块从 `index.ts` 暴露产品能力；模块内部 API adapter 转换传输数据，不从公共入口泄露生成 SDK。
- **实际传输例外要明确**：`researchAgentApi.ts` 同时使用生成 SDK 与手写 `fetch`/SSE、lookup、cursor、stop。它和 `api/client.ts` 是现有守卫登记的 HTTP runtime adapter；不能据此在页面随处新增 `fetch`，也不能宣称现有全部调用均已生成化。
- [Agent 传输适配器](../frontend/src/modules/research-agent/researchAgentApi.ts#L348) 区分一次 POST 命令与 GET 重连，并按 event ID 去重；[公共入口](../frontend/src/modules/research-agent/index.ts) 经 [产品 gateway](../frontend/src/modules/research-agent/researchAgentGateway.ts) 对外提供调用。
- [前端边界策略](../frontend/scripts/check-module-boundaries.mjs) 登记模块依赖、API adapter 和传输例外；状态控制器、路由按需加载与真实浏览器故障矩阵的完成度不能由该静态检查推导。

契约方向保持 `Pydantic/FastAPI → backend/openapi.json → frontend/src/api/generated/`。接口改变后执行 `make contract`，连同后端提交生成差异，用 `make check-contract` 验证漂移；不要手改生成文件。验证按 [贡献规范](../CONTRIBUTING.md) 匹配影响面，文档修正无需冒充全量产品回归。

## 当前增量与仍开放的审计项

- **R01 材料生命周期**：当前 [bootstrap.py:701–749](../backend/src/qunxue_api/bootstrap.py#L701) 仍在装配时创建线程池，并单独登记 startup/shutdown handlers；不能写成候选的 lifespan 资源所有权、可终止 parser 与有界停机已经落地。
- **A01 引用边界已提取**：[PersonalDocumentEvidenceValidator](../backend/src/qunxue_api/application/personal_document_evidence.py) 通过 [装配绑定的窄查询](../backend/src/qunxue_api/bootstrap.py#L968) 校验个人文稿来源；个人库核对当前 owner/parse/segment/source ID，项目附件核对 owner/task/parse/segment 与字典 locator 的精确坐标。可选 task_id 必须匹配所属项目，未知字段和非精确数值类型被拒绝。
- **同基线的小切片**：[额度周期](../backend/src/qunxue_api/adapters/sqlite/quota_periods.py#L211) 保留同一会员期内 bank RESET 建立的续期锚点；[账务错误](../backend/src/qunxue_api/api/billing_errors.py) 不用单次失败推断整轮免费。[模型强度标签](../frontend/src/app/model-selection/reasoningEffortLabels.ts) 共用显示词表；[采集扩展](../extensions/clipper/src/transport.mjs#L52) 读取标准 error.message，并兼容旧 detail。
- **守卫与测试登记已有后继**：后端守卫已核对内部角色、静态可识别动态导入和模块依赖环；前端守卫已扩展 JS/TS 来源登记、动态导入与模块依赖环。这些是静态边界，不是运行时证明。[测试选择说明](TEST_SELECTION.md) 与 [登记检查器](../ops/cd/check_test_inventory.py) 已进入基线；在上述 `800ef6b` 固定源码中，产品清单有 200 个 selected 文件，另有 62 个 `baseline_review_pending` 和 3 个特殊排除，共 65 个 deferred；这些是静态清单文件数，不是收集用例数、执行通过数或全仓验收。
- **解析安全与生命周期分开**：[DOCX 样式限制](../backend/src/qunxue_api/adapters/research_materials/parser.py#L246-L261) 在读取 `word/styles.xml` 前核对解压大小；这没有实现 R01 的 lifespan、可终止 parser 或有界停机。前端会话控制器已有 [PR #262](https://github.com/huyanxius/everplain/pull/262) 的独立交付边界，其余候选与真实验收仍须各自核对，不能从局部展示、加载或测试登记改动推导为整体架构完成。
- **N03 / S01 已有实现**：N03 已从反射/黑名单改为 [显式导出清单](../backend/src/qunxue_api/adapters/sqlite/account_export_contracts.py) 与 [owner-scoped reader](../backend/src/qunxue_api/adapters/sqlite/account_export_reader.py)，保留原格式与历史归档；导出不等于注销/备份全审计。S01 的 [PublicHTTPTransport](../backend/src/qunxue_api/adapters/import_sources/public_http.py) 已接入书签导入，保留 TLS 并限定连接目标；只覆盖该调用方，代理兼容性及其他 fetcher 的范围见 [专项说明](architecture/bookmark-fetch-boundary.md)。
- **CI 与合并约束分开**：[Required checks](../.github/workflows/ci.yml#L129) 已汇总现有按路径选择的 jobs，[ci_gate.py](../ops/cd/ci_gate.py) 拒绝必需 job 失败/取消/异常跳过；这不是远端 branch protection 的配置或强制合并证明。后端 [product-suite.txt](../backend/tests/product-suite.txt) 是当前选集，不是测试全分类证明。
- **后续窄查询与命令**：[PR #264](https://github.com/huyanxius/everplain/pull/264) 为样文列表提供 owner-scoped 元数据投影，含 NUL 行保留字符计数回退；[issue #267](https://github.com/huyanxius/everplain/issues/267) 经 [PR #268](https://github.com/huyanxius/everplain/pull/268) 将首页文稿读取限制为 SQL `limit=12`，仍返回至多 12 份完整正文。记忆 [概览查询](../backend/src/qunxue_api/application/memory_overview.py#L157-L210)（[PR #279](https://github.com/huyanxius/everplain/pull/279)）持有 scoped 读取和交付前重验，[更新/删除命令](../backend/src/qunxue_api/application/memory_commands.py)（[PR #287](https://github.com/huyanxius/everplain/pull/287)）持有 mutation 作用域和提交后失效。[研究项目创建命令](../backend/src/qunxue_api/application/research_task_creation.py)（[PR #289](https://github.com/huyanxius/everplain/pull/289)）持有种子解析、入口状态/工具选择和标题回退，复用原 service 事务范围。各项只代表所述切片，不代表整体 A04/B10 或完整架构审计完成。
- **后续核对入口**：依赖/许可证/运行时分诊输入见 [架构记录索引](architecture/README.md#依赖许可证与运行时分诊输入)。
