# Agent 上游能力与输出参数

## 已核事实（2026-10-05）

当前七牛路由 `https://api.qnaigc.com/v1`、Chat Completions、
`deepseek/deepseek-v4.1-flash` 使用七牛自己公布的能力。
[七牛模型广场](https://www.qiniu.com/ai/models) 的页面内 `__NEXT_DATA__`
对应精确 model ID 的 `model_constraints`：

- `context_length = 1000000`
- `max_tokens = 384000`
- `max_completion_tokens = 0`
- `max_default_completion_tokens = 0`
- 已公布别名 `deepseek-v4.1-flash`
- 已公布协议 `openai-chat`、`anthropic-messages`

零字段表示此目录没有提供该能力/默认值，不能解释为无限，也不能据此
推断 Responses 路由支持。
[七牛 FAQ Q29](https://developer.qiniu.com/aitokenapi/kb/13462/aitoken-use-faq)
明确 1M 是 1,000,000 token，Q30 明确以七牛接口返回为准。
[七牛 Chat 参数说明](https://developer.qiniu.com/aitokenapi/13390/chat-completions)
允许省略 `max_tokens`，但默认值仅写“模型默认值”。因此此模型显式发送
已公布的 384000；不依赖未知默认值，也不把 2400 换成另一产品自设小上限。

DeepSeek 自己的 `api.deepseek.com` 路由单独使用
[DeepSeek 模型文档](https://api-docs.deepseek.com/quick_start/pricing/)。它明确
`deepseek-flash` 及临时兼容的 `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp`
为 V4.1 Flash，支持 1M 上下文、384K 输出和 Chat / Responses。此证据不外推
到别家同名模型、七牛 Responses 或其他代理 URL。

## 实现边界

- 删除 Agent runner 的固定 2400 输出参数，以及 Chat/Responses bridge 对
  shared router 的 3000 `min()`。输出参数来自准确上游 route 的能力。
- 删除 Agent 发送前 `o200k × 1.25 + 4096` 输入估算硬拒绝。实际上下文物理
  边界由 provider 校验；不以不准确估值拒绝有效资料。
- `context_window_tokens` 是能力元数据，不是新的本地拒绝阈值。估算函数
  保留供观测/兼容测试，生产 Agent admission 不调用它。
- 未知模型能力保持未知；SDK 请求不补一个产品固定小输出值，不自动换模型。
- 显式选择、默认路由与 fallback 分别解析自己的 URL / protocol / model。
  不将 primary 的能力或思考参数泄漏到另一个模型。
- 既有 owner / 工具权限、工具业务规则与调用次数未改变。独立知识整理、
  后台任务与结构化业务调用的资源策略不由此模块改动。

## 显式能力配置

`EVERPLAIN_AGENT_MODEL_CAPACITIES` 是 JSON 对象，键为
`完整base URL|chat_completions或responses|精确model`。例如：

```json
{
  "https://provider.example/v1|responses|verified-model": {
    "context_window_tokens": 160000,
    "max_output_tokens": 64000,
    "output_token_parameter": "max_output_tokens",
    "source": "https://provider.example/docs/verified-model"
  }
}
```

这些数字必须是该 provider 的真实能力，例子不是推荐值或实际模型证据。
需要完整 source，整数必须为正，output 不得超过 context；URL 与协议隔离。
`output_token_parameter` 必须为该上游支持的真实 wire 参数：Chat 选择
`max_tokens` 或 `max_completion_tokens`，Responses 选择 `max_output_tokens`。
PydanticAI 1.107.5 的内部 `max_tokens` 设置默认发送 Chat
`max_completion_tokens`；七牛/DeepSeek 已核 Chat 路由只发送文档中的
`max_tokens`，不同时发两个互相竞争的上限。显式配置可更新过时的内置快照。
没有远程请求、密钥或自动目录变更。

## 发布阻塞与验收范围

本能力层不能单独上线。当前计费 `before_attempt_payload` 还要求 wire 中
finite output cap，并按完整 input/output potential 申请预留。384000 上游
cap 与用户剩余额度/全局风险预算耦合，会在 dispatch 前拒绝正常请求；未知
cap 的省略也会被当前计费层拒绝。必须与实际用量账务解耦接口、已收到正文
独立持久化一起集成，真实确认用量耗尽时停止后续步骤，保留已输出正文并提示
“额度已用尽，请等待 receipt”；未知用量不能当作耗尽。这里没有改费率、
抬资金预算、绕过保护或声称财务策略已完成。

自动测试使用真实锁定 SDK 与合成 HTTP，覆盖长输入、超过原 2400/3000 的
完整正文与 wire 参数，不产生真实采购费用。通过不等于真实模型、生产费用
结算、浏览器或 1M 输入全链路验收。
