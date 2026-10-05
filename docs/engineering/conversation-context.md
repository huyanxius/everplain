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

`EVERPLAIN_CONVERSATION_SUMMARY_ENABLED` 默认true，仅控制近期摘要后台及派生缓存读取，与控制长期自动提炼的 `EVERPLAIN_MEMORY_LEARNING_ENABLED` 独立。长期学习false时摘要仍可运行；两者复用同一60秒循环，但分别创建/调用自己的生成器。用户及项目的use_memory/learn_memory开关继续优先，摘要关闭时不读取原消息、不展示旧派生缓存或返回虚假pending。摘要独立使用 `EVERPLAIN_CONVERSATION_SUMMARY_IDLE_SECONDS`（默认60秒），最长5分钟防抖等待；长期Memory保持600秒，每日共享8次/64000token及全局计费风险门不变。打开摘要不打开长期自动学习。

失败仅在既有last_error字段及日志保存受控`stage:reason`，包括billing_open/billing_start/model/publish/settle，以及固定计费、网络、结构输出、用量、租约和存储类别；HTTP错误只保存100–599数字状态。异常消息、provider body、prompt、凭据与正文不进入诊断。预算拒绝仍终止同水位尝试。`summary_failed`不能证明已出网，缺phase/runtime可在调用模型前失败；真实根因仍需当前非敏感配置与operation/attempt记录核对。

摘要独立使用`conversation_summary`计费phase，现有CD只加其`operator`策略，不打开长期学习、不改变其他phase、价格或风险阈值；已存在不同计费模式时拒绝发布并要求核对。仅`billing_open:phase_policy_missing`及`billing_open:billing_runtime_missing`证明尚未创建operation/出网：当前未过期lease、来源指纹和本次预留的day/token/24000记录同时匹配时，事务CAS释放这1call/24000及1次未执行尝试，仍保留15分钟退避。未知、模型已执行、租约过期/替换、额度记录不匹配均不退款。现有summary JSON保存技术审计，生成/空历史不会抹掉旧补偿记录，模型不能写入且API不展示。

`ops/release_summary_reservations.py`仅针对已取证的2026-10-05两户旧前置配置失败，默认dry-run、显式manifest绑定来源/版本/过期retry/精确2calls/48000/2attempts和零用量/operation/attempt；任一前提不符整体拒绝，同plan审计幂等。apply须先核真实dry-run和已生效发布，再由唯一生产owner串行执行；不改账本、余额、未知风险或既有fence。

- 复用既有 memory 后台循环、配置好的同一模型端点和计费边界，不新增服务、provider、密钥、权限或每次页面打开的模型调用。新 `agent_conversation_summaries` 是每账户一个可重算派生缓存与租约，不修改长期 Memory。
- 最近最多6段会话，每段最多6个完整轮次，保留 user/assistant 角色；助手派生文本先经既有原文回读的资料删除与访问校验。模型不得将助手建议写成用户已确认决定，不从引文推断用户身份或敏感偏好。
- 按完整消息轮询选取多个会话，原始来源预算16KB UTF-8、完整模型输入22KB、最多1800输出token。超预算消息明确计入 omitted_messages；不把截断字符串冒充模型总结，不声称已读全部历史。弱来源允许summary和cards都为空。
- 新输入水位、标题、来源删除/权限变化及Memory开关改变都会使旧缓存失效。摘要空闲60秒，或最老未总结来源等待5分钟，且没有同账户运行中Agent、指纹改变时，后台进行一次结构化模型提炼；60秒调度周期，租约5分钟、重复指纹不重跑。持续完成新轮次不会无限后推防抖；运行中任务、预算、失败退避仍是安全围栏，不能称为5分钟内必定完成。失败保留预算、15分钟退避，最多3次同水位尝试；新水位可重试。
- 与长期学习共享每用户每日8次/64000 token默认上限，每次先保守预留24000，已知用量完成后回填；除上述可证明尚未出网的两类前置失败外，无法取得真实用量的失败不释放预留。参数复用现有配置。
- 模型输出短摘要及0–3个具体继续问题。每项必须有来源message ID、conversation ID和精确非凭据引文；结构化输出再次以当前owner可访问原文校验。不可用来源、泛化固定标题、无依据引文或凭据内容均丢弃；没有静态假卡回退。
- `GET /api/agent/context-summary` 读取缓存/重核来源并按既有机制失效过期缓存，不触发模型。返回ready/pending/empty/disabled/failed、部分来源覆盖信息、受控 `status_reason` 和可恢复时的 `retry_at`。日预算不足或同水位终止不再伪装为正在生成；有效lease优先于已预留预算，避免把在途生成误报额度耗尽。退避到期返回queued，由后台调度恢复；无generator没有承诺重试时间。首页与新普通Chat共享user-keyed React Query及同一组件；pending每15秒读缓存，可重试失败按retry_at读缓存（间隔15秒至15分钟），ready/empty/disabled/终止失败停止轮询。组件离开停止读取，不取消后台工作。选择卡片只填草稿，不自动发送。保留原来的“接着聊”会话入口。成功轮次、会话/项目删除会使前端相关缓存失效。
- 新模型轮次先使用真实结构化活动摘要和来源指针；细节仍需要search/read原文工具。两个工具已补入既有生命周期事件，事件只记录数量/游标/错误，不复制私密原文或检索词。

### 0570 迁移兼容证明

`test_conversation_summary_migration.py` 在合成0560库上真正SQLite backup到独立candidate，升级0570前后逐表保留账户、原文、账本、余额、计费operation及reset审计记录，旧列SQL继续改名/新建会话。降回0560仅删除派生缓存表；原文/旧writer新增写入、reset审计表及旧operation终态fence保持，源快照始终0560不动。0540→0550的既有真实兼容测试继续执行；无宽泛通配许可。

