# Agent 原始输出与执行尝试

## 第一纵切

Logical run 仍沿用原有 owner、conversation 与 idempotency key。每次获得新的执行租约都会创建独立 output attempt；attempt ID 与 lease token 对齐。新 attempt 不覆盖旧 attempt 的原始正文。

AgentOutputEvent 以 (run_id, sequence) 唯一，保存 attempt_id、event name、原始 payload。assistant_delta 在独立 SQLite 事务中追加事件和更新当前 attempt 的文本投影，提交之后才调用 HTTP 回调。工具、最终回答或账务的回滚不能撤销已经交付的正文。旧 worker 的 lease 被替换后不能向新 attempt 写正文。

AgentRun.partial_answer 保留为兼容投影，不能作为唯一的历史正文来源。API 的 unfinished run、run lookup 与已完成 turn 都返回 output_attempts；UI 在继续或重试时显示上一次尝试的原文，并把新的流放在独立生成版本中。最终 canonical answer 不删除原始流式版本。

删除或无权访问的材料仍按既有规则隐藏衍生文本。该规则同样用于档案与事件重放；档案不是绕过来源删除权限的备份接口。

## 迁移与恢复

唯一迁移链：20261005_0600 → 20261005_0610。0600 来自已冻结的财务周期集成，必须先进入同一发布树。本改动不得另开 Alembic head。

0610 是增量表和增量序号列，不重写用户数据库。旧 partial_answer 仅保存为历史 attempt，不编造旧 delta/event cursor。降级不删除档案；需要回退代码时保留表，数据库恢复写入新目标。

当前第一纵切没有替换 HTTP 连接与 worker 的所有权关系，没有跨进程持久 workflow checkpoint，也没有引入新执行引擎。下一纵切使用同一事件表实现同 run cursor 订阅，删除盲重 POST 与断开连接自动取消。

## 已验证范围

无网络真实 SQLite 故障注入：长 A → 短 B、B 无 token 失败、回调失败、另一连接在交付前读到正文、旧 lease fencing、完成后 canonical 与原始流不同、材料删除后的全 attempt redaction，以及旧正文迁移。

UI DOM 测试覆盖空/短/失败重试期间旧原文仍可见。构建与类型检查不代表真实浏览器或真实 provider 验收；真实浏览器与生产发布必须由获授权的 Mac 发布流程继续验证。
