# 测试选择与未验范围

2026-10-06，初始台账固定到 `9ccab4c92cafd2a6528c24aaaf446b6103918f01`。Guard 接入保留当前产品清单的全部新增登记，再并入下述 8 个已审文件；`billing/test_billing_api_errors.py` 已在产品清单中，因此仅移除其旧排除记录，其余排除文件的原哈希不变。这是一份选择契约，不是所有测试已执行的证明。

## 已接入的自动路径

- 后端产品回归：`backend/tests/product-suite.txt`。保留现有选择，补入本轮执行审查已通过的 8 个正文/重连/模型容量/路由/用量文件；Agent 重构另登记自己的新增测试。
- 发布安全：现有 backend job 始终执行 `ops/tests/test_*.py`。其中 `test_test_inventory.py` 校验整个仓库的测试命名路径，文档单独改动也不会绕过登记检查。
- 前端：现有 frontend job 按路径触发，执行边界自测、样式自测、Vitest、构建；同一 job 补回原来已有但未接线的扩展 Node 测试与 Bash 安装准备测试。没有新造平行 CI job。
- 网关：保留 `gateway/scripts/verify-local.sh` 的 pytest 单元与真实本地 HTTP 合同；合成账号/数据库/端点不能替代机器人实号验收。

`ops/cd/check_test_inventory.py` 对新未分类测试、失效 product 路径、重复登记、既 selected 又 deferred、失效 deferred 路径与已改内容的旧排除记录报错。自动发现范围与实际 runner 一致：例如 unittest 的直接 `ops/tests` 文件、扩展的直接 `test/*.test.mjs`，不能把未被 runner 收集的嵌套目录当作已覆盖。

## O02/G05 局部晋升

在 Guard 清单及 #248 新增的 1 个工具生命周期测试文件后，再晋升 12 个完整文件，产品清单从 160 个增至 172 个，只移除这 12 个对应的排除记录，其余 90 个排除记录及原哈希不变。

- O02：`test_migrations.py` 的 16 项，修正默认数据库名为 `everplain.db`，验证离线迁移截至 0430 成功、全 head 明确拒绝；在线 schema 检查及既有 0630/0640 离线拒绝断言保留，未修改历史迁移。
- G05 当前/共享账务契约：weekly quota、quota settlement epoch、Bank RESET、signup allowance、prices、actual usage policy、retail projection、billing migration 共 8 文件、77 项。这不是当前 Agent-v2 全策略覆盖。
- 历史 `delivery_v1` 兼容：application metering、durable billing 共 15 项，另有 usage stability 的 2 项。后者仅修正旧 RESET fixture，使其向迁移创建的 11 列表写入具名列，17 条断言与 2 条 ledger INSERT 不变；不将历史退款期望改称当前 v2 行为。

本轮仅对以上 12 文件进行隔离合成验证：110 项通过，无跳过；两处修改的 Python 文件 Ruff、测试登记检查及其 5 项局部自测通过。已有 SQLAlchemy 互相外键排序警告保留，它不是 Alembic revision 图环。未执行真实模型、实际账号数据库迁移、全量产品回归、全构建或全架构验收。

## 剩余账务 10 文件局部晋升

在上述 172 文件后再登记 10 个完整账务文件，沿用同一后端 CI lane，产品清单增至 182 个；只移除对应 10 条排除记录，其余 80 条内容及 SHA-256 原样保留。其中 119 项为当前/共享边界或已明确的历史账务兼容，另 6 项为默认个人产品禁用的历史理论匹配内部兼容；没有恢复任何退休课程、公共目录、matching HTTP 路由或模型可见工具。

- 当前私库整理/索引及共享边界：course billing 3、course responses 5、financial faults 6、graph naming 4、legacy research API 4。`course_*` 是私库 `SharedDocumentRow` 处理链的内部旧名，不代表公共课程产品。Financial faults 混有当前 `actual_usage_v1` RESET 事务测试与历史终态/回执测试；legacy research API 的现有 `user_research` factory 实际使用 `actual_usage_v2`，但这只是该 API 局部验证。
- 历史账务/共享 SDK 兼容：cross-run refunds 26、phase billing 13、Responses metering 51、standalone billing 7。退款、拒绝和失败豁免相关断言明确来自 `delivery_v1` fixture，不宣称是当前 Agent v2 行为。该历史策略仍由已保存 operation snapshot 决定，不能因新策略而删除其精度、重放和事务回归。
- 历史理论匹配内部兼容：legacy research billing 6。保留的 tool registration → workflow → matching application 链不等于默认模型可见；当前 `EmptyKnowledgeCatalog` 使 `catalog_available=False`，prepare gate 隐藏 matching/confirmed-theory 工具，matching HTTP 路由亦未挂载。CI 只执行合成直接内部调用，保护保留实现的 owner/replay/fallback 边界，不扩大产品入口。

