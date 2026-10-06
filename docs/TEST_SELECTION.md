# 测试选择与未验范围

2026-10-06，初始台账固定到 `9ccab4c92cafd2a6528c24aaaf446b6103918f01`。本次接入保留当前产品清单的全部新增登记，再并入下述 8 个已审文件；`billing/test_billing_api_errors.py` 已在产品清单中，因此仅移除其旧排除记录，其余排除文件的原哈希不变。这是一份选择契约，不是所有测试已执行的证明。

## 已接入的自动路径

- 后端产品回归：`backend/tests/product-suite.txt`。保留现有选择，补入本轮执行审查已通过的 8 个正文/重连/模型容量/路由/用量文件；Agent 重构另登记自己的新增测试。
- 发布安全：现有 backend job 始终执行 `ops/tests/test_*.py`。其中 `test_test_inventory.py` 校验整个仓库的测试命名路径，文档单独改动也不会绕过登记检查。
- 前端：现有 frontend job 按路径触发，执行边界自测、样式自测、Vitest、构建；同一 job 补回原来已有但未接线的扩展 Node 测试与 Bash 安装准备测试。没有新造平行 CI job。
- 网关：保留 `gateway/scripts/verify-local.sh` 的 pytest 单元与真实本地 HTTP 合同；合成账号/数据库/端点不能替代机器人实号验收。

`ops/cd/check_test_inventory.py` 对新未分类测试、失效 product 路径、重复登记、既 selected 又 deferred、失效 deferred 路径与已改内容的旧排除记录报错。自动发现范围与实际 runner 一致：例如 unittest 的直接 `ops/tests` 文件、扩展的直接 `test/*.test.mjs`，不能把未被 runner 收集的嵌套目录当作已覆盖。

## 发现规则与依赖安装

当前 `frontend/vite.config.ts` 没有覆写 include/exclude；Vitest 4.1.10 的默认 include 是 `**/*.{test,spec}.?(c|m)[jt]s?(x)`，exclude 为 node_modules 和 .git。已用该版本实际 `vitest list --filesOnly --json` 与登记范围逐文件比对。它是收集证明，不是测试执行通过。

网关 pytest 9.1.1 使用 `test_*.py` / `*_test.py`，并排除默认 norecursedirs（例如隐藏目录、build、dist、venv）；CI 显式执行 gateway/tests，另执行固定 HTTP 集成文件。分类器反映这些规则，不能把 `.test.py` 或被默认忽略目录中的文件当作已选中。升级测试runner或改变include/exclude/norecursedirs时，应重新核对并更新分类，不依赖未来版本恰好保持默认值。

CI frontend 的安装步骤执行 `make bootstrap`，其既有依赖包含 `bootstrap-clipper`，会运行扩展锁定 `npm ci --ignore-scripts`。`npm run build` 本身不安装扩展依赖。本地独立运行 `make check-frontend` 前先执行 `make bootstrap`，或至少 `make bootstrap-frontend bootstrap-clipper`；与其他检查一样，安装是显式前置步骤。

## 仍开放的存量

基线有 250 个后端测试文件，产品清单仅选择 141 个；不能将其余 109 个一概称为历史学科测试。补回 8 个后，剩余排除记录见 `backend/tests/deferred-suite.json`：

- `baseline_review_pending`：初始 100 个，移除已晋升的 billing API 错误测试后当前为 99 个，仍缺当前分类/执行证明，按原精确 SHA-256 登记待核验。它们可能混有当前产品、兼容研究与陈旧期望；这不是批准永久不测。
- `explicit_live_provider`：1 个真实模型验收依赖显式配置，不放进无凭据 CI。
- `platform_manual`：扩展 PowerShell 准备测试需单独执行；不假装 Linux Bash 测试就是 Windows 安装验收。
- `synthetic_browser_manual`：网关 Playwright 场景需要本地后端、网关和浏览器 fixture；当前合成 HTTP job 不代表浏览器场景跑过。

排除记录绑定文件内容，修改或删除后必须重新分类。晋升到产品清单时删除对应排除记录；不应通过批量更新哈希掩盖测试失败。存量 review_pending 没有清零前，不能宣称“所有测试已分类验收并全部执行”。
