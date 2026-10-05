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

## 0550 上线兼容性审查（Issue #134）

首轮 f85afe3 产物完整性/上传通过，既有兼容性门在停服务之前拒绝新迁移；公开健康仍为7150096，未开始迁移或替换服务。修复不关闭任何校验、不删除流水线状态、不修改生产库；仅增加下面这一条精确的迁移树转换许可。原 source-only 清单仍为空，其他来源、其他目标或逆向组合均拒绝。

- from（已验证线上源码7150096的0540树）：77b8a58a6c74b1981f9c04a19b6881d58a775548a3a06c217c2afa793a0eeda5
- to（f85afe3的0550树）：aa1c0493ac54be37884ba2ac2162595f32c0f704d9a78acc70976b45788922c1
- 计算范围与发布脚本一致：所有migration Python文件及schema/sqlite_index.py，按相对路径排序形成内容hash映射，再hash JSON。不是仅比较Alembic版本号。

实证（只用新建合成SQLite，不读取生产DB）：

1. 真正0540库先保留用户、对话原文、账本和余额、billing_operations以及生产reset脚本的schema-only审计表/精确旧operationID fence，SQLite backup到独立candidate路径。
2. candidate升级0550：旧数据逐表逐行保持；cache从原消息回填；原快照仍0540且未改写。
3. 从已上线7150096 Git对象提取完整旧backend/src，在独立Python进程、相同0550合成库上实际调用旧SqliteConversationRepository，读取、改名、追加轮次、新建会话全部通过；原消息保留。旧代码新建行的派生cache为{}，不会声称旧代码也会更新新摘要。
4. candidate降回0540：只删除新派生列，原消息/账户/账本/审计记录保持；新增加的旧式会话写入仍在。billing_precision_adjustments表和billing_reset_terminal_fence触发器SQL保持，旧operation终态更改仍被RAISE(ROLLBACK)阻止。
5. 再升级0550成功，原文及reset安全对象仍保留。自动部署依旧使用停写快照和独立新目标；不允许候选已接收写入后以旧快照覆盖新数据。

自动回归：test_conversation_context_migration.py与ops/tests/test_cd.py。该许可仅绑定以上已检查转换；未来env.py、检索SQLite schema或迁移文件变化都会改变目标指纹，不能沿用本许可。

## 0570：真实跨会话摘要与共享建议

补齐 Issue #134 的内容总结要求。0550 的摘录仍仅用于“接着聊”历史入口及无摘要时的检索线索，不能称为摘要或作为建议卡验收。

- 复用既有 memory 后台循环、配置好的同一模型端点和计费边界，不新增服务、provider、密钥、权限或每次页面打开的模型调用。新 `agent_conversation_summaries` 是每账户一个可重算派生缓存与租约，不修改长期 Memory。
- 最近最多6段会话，每段最多6个完整轮次，保留 user/assistant 角色；助手派生文本先经既有原文回读的资料删除与访问校验。模型不得将助手建议写成用户已确认决定，不从引文推断用户身份或敏感偏好。
- 按完整消息轮询选取多个会话，原始来源预算16KB UTF-8、完整模型输入22KB、最多1800输出token。超预算消息明确计入 omitted_messages；不把截断字符串冒充模型总结，不声称已读全部历史。弱来源允许summary和cards都为空。
- 新输入水位、标题、来源删除/权限变化及Memory开关改变都会使旧缓存失效。仅空闲达到既有 memory_learning_idle_seconds（默认600秒）、没有同账户运行中Agent且指纹改变时，后台进行一次结构化模型提炼；60秒调度周期，租约5分钟、重复指纹不重跑。失败保留预算、15分钟退避，最多3次同水位尝试；新水位可重试。
- 与长期学习共享每用户每日8次/64000 token默认上限，每次先保守预留24000，已知用量完成后回填；无法取得真实用量的失败不释放预留。参数复用现有配置。
- 模型输出短摘要及0–3个具体继续问题。每项必须有来源message ID、conversation ID和精确非凭据引文；结构化输出再次以当前owner可访问原文校验。不可用来源、泛化固定标题、无依据引文或凭据内容均丢弃；没有静态假卡回退。
- `GET /api/agent/context-summary` 只读缓存，不触发模型，返回ready/pending/empty/disabled/failed及部分来源覆盖信息。首页与新普通Chat共享user-keyed React Query及同一组件；选择卡片只填草稿，不自动发送。保留原来的“接着聊”会话入口。成功轮次、会话/项目删除会使前端相关缓存失效。
- 新模型轮次先使用真实结构化活动摘要和来源指针；细节仍需要search/read原文工具。两个工具已补入既有生命周期事件，事件只记录数量/游标/错误，不复制私密原文或检索词。

### 0570 迁移兼容证明

`test_conversation_summary_migration.py` 在合成0560库上真正SQLite backup到独立candidate，升级0570前后逐表保留账户、原文、账本、余额、计费operation及reset审计记录，旧列SQL继续改名/新建会话。降回0560仅删除派生缓存表；原文/旧writer新增写入、reset审计表及旧operation终态fence保持，源快照始终0560不动。0540→0550的既有真实兼容测试继续执行；无宽泛通配许可。

新增精确目标迁移树：b442b16d6a04b603fc22acfdee3f842242b215f1bedc35d1d02a34c8c733e93f。仅登记P0完整0560基线→0570这一条，保留既有0540→0550、0550→0560许可；其他来源、目标或逆向组合仍拒绝。后续修改迁移文件必须重新生成并验证精确指纹。

验证口径：合成源/注入模型输出测试验证后台缓存、隔离、预算、来源校验、取消/更正竞争、删除与开关；不代表真实provider质量、线上登录或浏览器全链路通过。真实模型与线上验收需在生产问题固定版本取证完成后的发布窗口独立执行。

独立只读审查后的修正：摘要指纹使用真实来源及控制/learn_after围栏，不使用自动Memory内容的通用version；自动学习不会导致相同消息重复付费总结。Memory使用/学习开关和手动增删改成功后立刻清除挂载的前端旧卡，后台读取重核权限。64账户候选上限之前已用SQL排除预算耗尽、运行中和最新活动未空闲的账户，弱来源存零调用水位，避免长期占用扫描窗口。引用保留原消息sequence，摘要上下文和卡片草稿携带精确回读位置，不需要从第0页逐条走到晚期消息。

已知BillingBudgetExceeded（包括SDK包装的cause链）会为当前来源水位终止自动重试，仍显示真实失败，不产生假卡或绕过现有全局风险预算。新来源可重新尝试；未知用量和通用错误继续保守保留预算。此阶段只允许PR/CI，真实模型和上线验收仍等待根因修复后的发布窗口。