原 10 文件执行为 122 通过、3 失败，其中一条旧兑换故障注入还存在空通过。当时仅修改两测试文件：course Responses/Chat fixture 从旧 JSON 修成实际请求的 SSE 事件并保留全部原断言；financial faults 接真实迁移 RESET 写边界、专用异常、阻塞 reservation、回滚前后 8 张账务/审计表快照与旧 epoch 放行，保留原 balance ≥ holds 断言。两个提前 commit 负控制分别在 writer 锁隔离或财务状态快照断言失败。独立审查又要求补齐 SSE `function_call_arguments.done.name` 并对真实输出事件做严格 SDK schema 校验，以及加入 RESET 的 `billing_precision_adjustments` 审计表。

该独立审查阶段的验证账本：修订 1 的十完整文件一次执行 125 通过、无 skip；独审修订 2 后受影响 11 项再次通过，其余 114 项源码不变，未重复整个 125。独立审查修订 2 的定向 6 项及 4 项负控制按预期通过，单列记录，不累计到 125。两修订文件 Ruff、后续登记检查及既有 inventory 自测另留收据。空环境、DNS/外网 socket 禁用和合成临时 SQLite/SDK transport 不代表真实模型、生产数据库、浏览器、部署、全产品或架构全验收。

后续 CI [37540343270](https://github.com/huyanxius/everplain/actions/runs/37540343270) 暴露 phase billing 的三个真实进程退出用例依赖全局 `tests/billing` 导入路径，子进程未进入预期崩溃点。已审修复以显式文件路径和 `runpy` 启动同一测试函数，成为本组第三个修改的测试文件，不增加登记文件数；31 条断言、崩溃函数与真实退出码 73 保持不变。该修复在最小 CI 环境单列 13 项通过，独审 26 项及异工作目录/含空格路径的 3 个真实子进程退出检查通过；这些结果不累计到旧阶段的 125，也不替代最终组合提交的正常 CI。

## 发现规则与依赖安装

当前 `frontend/vite.config.ts` 没有覆写 include/exclude；Vitest 4.1.10 的默认 include 是 `**/*.{test,spec}.?(c|m)[jt]s?(x)`，exclude 为 node_modules 和 .git。已用该版本实际 `vitest list --filesOnly --json` 与登记范围逐文件比对。它是收集证明，不是测试执行通过。

网关 pytest 9.1.1 使用 `test_*.py` / `*_test.py`，并排除默认 norecursedirs（例如隐藏目录、build、dist、venv）；CI 显式执行 gateway/tests，另执行固定 HTTP 集成文件。分类器反映这些规则，不能把 `.test.py` 或被默认忽略目录中的文件当作已选中。升级测试runner或改变include/exclude/norecursedirs时，应重新核对并更新分类，不依赖未来版本恰好保持默认值。

CI frontend 的安装步骤执行 `make bootstrap`，其既有依赖包含 `bootstrap-clipper`，会运行扩展锁定 `npm ci --ignore-scripts`。`npm run build` 本身不安装扩展依赖。本地独立运行 `make check-frontend` 前先执行 `make bootstrap`，或至少 `make bootstrap-frontend bootstrap-clipper`；与其他检查一样，安装是显式前置步骤。

## 仍开放的存量

基线有 250 个后端测试文件，产品清单仅选择 141 个；不能将其余 109 个一概称为历史学科测试。Guard 补回 8 个、O02/G05 后续晋升及剩余账务 10 文件登记后，剩余排除记录见 `backend/tests/deferred-suite.json`：

- `baseline_review_pending`：初始 100 个，移除已晋升的 billing API 错误测试后为 99 个；O02/G05 的 12 个后为 87 个，本次再晋升 10 个后为 77 个，仍缺当前分类/执行证明，按原精确 SHA-256 登记待核验。它们可能混有当前产品、兼容研究与陈旧期望；这不是批准永久不测。
- `explicit_live_provider`：1 个真实模型验收依赖显式配置，不放进无凭据 CI。
- `platform_manual`：扩展 PowerShell 准备测试需单独执行；不假装 Linux Bash 测试就是 Windows 安装验收。
- `synthetic_browser_manual`：网关 Playwright 场景需要本地后端、网关和浏览器 fixture；当前合成 HTTP job 不代表浏览器场景跑过。

排除记录绑定文件内容，修改或删除后必须重新分类。晋升到产品清单时删除对应排除记录；不应通过批量更新哈希掩盖测试失败。存量 review_pending 没有清零前，不能宣称“所有测试已分类验收并全部执行”。
