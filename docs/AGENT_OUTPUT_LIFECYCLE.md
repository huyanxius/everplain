# Agent 原始输出与执行尝试

## 第一纵切

Logical run 仍沿用原有 owner、conversation 与 idempotency key。每次获得新的执行租约都会创建独立 output attempt；attempt ID 与 lease token 对齐。新 attempt 不覆盖旧 attempt 的原始正文。

AgentOutputEvent 以 (run_id, sequence) 唯一，保存 attempt_id、event name、原始 payload。assistant_delta 在独立 SQLite 事务中追加事件和更新当前 attempt 的文本投影，提交之后才调用 HTTP 回调。工具、最终回答或账务的回滚不能撤销已经交付的正文。旧 worker 的 lease 被替换后不能向新 attempt 写正文。

AgentRun.partial_answer 保留为兼容投影，不能作为唯一的历史正文来源。API 的 unfinished run、run lookup 与已完成 turn 都返回 output_attempts；UI 在继续或重试时显示上一次尝试的原文，并把新的流放在独立生成版本中。最终 canonical answer 不删除原始流式版本。

删除或无权访问的材料仍按既有规则隐藏衍生文本。该规则同样用于档案与事件重放；档案不是绕过来源删除权限的备份接口。

## 迁移与恢复

唯一迁移链：20261005_0600 → 20261005_0610。0600 来自已冻结的财务周期集成，必须先进入同一发布树。本改动不得另开 Alembic head。

0610 是增量表和增量序号列，不重写用户数据库。旧 partial_answer 仅保存为历史 attempt，不编造旧 delta/event cursor。降级不删除档案；需要回退代码时保留表，数据库恢复写入新目标。

## 第二纵切：订阅与执行命令分离

POST /api/agent/turns是显式执行命令，执行在响应被消费之前启动。已运行的同key命令只恢复snapshot/订阅，不等待失败后重新调用provider；失败后的明确POST才创建新的attempt。

GET /api/agent/runs/{run_id}/events接受after cursor或Last-Event-ID (run_id:sequence)，只从既有PK(run_id, sequence)索引按游标读取，硬上限每页200条。普通重连不重读旧全文；初始响应整体丢失时，先owner-scoped lookup恢复当前attempt的完整snapshot，再从对应cursor订阅。同event ID重放被去重，不做字符串前缀拼接。

断线、页面离开、pagehide和切换对话只结束订阅。取消执行仍通过独立stop命令。既有worker租约续期移到执行监督边界，连接不续租、不发cancel。旧queue和generator finally cancel已删除；租约、runner与账务身份不另造。

当前daemon worker/进程内显式cancel registry仍在，尚不是跨进程持久workflow。进程死亡后的step恢复、同步工具副作用边界和即时cancel由Pydantic原生DBOS adapter候选POC与同故障矩阵继续验收；不能把本纵切称为完整durable runtime。

## 存储降级

正常情况先commit再显示。journal写失败时，已收到合法正文仍传给当前订阅，以persisted:false和明确的‘正文未保存’提示展示，随后存储错误停止不安全的新操作。临时展示缓冲不构成durable replay，不保证刷新/进程重启后恢复；旧已保存attempt不被删除。失败/停止状态立即显示完整已收到正文，不让视觉pacing扣住长尾。客户端存在的未保存原文可在当前页面的后续生成中查看，明确标为未保存。

## 后续执行预算契约

保留普通12 model request/20 tool、深入48/100等无穷循环保护。本纵切没有取消工具权限或所有执行预算。UsageLimitExceeded仍需下一阶段转成明确的执行预算用尽原因、具体模式额度与保存后可继续策略，不能继续当作agent_unavailable。财务状态与正文终态通过OperationScope.delivery_state联合接口独立接入：usage_status known/pending、settlement_status settled/pending、receipt_persistence saved/unsaved、quota_exhausted，以及output_finish_reason。完整正文在usage pending或receipt unsaved时仍完成；真实length将run保留为interrupted而不写canonical完整turn，可以明确继续。状态通过独立agent_delivery_state事件保存，lookup、snapshot、完成turn和UI可读；用量记录未保存时明确提示，不能把未知usage伪造为0或额度用尽。预算真实耗尽沿已批准的‘额度已用尽，请等待 receipt’显示。

## 已验证范围

无网络真实 SQLite 故障注入：长 A → 短 B、B 无 token 失败、回调失败、另一连接在交付前读到正文、旧 lease fencing、完成后 canonical 与原始流不同、材料删除后的全 attempt redaction，以及旧正文迁移。

UI DOM 测试覆盖空/短/失败重试期间旧原文仍可见。构建与类型检查不代表真实浏览器或真实 provider 验收；真实浏览器与生产发布必须由获授权的 Mac 发布流程继续验证。


追加无网络验收：首响应整体丢失仍执行一次、真实StreamingResponse断线不取消、两个cursor订阅无新provider、末terminal frame丢失可读回、source owner隔离、显式stop、同event ID重复无正文重复、一次journal故障仍显示正文与未保存警告，以及真实SQLite业务事务rollback隔离。1000个单字delta事务本云单并发测得1.395秒；只说明该条件下没有病态卡死，不推断生产并发能力。


工具事件使用既有无活动工具的安全checkpoint：首个tool_started在业务写开始前可即时持久发布；并行工具批次的后续started/finished事件在全部工具业务函数返回后commit该批次，再通过独立journal连接发布。真实SQLite测试覆盖主Session未提交写时第二工具started及两工具finished，避免回调等待自身写锁或提交半成品。
