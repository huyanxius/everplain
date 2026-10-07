# 架构记录索引与有效性

2026-10-07，源码核对基线 `027e878909bf888065c45f23c58fca9fe70cac7b`（tree `bbe14fa0d89fe5d5326c429b6ea252e9c78b8423`），接续原 `20f764f` 文档。当前职责入口是 [ARCHITECTURE.md](../ARCHITECTURE.md)。本索引澄清历史记录的适用范围，不新增基础设施决策，也不将计划、代码、测试、合并和上线合并成一种状态；冻结源码基线不证明当前线上版本。

## 历史决策的现行解释

[DECISIONS.md](../DECISIONS.md) 是只追加的 2026-07-28 记录，保留原文；以下逐项说明哪些部分仍有效、哪些已被当前实现取代。

| 原决策 | 当前有效性 / 取代依据 |
| --- | --- |
| 沿用现有协作仓库 | 原基座仓库选择是历史事实；当前仓库/产品隔离以 [AGENTS.md](../../AGENTS.md) 的独立 Everplain 要求为准，不据旧记录连接其他产品。 |
| 首个架构增量 | React → API → 模块 → SQLite 的方向继续有效；“其余模块只有契约”的阶段完成度已由 [当前能力表](../ARCHITECTURE.md#能力与数据责任) 取代。 |
| 技术栈 | React/Vite、FastAPI、SQLAlchemy/Alembic/SQLite 继续使用；“认证、多用户另行设计”只描述首期，当前已装配身份/账号作用域和个人资源。单实例约束仍在，不推导为多实例能力。 |
| 业务模块边界 | 公共入口和领域责任继续有效；只有四个后端模块/两个前端模块的清单已过时，以当前能力与源代码守卫的登记为准。 |
| 契约与运行边界 | OpenAPI 单向生成仍有效；“首期同步完成”不能覆盖当前线程执行、导入 scheduler、租约与 journal。已有输出恢复也没有取代任意工作流自动续跑的未完成状态。 |
| 模块交接与人工门禁 | 版本/来源快照和显式确认仍是兼容研究流程约束；其完整性不能外推到全部 Agent 工具，也不规定个人产品必须经过固定学科步骤。 |

## 专项记录的范围

- [写作实时编辑边界](../WRITING_EDIT_BOUNDARY.md)：当前基线已含用例/目标规则/窄查询实现；该文测试数与性能数据属于所述切片及测量条件，不是新一轮全仓、生产或浏览器认证。
- [Agent 执行边界](../AGENT_EXECUTION_BOUNDARIES.md)：协议、事件、工具运行与显式绑定已进入基线；其起始提交/合成测试是该增量的历史证据，后继同步工具 owner、取消等待及 `when_idle` 互斥见 [当前 Agent 说明](../ARCHITECTURE.md#agent执行正文回执分别拥有状态)。这些证据不能替代完整 provider/浏览器或部署验收，也没有实现任意同步工具的强杀或有界停机。
- [账号导出](../ACCOUNT_DATA_EXPORT.md)、[书签连接边界](bookmark-fetch-boundary.md)：N03 显式导出与 S01 书签 transport 已进入基线；各自排除项、兼容要求与验证限制继续有效。
- [Agent 输出生命周期](../AGENT_OUTPUT_LIFECYCLE.md)、[用量交付](../AGENT_USAGE_DELIVERY.md)：解释现有 journal、订阅和独立账务状态；其中未来 DBOS/自动恢复描述是候选方向，未构成当前 runtime。
- [渠道接入 checkpoint](channel-gateway-integration.md)：保留当时来源、许可证核对及合成验收记录；其中未改 CD 的陈述已被后续 [网关部署接线](../../gateway/DEPLOYMENT.md) 和 [网关 README 的 2026-10-05 追加](../../gateway/README.md#2026-10-05-主线接入) 更新。代码接线不证明机器人实号在线。
- [机器人选型研究](bot-gateway-research.md)：历史选型材料，平台能力/权限和许可证需按实际采用版本复核，不是今天的全平台支持承诺。
- [HANDOFF.md](../../HANDOFF.md)：2026-09-12 当轮交付与验收记录；不将其当时“未配置公网/支付”的环境状态或历史测试数复用为当前部署事实。

A01 来源校验/字典 locator、写作页面重读保留草稿、bank RESET 续期锚点、模型强度标签、账务错误提示及采集扩展标准错误读取继续保留；同步工具所有权、守卫扩展、测试登记、文稿页按需加载与 DOCX 样式大小限制已进入本基线，源码入口见 [当前架构](../ARCHITECTURE.md)。[测试选择与未验范围](../TEST_SELECTION.md) 区分当前产品、保留内部兼容与待审存量：196 个 selected、63 个待审和 3 个特殊排除不是全仓执行证明。R01 生命周期、前端控制器及其他候选仍须独立核对；没有因这些局部增量完成整体架构审计。CI 最终汇总 gate 已存在，仓库保护仍是独立配置。

## 依赖、许可证与运行时分诊输入

本次只核对下面输入及已有说明，**没有**运行新的联网 advisory 扫描、全依赖许可证枚举或镜像扫描。不存在可从本文推出的“零漏洞”“许可证全部闭合”或“运行时警告已清零”结论；旧 high 数量和旧审计成功不沿用。

| 范围 | 应固定的实际输入与核对重点 |
| --- | --- |
| 后端 | `backend/pyproject.toml`、`backend/uv.lock`、`backend/.python-version`；直接依赖包含 `pydantic-ai-slim`、原生模型 SDK、解析器与网络客户端。应从锁文件展开传递依赖与适用 extras，区分生产/开发和可达入口。 |
| 外围网关 | `gateway/pyproject.toml`、`gateway/uv.lock`；`aiogram==3.31.0`、`lark-oapi==1.7.3` 与后端独立环境，不能只扫描后端后声称网关已覆盖。 |
| Web/扩展/浏览器验收 | `frontend/package.json` + `package-lock.json`；`extensions/clipper/package.json` + `package-lock.json`；`gateway/browser/package.json` + `package-lock.json`。分别记录运行产物、打包链与测试工具依赖。 |
| 构建/运行工具 | `.github/workflows/*.yml`、`ops/api.Dockerfile`、`ops/web.Dockerfile`、`gateway/Dockerfile`、发布构建脚本及该次 manifest/digest。基线 API/CI 使用 uv `0.11.29`，gateway Dockerfile 使用 `0.12.19`；应核对是否有意及各自锁兼容性，差异本身不是漏洞证明。Python/Node/Nginx 基础标签不能代替实际镜像 digest。 |
| 复用代码与许可 | [third-party-notices.md](../third-party-notices.md)、`third_party/openai-codex/{README.md,LICENSE,NOTICE}`、所锁定 wheel/npm 分发许可及实际再分发方式。现有说明覆盖 Codex 提示词片段、STORM/LangChain 搜索片段与网关两项 SDK 的局部归属，不能代替全依赖许可证清单；网关 SDK 许可核对依据保留在 [checkpoint](channel-gateway-integration.md#source-and-dependency-provenance)。 |
| 版本敏感边界 | [dispatch.py](../../backend/src/qunxue_api/adapters/model/dispatch.py#L60) 的“确定未发出”判断明确依赖 stock HTTPX `0.28.1` / HTTPCore `1.0.9`；升级需保持未发送/可能已发送/已收到回执反例，不可只为清告警盲目更新。写作说明中的 SDK event-loop 弃用警告是旧切片观测，应以当前精确测试输出重新分诊。 |

后续分诊最少留存：源码/锁/工具及镜像身份、扫描器版本与时间、advisory ID/受影响版本、生产可达性、许可证/NOTICE 义务、修复或例外理由、负责人和复核期限。没有新扫描与可达性证据前不自动 `audit fix`、换 SDK、迁库或删依赖。
