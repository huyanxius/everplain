# 最近对话与按需回读

关联 Issue #134。

## 选择和边界

保留现有会话、长期 Memory、资料索引的职责。最近活动不是新增长期记忆：不推断偏好、待办或已完成事项，不覆盖既有 memory key。现有 planner 已生成语义标题；近期卡片复用标题，加真实用户摘录，并明确 `kind=user_excerpt`，不称为模型语义总结。首版零新增模型调用，无 embedding 服务或新依赖。

持久缓存位于现有 `agent_conversations.context_digest` JSON 列。完成轮次写入时同事务合并最近三条用户摘录，各最多360字符、带message ID和sequence；失败回滚不留下虚假进度，重复/旧sequence不回退。与消息/会话同库，进程重启不失效，不通过首页登录触发生成。迁移只分批重建现存用户摘录，未来内容每轮完成即增量更新。

标题仍读既有会话字段，重命名即时生效。只缓存用户文本，避免旧回答中已删除资料的派生内容残留到卡片。缓存是可重算阅读辅助，不是新的事实来源。首页读专用轻量API，不加载完整会话历史，不再展示预设问题按钮。

## 检索与隐私

- 当前登录用户ID由服务端绑定，模型不能选择owner；缓存读取、原文读取、搜索均检查owner。
- 模型先读最多2200 UTF-8字节近期提示，再按需 `search_conversations`（搜索历史用户问题/标题）与 `read_conversation`（逐页读原始用户/助手内容）。全文搜索首版为SQLite字面匹配，非语义搜索；带分页，不假装已读完。
- 原文页最多600字符，可按sequence和字符offset继续长消息；每轮search/read共8次、24KB UTF-8序列化输出预算，每响应不超过6KB。预算耗尽明确返回错误。
- 复用现有Memory的 `use_memory` 控制模型跨会话读取；首页历史卡片属于用户自己的会话列表，仍可查看。每次读取重新检查设置，禁用不是仅隐藏工具。
- 对话/账号删除后缓存随行删除；下一次上下文构造/读取重新查库，不保留全局进程缓存。助手原文复用现有资料权限/删除检查，已删或不再允许的资料派生回答被隐藏。引用/历史内容不授予工具操作权限。
- 明确将历史JSON视为不可信数据，当前请求优先，不把旧指令、标题或摘录作为执行命令或研究证据。复用既有凭据脱敏。摘要不会吞掉原文，相关细节应回读来源。
- API响应 `Cache-Control: private, no-store`；前端query以用户ID隔离且每次进入首页重新取缓存。

## 公开实现参考

仅借鉴设计边界，不引入第二套框架：

- [LangChain short-term memory](https://docs.langchain.com/oss/python/langchain/short-term-memory)：线程状态与跨线程长期记忆分离，按预算决定裁剪/总结，而不是每次读都生成摘要。
- [OpenAI conversation state](https://developers.openai.com/api/docs/guides/conversation-state)：显式对话状态可保留连续性。
- [OpenAI compaction](https://developers.openai.com/api/docs/guides/compaction)：面向长上下文的压缩与产品可读卡片职责不同；加密压缩结果不能直接当首页活动摘要。
- [Claude Code memory](https://code.claude.com/docs/en/memory)：短索引与按需读取具体内容，可借鉴检索分层。

后续仅在摘录明显不能满足近期复杂项目连续性时，评估复用现有异步worker做有预算的增量语义摘要；不为实现“总结”标签新增每轮付费调用。