新增精确目标迁移树：b442b16d6a04b603fc22acfdee3f842242b215f1bedc35d1d02a34c8c733e93f。仅登记P0完整0560基线→0570这一条，保留既有0540→0550、0550→0560许可；其他来源、目标或逆向组合仍拒绝。后续修改迁移文件必须重新生成并验证精确指纹。

验证口径：合成源/注入模型输出测试验证后台缓存、隔离、预算、来源校验、取消/更正竞争、删除与开关；不代表真实provider质量、线上登录或浏览器全链路通过。真实模型与线上验收需在生产问题固定版本取证完成后的发布窗口独立执行。

独立只读审查后的修正：摘要指纹使用真实来源及控制/learn_after围栏，不使用自动Memory内容的通用version；自动学习不会导致相同消息重复付费总结。Memory使用/学习开关和手动增删改成功后立刻清除挂载的前端旧卡，后台读取重核权限。64账户候选上限之前已用SQL排除预算耗尽、运行中和最新活动未空闲的账户，弱来源存零调用水位，避免长期占用扫描窗口。引用保留原消息sequence，摘要上下文和卡片草稿携带精确回读位置，不需要从第0页逐条走到晚期消息。

已知BillingBudgetExceeded（包括SDK包装的cause链）会为当前来源水位终止自动重试，仍显示真实失败，不产生假卡或绕过现有全局风险预算。新来源可重新尝试；未知用量和通用错误继续保守保留预算。此阶段只允许PR/CI，真实模型和上线验收仍等待根因修复后的发布窗口。

### 挂起与恢复回归的边界

`test_conversation_summary_recovery.py` 在合成SQLite上重现预算48k时新来源清错后永久pending、15分钟退避到期、在途lease/预算竞态、终止尝试、60秒防抖与5分钟最大等待。真实OpenAI SDK/Pydantic结构输出/计量适配器通过合成HTTP SSE返回验证两段会话的3张有精确引文卡片进入唯一共享缓存，10条完整超长消息仍如实计为未纳入。这是离线链路证据，不是截图中10条消息的真实成因，也不是生产或真实provider通过。

16KB整体源预算会排除装不下的完整长消息，本原子修复仍有这个覆盖限制。不能以3张卡片或准确遗漏计数宣称完整历史已总结。后续完整覆盖方案需要以消息内容哈希和chunk游标缓存真实分块模型摘要，优先最新内容，在既有预留/日预算内渐进处理；最终合成仍核对精确原文引文和所有权，明示实际处理进度，来源删除/权限变更/更正使相关chunk失效。不能单纯扩大输入越过已核模型能力、把截断原文冒充摘要，或用模板填补未读内容。新派生缓存的兼容与恢复验收需单独验证。

### 动态摘要准入与逐lease用量回执

实际摘要生成器改按本次instructions、选中来源JSON、omitted计数和ActivitySummary结构输出schema计算调度预留：复用现有o200k近似上下文估计（25%余量及4096开销），加实际1800输出上限。这是对当前代理模型的estimate，不是已核provider tokenizer或费用；不改变模型、协议、源码16KB范围、输出上限、共享8calls/64k配置或最终wire现金/风险门。GET状态、候选预算检查和最终原子reserve CAS使用同一计算；没有估计器的历史/注入生成器保留24k兼容路径。

批次携带reserved_tokens/kind；已有summary JSON的私有audit按lease保存owner/day/来源fingerprint/精确预留及状态，无新表、迁移或队列。读取API不暴露技术回执，模型不能写入。已关闭回执最多保留64个，未解决回执保留；成功、失效及空历史处理保持既有审计。完成发布及空历史水位写入前取得SQLite写锁，避免并发旧lease结算被陈旧JSON覆盖。

发布资格与消耗计数独立：输出结构失败、来源更正/权限关闭/租约过期/替换或发布存储失败仍可能已产生真实用量。仅匹配精确owner/run/operation payload fingerprint且operation在success/error/cancelled/refunded终态，并检查全部attempt，才可结算：所有已知用量有usage_confirmed和合法非负整数时求和；权威not_sent与无attempt的本批已关闭operation证明本批未调用。active/paused、缺operation、未知/legacy/prepared/dispatch_started用量不减少预留；没有记录不证明历史聚合预留未出网。

回执状态CAS和MemoryUsage原子增量同事务：已知零用量结为零，超估计实际用量增加budget_tokens，真实调用保留call；严格证明未调用才减少自己的call/预留。旧lease结算只动自己的回执及日计数，不清新lease。当前未过期、精确审计匹配的缺phase/runtime前置失败仍可释放本批可变预留并保留退避。不会重写billing operation/attempt、余额、账本或现金风险记录；它们仍由既有计量结算维护。

`ops/inspect_summary_budget.py`在已安装后端环境、已核DB路径上使用SQLite mode=ro和query_only，仅选择唯一active admin，计算与运行时相同公式，输出数值/fit布尔和来源数量，不输出原文/账号ID/指纹/凭据。它不启动app、调用模型、claim、写库或释放旧预算。脚本的合成read-only字节hash及公式相等测试不等于真实生成验收。

`test_summary_adaptive_budget.py`覆盖calls2/48k旧未知预留不动、新估计可进入剩16k后通过真实SDK合成响应形成摘要+3张引用卡片；无效输出/发布失败的实际用量；已知零/超估计；新旧lease交错；终态/全部attempt证据拒绝；混合known/not_sent/unknown；精确前置释放；回执与计数回滚；持有历史48k时并发发布不得复活旧回执偷扣预算；账本不变及回执有界。模型HTTP均为离线fixture，不声称真实provider/生产已完成。
