# 每轮模型与思考强度选择

## 交付边界

基于 billing PR #39 已核 head `603a6d4ccac26edf29b308693f0eefb9475fad56` 的增量补丁。
只实现前后端选择契约与经统一路由/计量的 Responses 协议，不读取或修改部署配置，不发真实模型请求，不宣称可直接上线。

前端独立控件位于另一个 UI 工作树的 `src/app/model-selection/`，不在本补丁中覆盖 composer。它复用共享自绘 Select；模型目录只显示 GPT 6 Luna；离散 range 的原厂能力为 none / low / medium / high / xhigh / max，默认 medium。两控件均有至少 44px 命中高度，range 保留原生键盘行为但使用自绘轨道/滑块，无动画。

## 最小接线

1. `GET /api/agent/models`（需登录）返回安全目录：`items` 与 `runtime_mode`，不返回 endpoint URL、密钥或供应商配置。
2. 真实目录从现有 primary endpoint 投影，只有明确 `agent_model_protocol=responses` 且 `agent_model_supported_efforts` 非空时开放。只接受现有 endpoint 的 `gpt-6-luna` / `openai/gpt-6-luna`，不让客户端指定任意供应商模型。
3. `EVERPLAIN_AGENT_MODEL_PROTOCOL` 默认 `chat_completions`，`EVERPLAIN_AGENT_MODEL_SUPPORTED_EFFORTS` 默认空数组。effort 子集是发布方对实际供应商/协议已核能力的登记，不是 SDK 通用枚举。没有新 base URL、API key 或账本配置来源。
4. 对 Modelink/Qiniu 两个文档化 host，从现有 `/v1` 基址派生同 host 的 `/bypass/openai/v1`。其他显式 Responses 路由复用其现有基址；SDK 拼接 `/responses`。不改变其他旧 Chat 调用路径。
5. 隔离 mock runtime 提供六档目录并明确 `runtime_mode=mock`，由确定性后端运行。它不是供应商连通性验证。
6. 前端通过模块公开的 `getAgentModelCatalog()` 读取 `{runtimeMode, models}`，把 `models` 传给控件 `catalog`。载入失败、空目录或当前选择失效时禁用选择提交；不要退回原厂全集冒充部署能力。
7. 每次 `streamAgentTurn()` 发送 `model_id` + `reasoning_effort`。旧客户端省略字段时，序列化也省略，保留原默认 runner 与 DeepSeek 等 fallback。服务端在 SSE/积分预留前拒绝未知模型、未登记路由、非法组合；请求中的 provider/key/base_url/raw model 等额外字段直接 422。
8. 显式 Luna 选择是严格模型策略，仅使用登记 primary，不静默切到 DeepSeek 或其他模型。临时失败返回错误。后续若要跨模型 fallback，应先设计用户能理解的显式策略与实际模型展示；不能用 Luna 标签掩盖替换。

## 恢复与并发

选择写入原始 run request_snapshot；恢复/研究确认继续使用原选择，而不是当前滑条。runner 是每轮局部对象，不修改 Settings 或共享默认 runner。传输重试保留同一个幂等键与请求体；模型校验失败不重试。

## Responses 与计量

- Pydantic AI `OpenAIResponsesModel` 负责工具/历史/SSE 协议，`_RetryingOpenAIResponsesModel` 仍经 `ModelRouteExecutor.execute_async` 执行每次请求，沿用 input/output/request 限额。
- `MeteredOpenAIResponsesModel` 在真正发出的 wire payload 上登记原有 `OperationScope` 的 attempt，包含 `api_type=responses`、实际 model、reasoning.effort、完整 payload hash；不增加独立结算链或最终重复扣费。
- `store=false`；不允许隐藏 server-side history、background、未定价内建工具或本桥接不能预算的多模态输入绕过预算。
- 只以完整 terminal response.usage 作为最终用量；in-progress 用量不累加。截断、失败、拒答、取消、缺失 usage、重复/越界终态、意外 EOF 失败关闭，保留原有未知用量/费用处理。
- 原 PR39 对缓存读/写子项缺失的政策仍保留：没有真实字段或发布方显式 zero-omission policy 时，不把缺失记零。
- 同时修复桥接内两个局部问题：异常结算前设置 stream done 防止重复 complete；图任务切换时按 provider_response_id 将输出校验重试关联回原 attempt，而不是只依赖不能跨任务回传的 ContextVar。

## 已核依据

- OpenAI Luna 模型能力（2026-10-02）：https://developers.openai.com/api/docs/models/gpt-6-luna 。支持上述六档，不含 minimal；函数工具使用非 none 强度需 Responses。
- Modelink 原厂路径：https://docs.modelink.ai/api-endpoints/overview 。该路径文档不是某账号所有档位的在线验收。
- SDK 为 `pydantic-ai-slim 1.107.5` / `openai 3.1.0`；用了与旧 Chat 桥同级的 private request hook。升级 SDK 必须重跑本补丁合成协议测试。

## 上线前置

- 发布方配置真实 Luna endpoint 与已验证 effort 子集、预算、价格别名和缺失 usage 政策；不得把 mock 或仅构建通过当作真实联通。
- 整合 billing 后续财务修正，尤其 business commit 与独立 finish 之间的崩溃窗口。本补丁不增加 operation 表，也没有修复该架构问题。
- 完成 390px / 44px 触控等最终页面集成验收，以及经用户授权、具明确预算的真实模型文本/工具/流式 smoke。
- 本补丁不部署、不迁移真实数据库、不改生产配置、不推送或合并 PR。
