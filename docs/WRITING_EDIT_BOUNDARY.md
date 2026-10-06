# 写作实时编辑边界

2026-10-06。保持 SQLite 模块化单体。本次只重构写作 Agent 的读取、目标证明与提议入口；HTTP、数据库结构、模型协议和用户接受流程不变。

## 原问题与现在的责任

原来 `WritingAgentTools` 直接读取 `application.repository`，并自己实施选区内唯一锚定；`WritingApplication` 在预览和最终提议中再次实施相近规则。预览为判断是否有 pending 修订而调用完整历史列表，列表又读取一次整篇文稿，并实例化所有历史修订及其 before/after 正文。

现在的调用边界：

- Agent 适配层只负责本轮 context/read-version 绑定、执行 fence 传递和本轮创建记录；只调用应用用例，不访问仓储。
- `WritingApplication.validate_agent_context` / `read_agent_document` / `propose_agent_edit` 负责应用编排、owner 读取、语义请求键和样文上下文。
- `modules.writing.resolve_edit_target` 负责唯一锚、UTF-16、原文一致、用户选区和插入/删除位置。不可变 `EditTarget` 是一次已读取文稿的目标证明，预览和最终提议共用它；它不是永久授权票据。
- SQLite 仓储提供 pending 存在性、pending ID 列表、指定 pending 修订完整投影。完整历史列表仍供用户历史界面使用；实时编辑不再读取它。

没有新增接口框架、缓存、服务、后台任务或数据库迁移。所有者和版本仍逐片读取；最终提议在原有写事务内重验版本、pending 和执行 fence，resolve 的 CAS 不变。ready 必须核对具体 pending 修订的完整公开投影、文稿、版本、before 和 after，不能用 exists 为 ready 背书。

## 幂等与一致性

选区内省略 offsets 的请求在计算持久请求键前解析成绝对 UTF-16 offsets，保持既有 `agent-writing:{run_id}:{sha256(payload)}` 身份及 request digest。相同修订的显式/省略 offsets 重试仍命中旧 operation。已接受后的精确显式重试仍可返回旧结果；这不会授权旧版本预览或再次写正文。

指定修订查询采用列投影，绕开 Session identity map 的旧对象状态。owner 和 document 都在 SQL 中约束；accept/reject、修改正文/选区后的旧 ready 数据不会因缓存对象而通过。样文不缓存：新增私有样文必须影响下一个片段的泄漏检查。

## 可测收益与限制

独立审查以相同 4KB 文稿、1KB 样文和 5 个预览片段，在基线 `72f4b6d0` 与候选树运行同一个 DB-API 结果计量探针：

| 历史修订数 | 原 streaming 返回文本字节 | 新 streaming 返回文本字节 |
| --- | ---: | ---: |
| 0 | 46,425 | 25,820 |
| 10 | 457,125 | 25,820 |
| 100 | 4,154,325 | 25,820 |
| 500 | 20,590,325 | 25,820 |

5 片段 SQL 从 20 次降至 15 次。500 历史的 ready 路径返回文本从 20,631,435 降至 66,925 字节。这里计量的是 SQL 返回文本的 UTF-8 字节数，不是磁盘 I/O、内存峰值或生产延迟；原有索引下 pending 不存在时仍可能扫描该文稿历史，不能宣称整个数据库成本恒定。样文仍每片段读取并校验，本轮不解决其线性成本。

独立差分覆盖 3,960 个输入组合：新旧成功集合相同，186 个成功结果及 operation key/digest 相同。拒绝路径有异常子类和中文提示统一：`EditTargetConflict` 仍属于 `WritingConflict` / `ValueError`，不改变允许/拒绝集合；不宣称错误字符串逐字等价。

## 回归与后续边界

当前全部 `test_writing*.py` 与架构测试离线通过：194 项，另在最终空 scope 拒绝收紧后复跑目标/架构 13 项通过。存在一条 SDK 的既有 event-loop deprecation warning。真实模型、浏览器和线上部署未运行，也不属于这份离线证据。

`test_writing_edit_boundary.py` 保护：无仓储适配层装配、共享目标解析、旧请求键兼容、历史不进入实时查询、跨 Session 状态变化、owner 隔离与新样文立即生效。它已加入产品测试清单；既有 preview/lease/cancellation/journal/concurrency 测试保持不变。

这不是完整 Agent 持久执行重构，也没有修复研究材料 R01 生命周期。下一切片应分别确定：材料解析的可终止隔离执行边界与 lifespan 资源所有权；Agent 自动故障恢复时的可安全重放步骤及不确定外部副作用。不能以线程等待超时声称挂住的任务已停止，也不能以已保存输出声称任意工具流程都可自动恢复。
