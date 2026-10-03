# Everplain 应用设计与功能保全

依据：`feat/design-tokens` / `0f47e0f`，整站 `mock.html`。mock 决定视觉；现有应用决定功能、权限、数据与恢复语义。先在本地 mock 后端预览，用户确认整个前端后再真实集成及发布。此文档同步实施更新，不再等待单独文档审批。

## 范围

- 官网 `/`、`/welcome` 的 `FoundationPage` 由 `feat/landing-redesign` 负责。`src/app/foundation/` 全目录、`App.tsx` 的这两条路由和 `productHome` 不改、不删、不挪。
- 官网仍使用 `@paper-design/shaders-react`，保留该依赖及 Foundation 的两个 shader。应用内删除 shader；最终审计明确排除官网。
- `/app` 主体已完成，仅统一按钮与侧栏；`/welcome/setup` 是本任务的完整引导流程。
- 共享 tokens/components 可以调整，影响官网的部分在 PR 注明。不得修改官网源文件来抵消影响。
- 不读取模型密钥，不改后端接口、资源权限或保存语义；本地 mock 通过不等于真实业务通过。
- 不截图、不录屏。浏览器通过 DOM、计算样式和真实交互验收，视觉判断交用户。

## 设计规则及 mock 实例

| 规则 | 实施含义 | mock 中的落点 |
|---|---|---|
| 中性底色，颜色传达事实 | 控件不按页面发明品牌色。角色、状态和数据类别才有彩色。 | Library 的 `TopicChip` 只标主题；主操作 `qx-btn--primary` 使用 `--qx-color-accent`，表面是 canvas/surface。 |
| 内容用衬线，操作用无衬线 | 标题、原文、文稿和 Agent 回答是阅读层；按钮和元数据是操作层。 | Agent 的 `qx-prose` → `--qx-font-reading`；Material 的标题与正文，导航 `qx-item` → `--qx-font-ui`。 |
| 圆角按对象 | 单行控制 pill；菜单行 item14；卡片20；多行 field24；抽屉28；弹窗32；细标记4。 | Login 的 `qx-input`、Settings 的 `qx-modal`、Agent 的 source drawer、Library 的 `qx-card`。 |
| 表面、阴影和留白形成层次 | 不用每层一圈硬边框。可点卡片 hover 只浮起2px。 | `MaterialCard` 的 `qx-card--interactive`、Composer 的 `--qx-shadow-composer`、Dialog 的 `--qx-shadow-panel`。 |
| 每页一个主焦点 | 主按钮表达当前主要动作；附属操作为 secondary/ghost。空态给角色、问题和输入。 | Agent 空态 `AgentAvatar + qx-display + Composer`；Library 添加是主操作，视图切换是分段控制。 |
| 文字必须增加信息 | 删装饰眉标和重复功能口号；元信息不低于13px。保留错误、权限、费用及结果边界信息。 | mock `PageHead` 只有标题和操作；`qx-meta` 使用 `--qx-text-meta`，不采用旧大写眉标。 |
| 角色贯穿产品 | 读取同一账户的 Agent 档案；问候greet、思考think、导入/生成work、平时idle。 | Setup 四步和 Agent 共用 `AgentAvatar`；Shell 底部是同一角色。空名称须有可读回退，不能复制 mock 的空名缺陷。 |
| 对话以回答为主 | 用户右灰气泡；Agent 左32px角色+无气泡衬线正文。编号与来源一一对应，打开右侧原文不重建对话滚区。 | `#/agent/c1`、`qx-bubble`、`mk-turn`、`qx-cite`、`SourceDrawer`；多行 Composer 从pill变panel。 |
| 侧栏稳定且完整 | 展开260、收起72；灰底选中，无描边。主导航、项目/会话、通知、账户和角色均可到达。 | `MockApp.Shell` / `.mk-sidebar`；真实 `railContent`、通知三类、退出和视图切换补入同一框架。 |
| 版面有固定尺度 | 普通内容最大1120、阅读72ch；区块40–48；卡片auto-fill最小260。工作区允许占满可用空间。 | `.mk-page`、`.mk-grid--cards`、`.qx-prose`；研究 `.mk-ws__body` 大纲/文稿/右侧资料。 |
| 动效只给操作反馈 | 保留 hover、弹层、进度与角色动作；删除应用背景 shader 和无任务意义的氛围动画。 | Composer圆角过渡、导入进度、Drawer打开；官网为明确例外。 |
| 手机重新排版 | 390px下侧栏为抽屉，来源在底部，工作台首要文稿，一列网格、16px边距。功能通过明确切换仍可达。 | mock760px媒体查询；必须补关闭drawer的inert/焦点恢复，而非只transform藏在屏外。 |

## 真实路由 → 页面模式

| 路由或状态 | 模式 | 参照或推导 |
|---|---|---|
| `/app` | 问候+输入+真实资料卡 | Home；仅按钮/侧栏，保留 `seedAgentDraft` |
| `/agent` 空态 | 居中角色与输入 | Agent空态；原提示选择、来源、联网、scope、模式和附件保留 |
| `/agent?conversation_id=…` | 对话+右来源抽屉 | Agent对话；所有恢复/会话/项目控制复用原控制器 |
| `/research/materials` | 研究/文件/记忆列表 | ResearchList、Library；保留真实tab、筛选、上传及记忆 |
| `/research/new` | 问题/Agent与画布 | Agent空态、Research三栏；不能伪造研究确认阶段 |
| `/research/existing` | 单列研究入口 | Setup式流程，沿用原材料与研究建立语义 |
| `/research/:task_id` | 服务端导航入口 | 保留原 resume/navigation 重定向 |
| `/research/:task_id/workspace/:tool?` | 三栏工作台 | ResearchWorkspace；7工具与文稿版本/导出保留 |
| `…/phenomenon`、`…/match`、`…/framework`、`…/method` | 兼容入口 | 保留原 LegacyResearchWorkspaceRedirect，不恢复独立旧皮肤 |
| `/library` | 私有库卡片列表 | Library；保留真实库层级，不改成假平铺全部资料 |
| `/library?kb_id=…` | 库内材料列表 | Library卡片/上传状态；名称、配额、三阶段状态与重试 |
| `/library?kb_id=…&document_id=…&segment_id=…` | 阅读+知识/Agent侧栏 | Material；保留真实查询定位，不另造无数据的 `/library/:id` |
| `/library/knowledge?kb_id=…` | 库级图/列表+证据 | Graph+Material，不混成个人总图 |
| `/my/graph` | 个人图谱+来源面板 | Graph；继续 Cytoscape，原节点/关系/拖拽/缩放/定位保留 |
| `/imports` | 来源选择+批次结果 | Setup来源卡+ImportDialog；保留九类来源与扩展下载 |
| `/sharing` | 库卡片+邀请/公开确认 | Library+Settings行+Dialog；公开与只读邀请分清 |
| `/discover` | 公开卡片目录 | Library；真实搜索/空状态，不插假数据 |
| `/discover/:libraryId` | 公开只读材料阅读 | Material双栏，只走公开API |
| `/shared/:libraryId` | 授权只读材料阅读 | Material双栏，保留撤销访问与身份隔离 |
| `/connections` | 授权范围表单+连接列表 | Settings行/选择/确认；一次性密钥不进持久浏览器存储 |
| `/subscription` | 套餐及模型可用性 | Settings+卡片；未配置状态保留，不编造价格 |
| `/settings` | 左分类右内容弹窗 | Settings，扩容真实6分区与完整个人记忆入口 |
| `/admin/users` | 搜索+用户列表+确认弹窗 | Library搜索、Settings行、Dialog；保护管理员与审计保留 |
| `/admin/operations` | 单列运行设置表单 | Settings行；明确重载服务语义 |
| `/login` | 邮箱→密码两屏 | Login，保留错误/过期/显隐/redirect/回退 |
| `/register` | 邮箱→验证码→密码三屏 | 同一Auth样式，真实冷却/修改邮箱/再次提交 |
| `/password-reset/:token` | 居中表单/结果 | Login模式推导，保留12–128及失效token规则 |
| `/knowledge/*`、`/courses/*`、`/research/tools`、`/my` | 兼容重定向 | 保留目的地，不重新开放退役公共学科目录 |
| 加载/空/错误/网络/运行模式 | 全局状态组件 | qx-notice/角色空态，保留真实信息与重试 |

## mock 中的好设计与未接业务

本次直接采用的纯前端设计：两屏登录、单列引导、来源抽屉不丢滚位、主题统一、手机抽屉、角色身份、卡片/阅读/三栏布局、完整设置分类。控件若映射已有业务，复用原 handler 和权限。

以下列建议，不做可点击的假成功入口：
- Google OAuth、自动来源同步、忘记密码主动发邮件：没有完整既有合同。
- 回答“存为笔记”、反馈、文稿“加一节”：需真实保存目标/接口/版本规则，不等于 mock 的空按钮。
- 来源“用在了某研究/引用次数”、资料间关系：只显示服务实际提供的数据。
- 主题三态可做本机外观偏好，不能声称同步到账户；后台通知开关不能冒充已有通知投递。
- “放进研究”仅映射已有真实研究起点/提案确认，不能跳过正式确认或直接覆盖文稿。

## 规则冲突与采用的解释

- mock是视觉规范，不是业务实现。固定回复、定时进度、SVG假图、248条等样例数据不拷进真实页面。
- `WORKSPACE_TOKENS.md` 的旧圆角/暖纸面描述已过时，以本文件与当前 tokens 为准。
- “按钮/输入框非透明”用于本应有表面的控件。ghost按钮、Composer内部textarea按设计可透明，但其容器底色必须有效，且 CSS变量无环。
- 手机“只剩文稿”指默认视图，不删除真实资料/Agent/工具，保留明确切换且不卸载运行中的Agent。
- 基线存在旧 `/knowledge/*` 来源深链和历史version参数恢复缺口，必须单独核实际可达性，不宣称原来已正确。

## 验收记录

- mock基线：14入口、桌面1470浅/深、390×844 DOM及交互已核；未截图。无横向文档溢出；来源抽屉打开/关闭保持scrollTop49；多行Composer稳定28px；sidebar260/72。
- 新代码尚在逐区实施。只有实际跑完的检查才标通过；原测试的存在不是新实现通过。
- 最终：typecheck、lint、check:styles、check:boundaries、全量vitest、build；全路由light/dark/390px及主流程。官网源文件hash不变。
- 每PR附本区域功能清单。代码/本地mock验收、用户视觉确认、真实后端验收、生产部署分别记录。

## 逐项功能基线

下面清单记录重构前真实功能。未另标验收结果的条目均待新布局复验；保留已有测试的行为断言，不为通过测试删除业务。


# Everplain 非研究主流程功能保全清单

审计基线：`feat/design-tokens` / `0f47e0f`，输入目录 `everplain-ui-input/source`。只读审计；未改实施代码、未访问后端、未运行测试、未使用浏览器或截图。下面“已有测试”指已读到测试代码，**不代表本次运行通过**。

已读仓库 `AGENTS.md`、`HANDOFF.md`；无 `TASKS.md`。视觉唯一参照为 `frontend/src/mock/`。真实页面仅用于确认行为、接口、状态、权限和边界。

## 0. 实施边界及最容易漏掉的差异

- 不改 `src/app/foundation/`、App 的 `/`、`/welcome`、`productHome`。`/app` 仅按钮和侧栏；本审计不建议改其主体。
- 内部 `courses`/`SharedCourse` 命名是兼容实现，不是课程产品；不得恢复学生/教师角色或旧公共学科目录。
- `/knowledge/*`、`/courses/*` 是退役路径，只兼容重定向 `/library`。`knowledge-explorer` 和旧 `FullscreenKnowledgeGraphPage` 虽仍有大量源码/测试，**不是本轮要重新露出的产品页面**。`/discover` 是真实存在的用户主动公开资料目录，与旧学科目录不同。
- 真实登录现在**同屏邮箱+密码**；mock 才是两屏。真实注册已是三步。不要误以为两屏登录已完成。
- 登录有密码显隐；注册、设置改密码、重置密码目前没有显隐。将显隐作为新增前端增强，与“保留已有”分开验证。
- 设置真实功能显著多于 mock：积分/兑换/分页、语言/时区、会话、模型数据授权、导出、停用/删除、管理员入口全部要保留。
- 真实“个人记忆”现在在 `/research/materials?tab=memory`，不是 `/settings`。若改成设置中的 tab，应复用完整 `ResearchMemoryPanel taskId={null}`，不得降成 mock 的只删除列表；项目记忆仍留在项目内。
- 真实 `/library` 首页是**知识库集合**，`?kb_id=` 是库内资料，`?document_id=` 是原文阅读。mock 平铺资料卡不能抹掉库层级、库 ID、资源所有权及深链。
- 真实 `/my/graph` 已有 Cytoscape `concentric`，无需用 mock SVG 重写。库级 `/library/knowledge` 图与个人图两者都有实际入口及不同数据。
- setup 已接真实后端 profile、导入、轮询和保存版本。mock 的 248 条、假主题及 90ms 进度不能复制。
- 导入页实际支持九类来源，远多于 mock 四类；不能只留下 Chrome/Obsidian/B 站/Apple。
- sharing、connections、subscription、admin 没有单独 mock，按同一套真实数据 + mock 组件模式推导布局；不要删掉功能或新增假能力。

## 1. 跨路由合同

源：`src/app/App.tsx`：`loginRedirect`、`LoginRoute`、`RegisterRoute`、`ProtectedRoute`、`AccountSettingsRoute`、`AppRoutes`；`src/modules/account/AccountProvider.tsx`。

| 路由 | 鉴权/目的 | 必保留 |
|---|---|---|
| `/login` | 匿名登录；已登录直接去安全 redirect | query/hash 深链；注册链接携带同一 redirect；session expired 提示 |
| `/register` | 匿名注册；已登录直接去 redirect | 三步注册；登录链接携带 redirect |
| `/password-reset/:token` | 无需当前 session 的 token 重置 | 缺失/无效/已消费 token，成功后返回登录 |
| `/welcome/setup` | protected，绕过 OnboardingGate 的 profile 完成检查 | 未完成用户可逐步存档；已完成用户可重新设置 |
| `/settings` | protected，叠在 settingsBackground 上 | 带背景时关闭 navigate(-1)，直接深链关闭 replace `/app`；不能把背景卸载成空白 |
| `/library`、`/library/knowledge` | protected + onboarding | 原有 query 参数导航、原文出处定位 |
| `/imports`、`/my/graph` | protected + onboarding | userId query cache 隔离 |
| `/sharing`、`/shared/:libraryId`、`/connections`、`/subscription` | protected + onboarding | ownership/read-only/identity-cache 边界 |
| `/discover`、`/discover/:libraryId` | 当前无需登录 | 只读公开快照，不能请求私有来源替代 |
| `/admin/users`、`/admin/operations` | protected + API 权限检查 | 401 返回带 redirect 的登录；403 返回 `/settings` |
| `/knowledge/*`、`/courses/*` | 兼容路由 | replace `/library`，不恢复公共学科目录 |
| `/my` | 兼容路由 | replace `/app?research=all` |

登录目标必须以 `/` 开头且解析后同源；外部、协议相对、恶意/畸形地址回 `/app`。ProtectedRoute 等待 session，error 显示错误，匿名/expired 保留 pathname+search+hash 送登录。AccountProvider 通过 HttpOnly-cookie API 恢复 session；已建立 session 遇保护接口 401 才标记 expired；登录/注册成功写 session cache，logout 成功清 cache。不能改成 localStorage token 或假登录。

`OnboardingGate`：`['agent-profile', userId]`，30s stale；等待/错误可重试；未 setup_completed replace setup。setup 页面自身 bypass。注意 gate 当前未持久化最初 deep link 到 setup 后的返回值，setup 完成固定 `/my/graph`；这属于既有行为，不应宣称已解决 deep link 经首次引导后的恢复。

已有测试：`App.test.tsx` 的登录同源/外部/畸形 redirect、hash、真实 login response 后深链、会话等待、退出；`EverplainRoutes.test.tsx` 的 library protection、退役路由、预填问题 preservation；`AccountProvider.test.tsx` 已建 session 遇 401。`AppRecovery.test.tsx` 直接单独 render `NotFoundState`、`SessionRecoveryState`、`FatalErrorState` 和 ErrorBoundary，并非真实路由集成验证；本基线 `App.tsx` 看不到 catch-all，也未把 retry handler 传进 ProtectedRoute error。**这些测试不能证明 recovery 已接入全部真实路由**。

## 2. `/login` 与 `/register`

源：`modules/account/AccountPages.tsx`：`AccountPortal`、`LoginPage.submit`、`RegisterPage.sendCode`、`continueToPassword`、`submit`；`accountApi.ts` 的 API/error helpers。

### 登录保全

- Email trim、正则有效邮箱、最长 320；密码 8–128，不应 trim 密码。
- `autoComplete=email/current-password`；密码 toggle 不提交、不改变值，aria-label/pressed 更新。
- `submitting` 禁用主按钮、显示等待；成功只调用真实 `onLogin` 后 `onAuthenticated`。
- 401/被拒绝统一中性“邮箱或密码不正确”；服务/网络失败用服务不可用，不能误报密码错误或泄露账号是否存在。
- 已过期 session role=status；错误 role=alert；注册入口、回品牌首页仍有路由。

mock 对应：`mock/pages/Login.tsx` 单列居中、角色群、先邮箱后密码、返回箭头。两屏改造时邮箱验证过才前进；返回保留邮箱、再次前进，密码显隐和真正提交路径必须仍存在。不能添加可点击却无接口的 Google login；mock 忘记密码也只是占位，真实目前只有管理员发出的重置链接消费页。

### 注册保全

1. 邮箱屏：trim/格式/320；真实发送验证码；回调给 `resendAfterSeconds`，不是硬编码倒计时。
2. 验证码屏：显示目标邮箱；修改邮箱回第一屏；只允许 6 位数字；`one-time-code`/numeric；有效格式继续密码屏；重发倒计时每秒 decrement，倒计时与 submitting 期间 disabled。
3. 密码屏：邮件摘要、返回验证码；新密码和确认密码；8–128；一致性检查；正确 `onRegister(email,password,verificationCode)`；提交中/失败保留输入；成功走 redirect。
- 422 验证码无效/过期，409 邮箱不能注册，验证码 429 发送过频，其余中性服务失败。
- 上一步是界面步骤，不是重新提交；新增显隐若覆盖两个密码字段，应各自无副作用。
- 基线修改 email 没有清除旧 `verificationCode`；重构可修 UI 状态混淆，但服务验证仍是权威，不可让前端误判“已验证”。验证码继续只检查格式，真正校验在注册提交。

已有测试 `AccountPages.test.tsx`：显隐不改值/不提交；各类拒绝中性消息；服务失效/断网；密码不一致和长度边界；真实三步。`accountApi.test.ts`：cookie session、匿名401、登录 body+idempotency。新增必测：登录两屏回退/编辑邮箱/Enter；注册改邮箱与旧 code 状态、重发倒计时、返回验证码、双击提交、失败重试、redirect 保留。现有测试不是这些新增动作的充分覆盖。

## 3. `/password-reset/:token`

源：`modules/account/PasswordResetPage.tsx` `submit`、`MutationIntentLedger`。

- 缺失 token 立即无效提示，不发 API；12–128 新密码，与登录/注册 8–128 不同，不能统一放宽。
- 确认密码匹配；submittingRef 防同一帧重复提交；同一失败意图重试复用 idempotency key，成功 complete。
- 410 提示过期/已使用并让管理员创建新链接；其他失败保留重试，不展示底层服务细节。
- 成功页明确旧会话撤销、返回登录；仍有“想起密码返回登录”。
- mock pattern：Login 的无侧栏居中表单和成功状态；不要把它当发送重置邮件流程。
- 测试：`PasswordResetPage.test.tsx` 短密码/不一致拦截、pending只提交一次、成功返回登录、过期/已使用链接。

## 4. `/welcome/setup` 真实四步

源：`app/welcome/WelcomeSetupPage.tsx` `WelcomeSetupPage.change/upload`；`modules/agent-profile/agentProfileApi.ts`；`modules/knowledge-import/knowledgeImportApi.ts`。

通用：`readAgentProfile` 服务数据恢复 name/avatar/color/style/questionnaire/setup_step；step 限 0..3，已完成再进入从0；保存携 `expected_version`，API idempotency header；写成功更新 query cache，再切步/导航；错误留当前页；busy 禁下一步/上一步/skip；进度只允许回已到达步。change(next,true) 跳过不保存当前未确认输入；这一点不能无声变成“跳过=保存”。

| 真正步骤 | UI/handler 合同 | mock 参照 |
|---|---|---|
| 0 导入 | Chrome `.html/.htm`；Obsidian Markdown 文件夹、多文件、webkitRelativePath；upload(source,files)；重置 input 以允许同文件重选；真实 batch total/finished 汇总 | Setup.ImportStep 的来源卡、角色、顶部进度、继续/跳过；实际仅两类入口，其余在 imports |
| 1 角色 | 名称 max40，空值保存 Everplain；全部 agentAvatarPresets；颜色；clear/warm/rigorous/curious 四说话方式；保存真实 profile | Setup.NameStep，但不要复制 max8 或减少说话方式 |
| 2 问卷 | 职业单选可取消；领域 max160；目标多选；兴趣按顿号/中英文逗号/换行拆分；additional max1000，可展开；所有项选填 | Setup.SurveyStep，但保留真实问卷字段和存储 |
| 3 整理 | 仅 batch finished/total；processing 时角色 work；无资料空白真实状态；列 batch，失败 item 的标题/原因/单条 retryImport(batch,item) 后 refetch | Setup.GenerateStep 的布局，禁止假时间进度/假主题 |

- `readImportBatches` 有 processing 时 1200ms 轮询，退出清 query 生命周期。可以未处理完就完成/进入图谱，后台继续；主按钮不依赖 mock finished。
- 最后 change(4) 存 setup_completed=true，再 `/my/graph`；跳过最后一步也真实存完成。
- Agent 的 idle/greet/think/work 与当前步骤/实际导入处理状态关联。
- profile 读取失败明确 retry；upload 失败保留错误、可重选，不切步骤；重试失败 item 错误仍展示。
- 重启/刷新恢复的是已保存 profile，不是全部未提交表单；不要宣称 autosave。
- 现有“账户设置”链接会走同一个 protected+OnboardingGate，未完成用户点击可能仍被送回 setup；是已存在的可达性风险，布局迁移时需实际核对。

测试：`WelcomeSetupPage.test.tsx` 逐步跳过且无虚假进度；恢复身份步骤、保存并 remount；upload失败仍原页。缺口：问卷真实 payload、单条 retry、processing polling、保存版本冲突/失败、快速连点、离开后迟到响应、completed重走四步。不要以这3个 mock接口单测替代真实导入验收。

## 5. `/settings`：不能被 mock 五个 tab 缩减

源：`app/ui/SettingsModal.tsx`；`App.tsx AccountSettingsRoute`；`modules/account/AccountSettingsPage.tsx`，`accountManagementApi.ts`、`accountManagementModels.ts`、`mutationIntent.ts`。

### 弹窗和通用事务

- 原生 dialog showModal；背景滚动锁并恢复；Escape、外部背板、关闭 X；onClose 返回原背景路由，否则 `/app`。
- 重新设置 AI 伙伴按钮进 `/welcome/setup`。mock 对应 Settings.AgentTab“重新走一遍”。
- 原设置六分区 profile/credits/preferences/security/privacy/danger，同一时刻一个分区；语言中英；切区清反馈但不做隐形写入。
- 初始化同时 getAccount/listSessions/getCreditSummary(limit10)，失败全页恢复重试；401 触发 session refresh。
- `perform` 的 pendingActionRef 防重复，MutationIntentLedger 按 action+payload 重用网络失败 key，成功后清；expectedVersion 保护并发；409 显示服务端可恢复原因。
- 退出按钮在左栏底部；成功退出后到公共首页，停用/删除走同样 leaveAccount；不要只关闭弹窗冒充注销。

### 功能表

| 功能 | 真实细节/handler | mock pattern |
|---|---|---|
| 个人资料 | 显示名称编辑/取消还原；trim1–80；submitProfile 带 account.version；保存后 account.retrySession；邮箱只读并说明管理员变更；加入时间、角色 | Settings.Row / AccountTab，或单独“个人资料”子区 |
| 积分 | balance/limit/meter，管理员 unlimited；流水 kind、时间、输入输出token、points；10条分页 previous/next cursor，无限长列表不可替代 | Settings.Row+列表；不凭 mock 1.7GB/5GB换掉积分 |
| 兑换 | 非 unlimited 有一次性兑换码 trim max64；submitCreditRedemption，成功更新 balance 清 code；失败保留 | 紧凑输入+按钮 |
| 偏好 | zh-CN/en-US 即时 setAppLocale 预览，submitPreferences 保存；timezone Shanghai/UTC；expectedVersion=preferences.version | Settings.LookTab segmented/Row 可表达语言，外观主题不是这两个字段 |
| 密码 | current/new/confirmation；新密码12–128；默认撤销其他会话 true；submitPassword；成功清密码、移除被撤销会话；当前设备保留 | AccountTab密码行展开真实表单 |
| 会话 | 设备名、lastSeen；当前会话标记不可直接 revoke；其他逐个撤销，二次确认，成功删行 | Settings列表+真实确认弹窗 |
| 模型数据授权 | switch 点击先开确认；开启/撤回各有真实描述；policyVersion+expectedVersion；目前不训练，只记录未来可选授权 | Settings switch，但不是点一下就写 |
| 导出 | requestDataExport，JSON真downloadHref，ready才下载；pending说明；不含密码/会话；API origin split-port下载映射必须保留 | AccountTab导出按钮+反馈；不等于“导出全部原始资料” |
| 停用 | 非受保护管理员；二次确认 currentPassword+非空reason trim/max240；成功触发退出；研究数据保留可管理员恢复 | Account危险操作区 |
| 永久删除 | 输入大小写不敏感匹配账户 email + 当前密码才可确认；删除账户/任务/派生文档/模型记录不可恢复；成功退出 | AccountTab删除按钮升级为完整输入确认 |
| 部署管理员 | isProtectedAdmin不可降级、停用/删除；危险区改保护说明；仍能改密码/撤销会话 | 同一Row+状态说明 |
| 管理员入口 | account.role===admin 才出现 `/admin/users` | Settings nav footer，不放给普通用户 |

`AccountConfirmationDialog` 必保留：初焦点取消、Tab/ShiftTab圈定、Escape仅非pending可关闭、卸载恢复触发按钮焦点、pending禁确认/取消、error在对话框中、danger tone。可以改样式，不要用简单 alert/假成功替换。

通知关联：`researchUpdatesEnabled` 已从服务读取并随偏好提交保留，但 UI **刻意不提供通知开关**，因为无 delivery service；`AccountSettingsPage.test.tsx` 明确测试。shell 的通知目前是固定更新日志和“暂无新消息”，非后端 inbox；由父负责样式，不能把 setup mock“好了告诉我”升级为实际通知承诺。

### 个人记忆迁移合同

现入口 `/research/materials?tab=memory` 无 task_id 时个人；源码 `app/research/ResearchMaterialsPage.tsx:219,305`、`ResearchMemoryPanel.tsx`，API `modules/research-memory/{memory,memoryApi}.ts`。

- 概览真实 API、懒展明细、数量/容量、读取/重新整理失败；新增/编辑/取消；按服务 UTF-8 byte上限与数量限制，达到容量仍可编辑已有。
- 来源筛选、内容/原话搜索、最近/最早排序；个人/项目范围分离；源于问卷的明确标签；原话及来源对话 link。
- 删除前确认，删除内容+历史但原始对话保留；编辑版本并发冲突保留输入；历史最近最多50版。
- “使用记忆”和“从对话学习”独立开关。关闭使用不能同时关闭学习或删内容。
- 写后 abort旧概览、使用新 scope version、刷新失败不把成功写入回滚为旧概览；避免换 tab 时旧响应覆盖新状态。
- DEV preview不写网是单独模式，真实设置不可默认 preview。
- mock MemoryTab 仅列表/删除可作为排版，不是功能规范。若设置新增入口，复用这些 handlers与限制。

已有 `AccountSettingsPage.test.tsx`：全部分区、退出位置、中英即时预览/存储、积分/分页/兑换/unlimited、初始化失败、版本化profile防重复、相同意图失败重试key、焦点/Escape恢复、密码和session更新、模型授权/真导出/typed deletion、受保护管理员、通知开关隐藏但偏好保留。`mutationIntent.test.ts`，`accountManagementApi.test.ts` cookie/key/conflict/export URL。记忆已有10项 `ResearchMemoryPanel.test.tsx`，尤其字节预算/容量/冲突/独立开关/概览竞态。

## 6. `/library`：列表、库详情、材料详情三个真实状态

源：`app/courses/CoursesPage.tsx` `navigate/action/save`；`modules/shared-knowledge/sharedKnowledgeApi.ts`。API必须继续经模块入口调用 generated SDK，不裸 fetch。

### `/library` 知识库列表

- `listCourses()` 仅 owner 进入列表，旧服务返 reader也隐藏。
- 名称+描述本地大小写无关搜索；区分初始空库和无搜索结果。
- 新建按钮受 `storage.max_libraries` 限制；编辑 form name required/max100、description max1000选填；取消；busy保护。
- create后 refresh list，导航 `?kb_id=<real id>`。卡片名称/描述、readyDocumentCount、私有标记、打开。
- storage真used_bytes/max_bytes/library_count/max_libraries，获取失败不能塞假容量。
- 页面初加载、失败重新加载、emptyCTA均必须保留。
- mock `LibraryPage + MaterialCard + search` 为排版参照。库层级可以卡片展示，不能直接把“新建知识库”丢掉变成唯一“添加资料”。

### `/library?kb_id=...` 库详情

- `getCourse` 再检查 owner，非 owner 抛不可访问，不能绕到 owner UI。
- 所有知识库返回；库名称/说明；知识与关系 `/library/knowledge?kb_id`；基于本库研究 `/agent?reference_knowledge_base_id`。
- 编辑库复用save；删除库原生dialog、说明删除资料/整理结果/索引但已生成对话文稿保留；取消/Escape；busy不可中断；失败留dialog。
- 上传 multiple，允许 PDF、DOCX、PPTX、MD、TXT；按服务 `max_file_bytes`/`max_documents_per_library`（fallback20MB/100），先整批超数量拒绝，然后逐个大小校验和上传。
- 单个失败不停止余下，保留成功项；逐文件 `正在上传 i/n:file`；汇总失败原因；上传后 refresh detail/storage；reset input使同名再传可行。
- 每个文件 filename/bytes/warnings/error；parse status 与 knowledge/index stage 三套独立状态（可阅读≠已索引≠知识已整理）。
- ready且knowledge/index failed提供 `retryCourseDocument`；3s polling只在ready且knowledge/index queued/running时继续；失败退出轮询并提示。
- 删除材料当前 window.confirm 后 detachCourseDocument，明确资料+知识+索引不可撤销；成功刷新。视觉重做可换统一确认，但不能删确认步骤。
- 点击只能ready文件；无资料给上传指引。扫描图/PPTX可见正文限制必须保持事实准确。
- mock Library 卡片/ImportDialog 是视觉参考；真实导入和库内upload不同 API与限额，不混为一个假dropzone。

### `/library?kb_id=...&document_id=...&segment_id=...&conversation_id=...`

源：`ReadOnlyMaterialReader.tsx`、`DocumentWorkspace`/`DocumentSourceView`等复用组件；`CoursesPage` source分支。

- `readCourseDocument`读取原文，保留 segmentId/parseId/ordinal/locator（页/heading/段/行/字符/block）。24段分页；初始 segment自动切正确页并scrollIntoView。
- source不重写为可编辑假文章。点击正文/行号或章节定位；搜索文本+locator、结果count、分页与无结果；Ctrl/⌘+Shift+F切搜索，Escape关闭/清搜索；90/100/110/125%缩放。
- 顶栏返回库、同库ready材料select、知识关系link；同库切资料保留conversation_id，返回库也保持该对话；不同库不继承。
- 左章节可折叠；右栏可开关。右栏原文依据/知识点/Agent tabs，切tab使用hidden而非卸载Agent，保留进行中会话。
- 原文依据显示来源+locator；“复制原文与定位”真实 clipboard与fallback，成功/失败提示；reader警告。
- 知识点摘要/依据按钮，多个出处分别跳转；queued/running不可编辑；failed告知去资料详情retry。
- 嵌入 Agent referenceKnowledgeBaseId 限本库、conversation_id 恢复；新会话将 ID replace写URL；引用 click 同步 kb/document/segment，reader自动打开 source标签并定位。不要把“问这份资料”改成无上下文通用 `/agent`。
- mock `MaterialPage` 左衬线原文/右知识 rail、topbar；保留真实章节/搜索/分页/引用定位/Agent，不用 mock固定原文填充。

### 知识编辑

`DocumentKnowledgeEditor.save`：资料摘要required/max16000；知识点名称max100/说明max4000；每项multiple required原文segment anchors；添加/编辑/删除知识点；重命名同步关系端点；删知识点级联删依赖关系；≥2知识点可加关系；关系起终点选现有知识点、label max100、独立依据；删除关系；保存busy、失败保留编辑、取消；至少1知识点可保存。保存 `saveDocumentKnowledge(kb,doc,{summary,topics,relations})`，不能只本地setPoints。

已有测试：`CoursesPage.test.tsx` 私库创建无角色/共享、foreign隐藏、三阶段状态/重试入口、显式库删除/取消、批上传一项失败后继续；`ReadOnlyMaterialReader.test.tsx` 24段分页深锚点、知识回原文且Agent保持mounted；`DocumentKnowledgeEditor.test.tsx` generated API带真实anchors、校验失败保留修改；`App.test.tsx` 私有知识与原文段深链。缺口：库内搜索/rename、配额边界、polling、文档删除、clipboard、reader快捷键/缩放/切文档、关系rename/delete，以及真实后端所有权回归。

## 7. `/library/knowledge?kb_id=...` 库级知识与关系

源：`CourseKnowledgePage.tsx`：`courseProjection`、`sourceLink`、`selectTopic`。

- 读取库列表，目录只owner；选择库改 kb_id并清搜索；loading/error/retry；无kb提示选库；原资料管理/阅读返回。
- 只投影 knowledgeStatus=ready 的真知识；root=库、document=资料、topic按NFKC+trim同名聚合，但每份来源summary及segmentIds仍分别保留，不能把同名当同义已确证。
- 资料包含边/涉及边为structure，真relations为candidate，保留 relation label/direction、doc证据locator、segmentIds。选节点清edge，选edge清node。
- 搜索知识标题+来源summary；list显示来源数；topic详情每份来源独立原文链接；edge详情source→target+关系原文；多个segment逐个可开。
- 图谱展开/收起；节点/边点击与右侧证据同步；无知识、整理中、失败资料提示；ready文档 knowledge queued/running时3s刷新。
- mock Graph/Material组合模式，可使用 mock pagehead/搜索/同中性卡片与证据rail。库级图不应强制Agent中心冒充个人总图。
- 没有独立 `CourseKnowledgePage.test.tsx`；`App.test.tsx:1121` 有知识点→原文anchor集成断言。应补相同topic多来源、relation点击、polling/empty/error和切库清状态。

## 8. `/my/graph` 个人总图与 Cytoscape

源：`PersonalGraphPage.tsx` `projection`/`refresh`；`personalGraphApi.ts`；`knowledge-graph/ObsidianKnowledgeGraph.tsx` `graphElements/layoutOptions/fitView/relayout`。

- 真实 `readPersonalGraph`，pending_count存在2.5s刷新；`rebuildPersonalGraph`显式更新、pending disable、失败提示，成功写同user cache。
- self节点使用当前name/avatar/color SVG。真实level决定同心圆，不复制 mock固定半径和数据。query仅前端匹配真实node labels，忽略self，结果最多80展示。
- node选择关联真实source record：library/document/segment；`readCourseDocument`带segment_id；图片asset、文字段、高亮source segment；关闭；到原库doc；仅http(s)来源网页外开。
- 和Agent聊按钮选source时带 reference_knowledge_base_id，否则普通Agent；继续导入；图统计、empty firstimport、pending解释。
- 服务返回mode=mock时诚实标识本地演示归类；semantic pending解释需索引。不能将此免责声明移除并宣称真实模型已验。
- `personal=true` Cytoscape concentric; workspace zoom范围0.16–3.2，拖动节点和平移，userZooming；fit、relayout；node entry/document/knowledge走onSelect，其他走onExpand；edge选择；hover邻域高亮、焦点邻居/上下文弱化；resize observer；销毁与timer/event清理；reduced-motion尊重；初始化失败留外部search/detail可用。
- mock Graph的主题chip、卡片/图切换、+/-zoom可以作为新前端增强，但不能退化成SVG；实际当前zoom是Cytoscape交互+fit/reflow，没有mock +/−独立按钮。
- 老 `KnowledgeGraph`/`FullscreenKnowledgeGraphPage` 的7维学科、pending关系分页等不能作为新个人图功能清单照搬。组件的共享内部样式改动要避免影响冻结foundation引用的preview。

测试：`KnowledgeGraph.test.tsx` 覆盖的是另一个 `KnowledgeGraph` 组件（节点/边/销毁/fallback），不能冒称个人总图已覆盖；`FullscreenKnowledgeGraphPage.test.tsx` 间接mock Cytoscape验证旧图工作流；`knowledgeGraphAdapter/API.test.ts` 为旧release graph adapters；本基线没有 `PersonalGraphPage.test.tsx` 或 `ObsidianKnowledgeGraph.test.tsx`。新增个人图专项回归应优先。

## 9. `/imports` 所有来源与记录

源：`ImportsPage.tsx` `sources/upload/favorites`；`knowledgeImportApi.ts` `readImportBatches/importFiles/importBilibili/retryImport`。

来源不能缩减：

| source id | 真入口/约束 |
|---|---|
| chrome | Chrome/Edge书签 `.html,.htm` |
| obsidian | `.md,.markdown,.txt,.zip`，或整个目录（webkitRelativePath） |
| apple_notes | 导出 `.md,.markdown,.txt,.zip` |
| enex | Evernote/印象笔记 `.enex` |
| notion | 导出 `.zip,.html,.htm,.md` |
| flomo | `.html,.htm` |
| keep | Takeout `.zip,.json,.html` |
| bilibili | public UID 1–20位数字；只匿名公开收藏、无需cookie；字幕优先，无字幕依赖专用转写 |
| image | PNG/JPEG/WebP/GIF；需专用视觉模型，未配置真实失败+retry，不伪造OCR |

- 选择来源清旧error/notice；file multiple、accept、disabled、重选同文件；API multipart保留目录相对路径；单文件16MB/批64MB文案（不同于库内直传20MB/100份fallback）。
- upload后真total接收提示；B站开始读取提示；失败保留输入可重试；未完成后台process。
- 记录按user cache；processing时1.5s poll；手动刷新；pending/error/empty。
- 每批 finished/total/progress/imported/duplicates/failed；展开逐item title、error或queued/running/imported/duplicate/failed；失败单条retry后refetch；真实batch library_id进 `/library?kb_id`。
- Chrome扩展下载 `/downloads/everplain-clipper.zip`，不能删为mock来源按钮，也不能宣称已自动安装/连接。
- mock Library.ImportDialog用于添加弹窗及进行中列表视觉；Setup.ImportStep用于来源卡；不得新增假自动同步开关。
- 无独立 ImportsPage/knowledgeImportApi 测试文件；setup的upload失败测试只部分复用入口，不能代替九来源、重试、去重/partial failure/目录保留测试。

## 10. `/sharing`

源：`IntegrationPages.tsx` `SharingPage/SharingContent.run`；`productIntegrationsApi.ts`。

- identity key重建Content并按user query分隔；loading/error/refetch/empty。
- 邀请 query `invite`预填；可粘完整URL提取invite或裸token；join失败保留原输入纠正；成功刷新库。
- owner打开`/library?kb_id`，reader打开`/shared/:id`；显示所有权、描述、可读份数。
- owner开启/关闭邀请只读共享；开启且有token才复制 `${origin}/sharing?invite=<encoded>`；clipboard成功已复制/失败手动说明；关闭撤销成员和旧token的提示不可丢。
- reader退出共享库；不提供owner编辑/发布操作。
- owner公开资料dialog：title required/max100，description max1000，topics按逗号顿号拆；明确当前ready_document_count及原文向任何人公开、后来新增不自动公开；checkbox勾选后才允许 `publish(...confirm_public_content:true)`；关闭不发布；pending禁关闭；错误在page保持。已有publication显示数量并可unpublish。
- 发布属于真实写入且有二次内容公开确认，不能与“复制邀请”同一个无确认按钮。
- 无专门mock：Library卡片 + Settings行与Dialog + mock的中性notice。不要沿用旧大型营销hero作为视觉依据。
- 测试 `IntegrationPages.test.tsx` 发布确认及关闭不发送、失效邀请保留。缺共享开关/复制失败/退出/撤回/请求中连点/身份切换publication状态测试。

## 11. `/discover`、`/discover/:libraryId`、`/shared/:libraryId`

- PublicDirectoryPage：query驱动真实api.directory(query)；公开卡片title/description/topics/document_count，打开discover id；加载/错误/empty及查询无结果区别，管理分享入口。
- SharedReaderPage/Content：以 publicView+libraryId+userKey key重挂载，不能切库仍显示上库原文；query source还按selected及public/private identity隔离。
- public用publicLibrary/publicSource，shared用library/privateSource，不能 fallback到越权接口；无选中提示、文档按钮、来源文件名、真实segments逐段、加载/错误；只读，没有编辑/下载假功能。
- title优先publication title，否则name；正文说明撤销访问后不可继续读取。
- mock Library为目录卡片，Material为只读reader双栏；切换文档不能用mock固定m1。
- 测试 `IntegrationPages.test.tsx` 公共库A→B重置source且未重读旧资料；缺匿名公开读取、私有401/403、撤销后原文不可读、空资料、网络失败。

## 12. `/connections`

- ConnectionsPage以identity key重挂载，切账号清一次性secret；owner库checkbox，reader库不可给外部工具；无选库不能创建。
- name required/max80；有效期7/30/90天；API送绝对expires_at；busy。
- createConnection回secret只呈现一次，textarea readOnly；显示真MCP endpoint或`/api/mcp`、Bearer方式；用户“我已保存，关闭密钥”立即清内存；不要保存localStorage、日志或假key。
- list显示名称、授权库数、expires日期、active/expired/revoked；只有active可revoke；错误显示，操作后refetch。
- 提示需用户手动配置客户端，不冒充插件已连接；受限只读语义保持。
- mock Settings.SourcesTab可用Row/列表视觉，但这是真access credential，不能套一个即开即关“自动同步”状态假装连接。
- 测试 `IntegrationPages.test.tsx` 未选库不可建，真实create一次，账号切换secret清除；缺expires、revoke及failed/repeated创建。

## 13. `/subscription`

- 真catalog模型：provider、display_name、model、capabilities、availability/unavailable_reason；configured文案“已配置·待实际调用验证”，不是模型已验证。
- subscription真available/unavailable_reason、plan descriptions、当前status/cancel_at_period_end；未配置禁checkout/portal，不塞mock价格。
- 只有点击正式checkout/portal才请求；busy避免连续点击；返回URL必须https（new URL），才window.location.assign；失败恢复可操作并提示。
- 结算金额/条款在正式支付页，UI不能显示编造金额或自行确认付费。
- mock Settings.Row与Library卡片为layout来源；不扩套餐或支付后端。
- 测试 `IntegrationPages.test.tsx` 支付未配置无livecheckout；缺https校验、成功跳转、API失败、cancel状态。

## 14. `/admin/users`

源：`AdminUsersPage.tsx` `handleBoundaryFailure/actionFailureMessage/perform/submitSearch/submitCreditCodeBatch`；`AccountConfirmationDialog`、`accountManagementApi`。

- 服务端姓名/邮箱搜索trim、状态all/active/disabled/deactivated；loading/error/retry、empty；总数、用户姓名/email/current/protected、role/status/lastActive。
- 注意response存了nextCursor，但基线**没有目录翻页UI**；不能把它写成已有分页功能或假补全超出服务能力。
- role选择member/admin，改了才可save；protected禁改；二次确认说明权限，原因≥3/max240；expectedVersion+稳定idempotency，成功更新行/roleSelections/审计。
- active非protected可禁用，但currentUser禁；disabled/deactivated可启用，预填恢复原因；明确终止session保数据/恢复不复活旧session；原因和版本同上。
- active才可创建一次性重置链接，二次确认1小时/单次/替换旧链接；成功只呈现一次当前内存URL。
- 积分码批量count1–100、有效天数1–365，默认20/30；真实API返回codes/points/expires，显示需及时保存；pending保护。
- 最近8条审计：动作译名、actor→target、reason、时间/outcome；操作成功刷新；审计读取失败当前表现为空，不可假装“确无事件”。
- 401/403路由回退；409真实冲突提示；失败原目录不改；返settings和模型配置入口。
- mock无专页：Settings左分类/Row、Library搜索、qx table/list、统一Dialog；不能删警告/原因/保护管理员。
- 测试 `AdminUsersPage.test.tsx` 配置积分码批次、protected限制、load恢复/empty、服务端搜索、focused/Escape禁用确认、role确认和限时resetlink；缺启用、self禁用边界、并发冲突/重复请求等。

## 15. `/admin/operations`

源 `AdminOperationsPage.tsx` `useEffect/save`，App route；accountManagementApi get/updateRuntimeSettings。

- 读取真实model、reasoningEffort、providerBaseUrl，未接接口有明确状态；401/403回调。
- 可改model ID trim、reasoningEffort none/minimal/low/medium/high/xhigh/max；providerBaseUrl只展示；非空model/非saving才能提交。
- “应用并重载服务”是真服务配置写入/重载，必须保留行动含义、pending/失败反馈，不降为无副作用UI选择器。
- 保存只传model/effort，不能把URL变可编辑或加假APIkey字段；返回用户管理。
- mock Settings.Row/form推导，无独立page mock；无独立AdminOperationsPage测试，账户API测试只部分adapter，不足运行级验证。本审计未发任何重载操作。

## 16. mock 中值得建议、但当前缺真实完整合同的增强

下列单列建议，不标已实现，不扩后端，不使用mock数据：

1. 登录两屏、返回与密码显隐；注册可补显隐。纯前端，可保留原认证API并新增回归。
2. Library卡片/个人图视图切换、真来源/类型标签与搜索。只有能从现有owned真实数据稳定推导的筛选才启用；mock按topicId/summary搜索不能直接复制进库列表。
3. 将已实现imports流程以统一添加Dialog呈现，或明确链接到`/imports`；保留库内upload和来源import差异。链接收藏入口需先确认已有 `createClipImport` 合同/当前实际支持，不能只显示“收进来”假按钮。
4. 资料详情“问资料”使用已有context；知识点编辑复用真editor。重命名材料、导出Markdown、“和这些有关”、“用在了/引用3次”在当前SharedSource UI/API adapter无完整数据，不要伪造；可作为后续确认范围。
5. Settings整合真实Agent profile编辑、个人记忆、导入来源入口更易找。但mock自动同步四开关没有真实sync合同，不能启用成假已连接；sources可用已有导入记录/入口事实。
6. 外观system/light/dark：mock仅修改document.style.colorScheme、无持久化。当前真实settings没有theme preference字段；若仅前端本地设置需另确实现/存储策略，不冒称已同步账户。
7. 图谱主题chips和+/-可用已有真实图数据/实例实现；“用在了”及跨资料关系只显示真返回关系，不人为造边。
8. Google登录、忘记密码发邮件、自动同步、整理好通知、文件格式音视频任意上传及真实套餐价格都不能由mock推导成可用功能。

## 17. 实施后建议验收矩阵（本次未运行）

最小功能回归应含 AccountPages/Provider/Settings/PasswordReset/AdminUsers、WelcomeSetup、CoursesPage/ReadOnlyMaterialReader/DocumentKnowledgeEditor、IntegrationPages、ResearchMemoryPanel、App/EverplainRoutes相关片段，以及所改共享组件。测试新增重点：两屏登录；注册回退/重发；setup恢复/失败/真实进度；settings背景恢复与嵌套危险dialog；真实个人图Cytoscape；九源imports。

- 每页至少查 loading / empty / error / retry；每个写入口查 repeated click / cancel / pending / late response；导航查 close/back/forward、query保持、账号切换清数据。
- `npm run typecheck`、`npm run lint`、`npm run check:styles`、`npm run check:boundaries`、`npm run build`只说明静态/构建，不说明真实模型、支付、导入或浏览器全链路。
- shared graph/reader/card/form/global tokens改动要检查冻结foundation引用是否被视觉间接影响；不能以全局CSS外溢绕开冻结边界。
- 页面CSS只布局；控件用`qx-*`，颜色/字号/半径/阴影用tokens；衬线给内容、无衬线给UI；手机sidebar抽屉/来源底部panel。
- 列出的旧测试含过时领域fixtures及可能与实现矛盾的断言，应报告具体真实失败，不能为“全绿”删除产品行为或宣称未跑即通过。


# Everplain Agent / Research 功能保全盘点

日期：2026-10-02。只读盘点；未修改实施源码，未运行浏览器、未截图、未部署。

## 结论先行

1. **必须保留共享会话控制器，不能把 mock 的 `send()` 搬进真实页面。** `ResearchAgentConversationPage` 被独立 Agent、新建研究、正式项目、知识库语境复用；草稿隔离、完整请求快照、服务端停止确认、SSE 幂等重连、暂停/等待确认恢复都在这里。
2. **Research mock 三栏是视觉骨架，不等于真实功能全集。** 真实项目有地图、材料、分析、理论、方法、文稿、归档 7 个工具；理论决定、候选审阅、材料权限、文稿版本与成果包门禁不能在重排后失去入口。
3. **mock 的四段阶段不是后端状态机。** `提问 / 找资料 / 写大纲 / 写作` 只能在明确定义的展示映射后使用；不得替换 `allowed_actions`、研究起点确认、理论方案确认或 M5 完成检查。
4. **保留 URL 身份链。** `conversation_id` 要贯穿工具切换、首次 streaming、文稿定位、材料定位；不同项目对话必须拒绝。来源还必须保留 `knowledge_release_id` 或 `material_id + parse_id + segment_id`，不能全部简化成一个 mock material ID。
5. **明确 mock 假交互。** “存为笔记”“回答不好”“加一节”等在所审查真实界面没有对应可用流程，mock 自身也是空 handler。只能提出建议，不能以点击成功/假数据补齐。
6. **已有测试只是定位依据，本轮没有执行。** 本桥接包不含后端，不能据此证明所有者校验或真实模型全链路通过。最终应由父任务对修改后的代码执行测试、真实浏览器验收；用户确认 mock 后才集成/部署。

## 基线与阅读范围

- 源码：`/workspace/scratch/7f7bbb4d3ee6/everplain-ui-input/source`。
- `BRIDGE_MANIFEST.json` 声明原仓库 `feat/design-tokens`、head `0f47e0f89ca9e459dcf457cc32f7e0edffa19026`。当前桥接 checkout 自己的提交为 `2c8aaba`；不是将桥接提交误当原仓库 head。
- 已读仓库 `AGENTS.md`、`HANDOFF.md`；盘点期间未触碰 `frontend/src/app/foundation` 文件。
- 以下路径均相对 `frontend/src/`。稳定函数、组件、可访问名称比行号更适合实施后查找。
- 以 `app/agent`、`app/research`、`app/research-workspace` 为主，追到它们真实调用的 `modules/research-*`、`modules/research-projects`、`api/researchWorkspace.ts`、`api/m5ResearchDelivery.ts`。未把仅有模型/未挂载组件当作当前可用 UI。

## Mock 对照编码

| 编码 | 唯一视觉参考中的实例 | 可复用的呈现模式 |
|---|---|---|
| A0 | `mock/pages/Agent.tsx::AgentPage` 空对话 | 头像、问候、居中 composer |
| A1 | 同文件非空 `mk-chat__thread` / `mk-turn` | 用户灰气泡、Agent 头像+无气泡正文、来源 chips、回答操作 |
| A2 | 同文件 `SourceDrawer` | 右侧原文/来源抽屉、不离开对话 |
| C | `mock/ui.tsx::Composer` | 自适应文本区、加号、附件、发送 |
| R0 | `mock/pages/Research.tsx::ResearchListPage` | 项目卡、更新信息、新建研究卡 |
| R1 | 同文件 `ResearchWorkspacePage` 顶栏 / `StageBar` | 返回、标题、阶段、导出 |
| R2 | 同文件 `mk-ws__outline` | 左大纲、选中项、折叠 |
| R3 | 同文件 `mk-ws__doc` | 中央文稿与正文引用 |
| R4 | 同文件 `mk-ws__side` 的资料 tab | 引用资料卡、选中展开、添加材料 |
| R5 | 同文件右栏 Agent tab | 当前文稿语境下的 Agent 对话 |
| 无 | 上述两个页面没有该实例 | 用同一设计语言补入口/状态，不借旧视觉，不删除真实能力 |

## 1. 路由、入口、恢复位置

| 真实 route / 参数 | 必须保留的语义与来源 | 对应 mock | 已有测试 |
|---|---|---|---|
| `/agent` | `app/App.tsx` protectedRoute + OnboardingGate → `agent/ResearchAgentPage.tsx` → 同一个 `ResearchAgentConversationPage`；独立对话入口 | A0/A1 | `App.test.tsx` independent Agent / complete conversation surface；`ResearchAgentConversationPage.test.tsx` |
| `/agent?conversation_id=&knowledge_release_id=&task_id=&reference_knowledge_base_id=` | `ResearchAgentConversationPage` requested identity / `loadConversation`；已有会话的实际 `task_id`、参考库优先于新入口参数；绑定项目时请求 workspace=research | A1、C 的 scope 控件需补 | AgentUI（下文简称）independent workspace、project scope、citation release |
| `/agent?prompt=` / 首页 seed | `seedAgentDraft`、`searchParams.get('prompt')` 只预填、不自动调用付费模型；消耗 prompt 后用 replace 移除 | A0/C | AgentUI `restores a homepage question into the composer without submitting a paid run` |
| `/research/new`，可带 conversation/task/release | `NewResearchWorkspacePage`；初次打开不能空建 task；恢复会话、研究起点提案、地图；绑定已有 draft task 并不代表提案已确认 | R0 新建 → A0/R5 + 无（map） | `NewResearchWorkspacePage.test.tsx` no empty task、bound draft confirmation、pending proposal |
| `/research/existing` | `ExistingResearchEntryPage::establishProject`：名称、现阶段、可选方法取向、至少一份初始材料；只建一个项目，上传失败重试沿用 task | R0 新建入口需附已有研究入口 | `ExistingResearchEntryPage.test.tsx` creates one project/uploads every file |
| `/research/materials` | 全局研究材料 hub，项目/全部文件/个人记忆；不是单一研究工作台；`ResearchMaterialsPage` | R0/R4 扩展；记忆无实例 | `ResearchMaterialsPage.test.tsx` projects/files/memory |
| `/research/materials?task_id=&tab=files|memory` | 项目文件或项目记忆；单独 task_id 留在文件夹/列表，不强制跳正式工作台 | R0/R4 | `researchProjectWorkspaceModel.test.ts` keeps project folders in library；MaterialsPage tests |
| `/research/materials?task_id=&material_id=&parse_id=&segment_id=#...` | `App::ResearchMaterialsRoute` → `legacyResearchWorkspaceDestination` 移到 canonical materials，保留查询和 hash；`ResearchMaterialsPage` 内简化跳转不是完整路由契约 | R4 | `App.test.tsx` exact source route；WorkspaceModel position tests |
| `/research/:task_id` | `ResearchTaskNavigationRoute` 重新读取服务端 resume；仅接受同 task 的 phenomenon/match/framework/method；失败显示重试，不猜阶段 | R0 卡点击 | `ResearchTaskNavigationRoute.test.tsx` fresh navigation、reject escaping task、retry |
| `/research/:task_id/workspace/:tool?` | `ResearchProjectWorkspacePage` tool=map/materials/analysis/theory/method/writing/archive；缺失/非法 tool 恢复该项目最近合法位置，否则 task.lastCentralTool；确认 conversation.task_id 匹配 | R1–R5 + 无（7 工具入口） | `ResearchProjectWorkspacePage.test.tsx` wrong project rejected、restore central tool、conversation preservation |
| workspace `material_id,parse_id,segment_id` | `updateMaterialLocation` / `ResearchMaterialsPanel` 精确历史版本原文，不丢当前 conversation_id | R4 | ProjectWorkspace material segment identity；MaterialsPanel historical parse tests |
| workspace `document_id,section_id,version` | `researchWorkspaceDestination` 可序列化；`updateDocumentLocation` 写当前文稿上下文并保留 conversation_id。注意：当前 workbench接收 document/section，不接收 initialVersion；URL 有 version 不等于已支持旧版本直接渲染 | R2/R3 | WorkspaceModel position test；ProjectWorkspace section test；**历史版本 query 真正恢复未见专项覆盖** |
| legacy `/research/:id/phenomenon,match,framework,method` | `LegacyResearchWorkspaceRedirect` → map/theory/writing/method，search/hash 保留 | 兼容入口，不新增 mock path | `App.test.tsx` legacy routes；WorkspaceModel |
| `/research/tools` | 退役，重定向 `/app`；不可因 mock 改造复活旧学科工具页 | 无 | `App.test.tsx` retires sociology research tools |
| `/research` / `#/research/:mockId` | **目前生产 App 没有独立 `/research` 列表 route**；真实全研究入口为 `/app?research=all`（也有 `/research/materials` hub）。mock hash router/fixture id 不能直用 | R0/R1 | `App.tsx` route 表；App route tests |
| 全部受保护 routes | 保留登录加载/error/expired 与登录后 pathname+search+hash 回跳；不绕过 OnboardingGate | 所有 | `App.test.tsx` protected workspace / redirect tests |

## 2. Agent 细功能

本节 `A` = `app/agent/ResearchAgentConversationPage.tsx`；`AgentUI` = 同名 `.test.tsx`；`NewUI` = `app/agent/NewResearchWorkspacePage.test.tsx`；`AgentAPI` = `modules/research-agent/researchAgentApi.ts` / `.test.ts`。

| 功能 | 真实实现 / 必须保留 | mock 实例 | 已有测试 |
|---|---|---|---|
| 个性化空态与问题建议 | `PersonalCompanion`、`ResearchAgentBot`、`ResearchPromptCarousel::choosePrompt` 只写 draft 并 focus；中英文 locale；真实 agent profile/avatar 不能被 fixture 固定名替换 | A0 | AgentUI empty Agent / global English；`ResearchPromptCarousel.test.tsx` 5秒邀请、20不重复建议 |
| 发送 | `submitQuestion` / `submitDraft`；空白不发，trim后 ≤12000 字；Enter 发、Shift+Enter换行、IME composition不误发；draft controlled | C | AgentUI 12000 contract；NewUI composer server contract |
| 忙碌锁 | `canSubmit`、`isBusy`：loading/thinking/retrieving/answering/pausing/pause-failed、入口转换、上传或任何非 ready 附件期间不可提交；网络进行中拒重复 submit | C 需 busy/stop 扩展 | AgentUI stop confirmation / attachments；NewUI duplicate/retry tests |
| 联网开关 | `webSearchEnabled` 初始 true；下一轮写入 `web_search`；不是只切视觉图标；重试沿用原 request 的开关 | C 需显式控件 | AgentUI `sends the enabled web-search choice with the next question` |
| 标准/深入研究 | composer mode `standard` / `deep_research`，菜单退出/焦点回还；深入研究提示可关闭/会话内时限；embedding恢复深研报告继续普通协作，不重新跑一遍 | C/A1 扩展 | AgentUI mode menu、completed deep card、standard collaboration |
| 深研澄清与计划确认 | `DeepResearchMockFlow` 名字虽含 Mock，真实使用服务端 `research_ask/plan/step/result/waiting`；选已有意图、自由输入、跳过、确认计划、返回修改；等选择时不假装已完成 | A1/R5 扩展 | AgentUI segmented progress / reopen completed；AgentAPI stream parsing；NewUI research journey |
| 深研耗时/工具进度/结论 | `researchStepForTools`、`settleDeepResearchElapsed`、`deepResearchRecord` 恢复实际 tool trace/结果；仅有真实 lifecycle 才显示完成报告；4步骤百分比是现存 UI推算，不是 backend 精确进度 | A1/R1 扩展 | AgentUI completed answer / progress / stopped progress；report tests |
| 保存/继续正式研究 | `continueResearch` 先读 journey；无提案时走普通 Agent工具整理待确认起点；复用已有深研报告与引用；没有 proposal 或 confirmed phenomenon 不跳；传 conversation/release/task 到 `/research/new` | A1“放进研究”最接近，但语义不是复制任意回答 | AgentUI stays if no proposal / persisted handoff；NewUI bound journey |
| 指定参考知识库 | `CourseReferenceSelector` + `reference_knowledge_base_id`；新选择新会话；会话已有绑定优先，embedded可显式传入；个人库引用回调 `onOpenCourseCitation` | C scope补充 / A2 | AgentAPI `sends the selected course through the actual streaming request`；相关知识库集成测试在其他盘点范围 |
| 项目范围 | `ProjectScopeMenu` 可搜索全部项目、独立项、当前未知项目 fallback；archived项目不提供新建（当前已选可保留）；键盘上下/Escape/Tab；切scope新会话，未发送 draft保留 | C scope补充 | `ProjectScopeMenu.test.tsx` fifty projects / no result / dismissal；AgentUI unsent draft scope |
| 本地草稿 | `conversationStorageScope`、`readStoredDraft/persistDraft`：user+conversation或draft workspace/task隔离；localStorage而非仅tab，无 user不存；存储不可用可继续输入 | C | AgentUI account/conversation isolation；NewUI refresh / other account |
| 附加已上传材料 | `openMaterialAttachmentPicker`、`toggleAttachedMaterial`；读取用户可见agent materials，最多20份，只能ready，重复点移除；不在选择时自动发 | C 加号/附件 | `AgentMaterialAttachmentPicker.test.tsx` ready and unavailable states |
| 直接上传附件 | `uploadComposerMaterials` → `prepareAgentMaterialContext`（无task时幂等创建绑定）→ `addResearchLibraryMaterial`；多文件逐个加入；格式校验；1秒轮询 queued/processing；失败保留error；切会话丢弃旧响应 | C 加号 | AgentUI native file chooser；AgentPicker OCR/transcription；API material tests；**20上限/全部竞态未见专项整合测试** |
| 附件状态 | `attachmentStatusLabel` 区分queued/processing/failed、OCR required、transcription required/unavailable；未ready阻止发送，不伪造可读取 | C attachment条 | AgentPicker provider-dependent boundaries |
| 普通材料入口 | `openResearchMaterials`：bound research/task内侧开dialog，否则去全局 `/research/materials`；不能混成同一个匿名文件集合 | C / R4 | AgentUI one task-scoped research-material entry |
| 真实 streaming | `submitQuestion` 维护 status、delta、citations、tool steps、canvas patches；首次 turn_started 即落 conversation/run身份和URL，不等completion；generation计数拦截旧stream | A1 | AgentUI ignores late stream / bound props switches；ProjectWorkspace first conversation before completion |
| 自动断线重连 | `AgentAPI::streamAgentTurn` 对TypeError/截断stream指数退避重试最多3次；同 Idempotency-Key + 原完整payload；重放清空本次累积，避免重复答案 | A1 error/恢复扩展 | AgentAPI truncated mobile / repeated failure bounded；AgentUI automatic resumes |
| 请求/中断持久化 | `PendingTurnAttempt.request`、`persistPendingTurnAttempt`、`persistInterruptedTurn` 保存question/run/request/materialIds/部分答案/引用/tool/canvas；不能只缓存最后文本 | A1/C error恢复 | AgentUI original request resume；NewUI interrupted mobile / timed-out return |
| 暂停与失败暂停 | `stopGeneration` 调`stopAgentRun`后才abort；服务端仍running会轮询，失败进入pause-failed且禁止继续，允许“重试暂停”；若已completed重新load真实完成结果 | C 发送替stop；A1提示 | AgentUI waits stop confirmation/rejected pause；AgentAPI stops one server run |
| 离页/隐藏行为 | `leaveConversation`、`pagehide` 保存partial并 `keepalive` stop；scope/route切换取消旧load与stream；仅visibilitychange不暂停 | A1/R5 | AgentUI pagehide versus visibility / stops on leave |
| 服务端unfinished恢复 | `loadConversation`、`restoreRecovery`、`resumeRecovery`：running/failed/interrupted/awaiting_clarification/awaiting_plan_confirmation恢复；展示所有保存未完轮次，不在重开时执行；用户点选恢复对应原request/key；保留较早暂停回答 | A1 | AgentUI every persisted unfinished / retains earlier paused / original request；NewUI explicit resume |
| 错误真实性 | `localizedTurnFailure`、stream terminal检验；401/403重新登录，422问题格式，截断可重试；不生成假答案、不把旧工具失败显示完成 | A1/C | AgentAPI validation / tool_failed；App failed/repeated tools；NewUI boundary tests |
| GFM/引用编号 | `AgentAnswerMarkdown` + `citationPresentation`，表格/列表/小数保留，中文/ASCII引用令牌解析成真实来源编号；未知/歧义/删除/未完整stream令牌不造source | A1引用 | `AgentAnswerMarkdown.test.tsx` stable numbering；`citationPresentation.test.ts` unknown/deleted/incomplete |
| 回答操作 | `AssistantActions::copyAnswer` 复制真实可见文本并剥内部引用令牌，clipboard拒绝显示失败；“重新生成”真实follow-up turn；无死反馈按钮 | A1 actions | AgentUI live copy/regenerate；NewUI clipboard rejects / no dead feedback |
| 引用原文抽屉 | `openCitation` + `basisContent`、`ResearchContextRail`；按引用所在turn的release固定知识来源；个人材料固定task/material/parse/segment/locator；网页只开放http(s)源；来源未知不伪造position/link | A2/R4 | AgentUI exact personal locator / web source / per-turn release；NewUI no release no link |
| 删除来源后的隐私 | `handleMaterialDeleted`、`tombstoneConversationMaterial`：所有可见相关引用标tombstone；已引用该个人材料的历史/正在流式答案遮蔽，不可继续打开原文，后到delta也遮蔽 | A2/A1已删除状态需补 | AgentUI all tombstones / hides live answer；citationPresentation deleted tests |
| 工具过程 | `updateToolSteps` 按call_id区分同工具多次调用；`persistedToolSteps` / `attachLocalToolSteps` 保留服务端未回显的本地trace；started/finished/failed/interrupted严格区分；完整input/output可展开，结果可进入Basis | A1 / A2扩展 | AgentUI complete output/activity result；NewUI local traces；App repeated tools |
| 研究面板 | `ResearchContextRail::SectionsRail` 知识库、网页、用户文件、工作流程分别计数/空态，折叠状态稳定；单一toggle、返回依据总览、手动关闭不被自动重开 | A2/R4的拓展 | `ResearchContextRail.test.tsx` stacked sections/empty/basis；AgentUI panel stays closed |
| 草稿/来源跨pane | desktop history rail，mobile研究记录drawer；切mobile pane保留组件不remount；长会话滚动与输入自适应 | A1/R5 | AgentUI mobile history；NewUI mobile draft；ProjectWorkspace no remount |
| 深研导出 | `exportResearchReport` → `buildResearchReport` → DOCX 或 printable PDF；真实各轮问答、引用分组去重、删引用排除、文件名消毒、安全正文渲染、导出busy/error | A1/R1 export扩展 | `modules/research-agent/researchReport.test.ts` docx/print/reference/deleted/XSS |

### 会话与项目记录

| 功能 | 源文件/稳定标记 | mock实例 | 已有测试 |
|---|---|---|---|
| 列表读取与失败降级 | A `AgentConversationHistoryRail`、`listAgentConversations`；历史加载失败仍能新对话 | A1 overflow + 全局sidebar需承接 | AgentUI history；NewUI abort history no error |
| 项目分组/独立/不可用 | `ProjectConversationList` + `modules/research-projects/projectContext::groupProjectConversations`；项目展开、项目材料/上下文链接；找不到所属项目仍保留会话 | R0/A1记录入口 | `ProjectConversationList.test.tsx`、`projectContext.test.ts` |
| 新建项目 | rail `createProject` + `ProjectCreatePopover`，名称≤300，busy/error/Escape/outside取消，成功在该task新对话 | R0新建 / A1记录 | AgentUI dismissible create popover |
| 会话改名/删除 | A `renameSavedConversation`/`deleteSavedConversation` + rail overflow；改名≤120、空白/未变化不写；删除需确认，失败不从列表移除；active删除回新会话 | A1“对话选项” | AgentUI rename/delete；AgentAPI DELETE Idempotency-Key |
| 删除项目 | `ProjectActionsMenu` + A `deleteSavedProject`；明确材料和研究内容删除、所属对话转独立；当前run/upload期间禁止；成功清task/附件并调整route；失败保留 | R0项目菜单需补 | `ProjectActionsMenu.test.tsx` confirm/failure；projectContext仅覆盖分组，不证明删除副作用全链路 |
| 列表分页边界 | `modules/research-projects/projectApi::listResearchProjects` 跟随next_cursor(limit100)直到全部；不能仅取首屏来填scope | C/R0 | ScopeMenu fifty projects；**未见分页API专项测试**（projectContext仅测试分组） |

## 3. 新建研究、正式三栏与地图

| 功能 | 真实实现 / 必须保留 | mock实例 | 已有测试 |
|---|---|---|---|
| 从材料开始 | `NewResearchWorkspacePage::startFromMaterials` 校验researchMaterialsModel允许格式、复用materialEntryRequestKey/task、逐个初始上传，回写task_id，显示文件名与失败/导入状态 | R0入口 / C附件；map空态无实例 | NewUI no empty task / first materials on one draft |
| 研究起点确认 | `loadJourney`/`confirmResearchStart` / `ResearchStartProposalCard`：phenomenon、researchIntent、context、proposal.version，Idempotency-Key=`research-start:${proposalId}`；确认前不能自动理论匹配；重复/失败重试同事务 | R5对话内确认卡需补 | NewUI duplicate click/exact retry、pending confirmation |
| 提案恢复失败 | `ResearchStartRecoveryError` 独立重试或继续对话，对话可用；task_bound不自动跳走，用户“展开文档节点”后进入canonical工作台 | R5 | NewUI journey error / bound until explicit continue |
| 正式三栏协调 | `ResearchProjectWorkspacePage` 永久中心+Agent、左history rail；tool换只换中心能力；mobile内容/Agent不销毁；分隔条拖动/键盘(24px)/Home/End、320–680宽度本地记忆 | R2/R3/R5，视觉左右布局可调整 | ProjectWorkspace mobile/identity；NewUI及Workbench resize tests |
| Agent绑定文稿上下文 | `documentContext`/`onWorkspaceContextChange` 把documentId/sectionId/documentVersion/theoryPlanId传共享Agent；onTurnCompleted刷新中心，不重新启动会话；讨论节点/段落送原文本与稳定ID | R3↔R5 | ProjectWorkspace selected section；Workbench refresh embedded；`researchCollaboration.test.ts` |
| 地图真实数据源 | `researchCanvasProjection::projectResearchCanvas` 只project persisted research_map + typed canvas_patch；工具活动/回答文本不被凭空变节点；`formalResearchCanvasProjection` 合并正式现象/理论/文稿/confirmed比较/循环patch | 无，必须设计map同语言入口 | projection/layout/formalProjection `.test.ts` |
| 地图基本操作 | `ResearchMapCanvas` ReactFlow pan/zoom/fit、MiniMap、可拖节点、保留拖动坐标、新节点不跳；全屏、重新整理、关系显示、focus depth=1/2/all；目录按类型分组/定位/Escape | 无，不能用R2大纲取代整个map | `ResearchMapCanvas.test.tsx` navigation/directory；`researchCanvasLayout.test.ts` dragged positions |
| 节点内容与继续 | 节点类型question/phenomenon/theory/claim/evidence/gap/synthesis/document，status真实显示；inspector excerpt/来源；节点double click/继续研究→有node id的discussion，NewResearch预填而非自动发送 | R2选中 + R4详情 + R5讨论；无map实例 | MapCanvas inspector/citation；NewUI explicit follow-up prompt |
| 文稿节点整合 | `collapseDocumentNodes` 把章节折为单个可展开manuscript，保留论证节点/连接/证据检查；不是开第二个嵌套PageShell或第二Agent | R2/R3/R5 | Workbench one expandable manuscript；MapCanvas manuscript+evidence |
| 卡片编辑/冲突 | `CanvasCardEditor` title≤240、summary≤1200；`saveCanvasNode`传expected_title/summary/version；不修改citation证据；409保留草稿、reload最新需再确认保存；Agent建议“核对采纳/暂不采纳”；正式节点只讨论，不当普通card编辑 | R4卡详情模式扩展 | `CanvasCardEditor.test.tsx` original/version/no evidence mutation/conflict |

## 4. 文稿、理论与交付

`W` = `app/research-workspace/ResearchDocumentWorkbench.tsx`。这部分功能适合嵌入 mock R2–R5 骨架，不能用裸 `contentEditable` 替换。

| 功能 | 源文件/稳定标记与限制 | mock实例 | 已有测试 |
|---|---|---|---|
| 读取真实文稿/章节 | W `selectCurrentDocument` 优先指定document，再current_framework/current_theory_plan，再现有item；真实sections优先，M4/M5 fallback只是空态，不是生成内容 | R2/R3 | Workbench requested section / no mock runtime |
| 正文编辑 | W TipTap + Markdown + StarterKit；全文/本节切换、编辑本节/讨论本节；rich markdown不扁平化，saveState显示 | R3 | Workbench、`documentDiff.test.ts` rich marks/heading/list |
| 自动保存并发 | W `saveSection` 900ms debounce，in-flight promise复用、CAS expected_version、新版本循环追赶网络等待时继续输入；不同section切换先save；不能回填旧response覆盖新增字 | R3保存状态需补 | Workbench及文档API测试为现存覆盖；**持续输入/900ms竞态当前未见专门测试** |
| 选中段落讨论 | W `capturePassage` DOM单/跨section解析，最多2400字；`composeResearchDiscussion` 保留问题+选中内容；当前section或跨节null准确送Agent | R3/R5 | AgentUI selected passage；`researchCollaboration.test.ts` |
| 局部建议diff/决策 | W `acceptProposal`/`rejectProposal` / `createDocumentDiff`；显示before/after/rationale，stale base 禁accept，可“按当前版本重新比较”但不能因此绕CAS；有未保存编辑时禁止accept | R3/R5建议卡需补 | Workbench local diff/stale baseline；M5 proposal tests |
| 开始/重试理论匹配 | W `startMatching` 必须nav.allowed_actions含start_matching + confirmed phenomenon + knowledge_release；expected_task_version/phenomenon版本/固定release；失败用同 idempotency key；不自行重跑已存在match | R1阶段 / R5动作需补 | Workbench server snapshot / retry empty run / same key |
| 理论候选与决策 | W `recordTheoryDecision`/`submitTheoryDecisions`：逐个adopt/combine/retain/exclude，所有候选都有决定才提交，candidate_version；多理论填解释、前提兼容、支持/排除/区分证据5项；use_assignments/related ids不能丢 | R3/R5扩展 | Workbench theory confirmation；**五字段组合全部前端分支未见逐项测试** |
| 部分匹配结果确认 | W `acknowledgePartialMatch` 先提交failed/acknowledged候选IDs及reason，再按最新match.version保存decisions，completion_basis明确partial_with_user_ack | R5确认卡需补 | Workbench相关流程/正式API；未见单独全分支测试 |
| 确认理论方案 | W `confirmTheoryPlanChoice` 用decision_set version，按钮服从allowed_actions；成功只跟最新服务端resume_path，不固定跳mock第四步 | R1/R5 | Workbench `enters M5 only through latest server resume path` |
| 版本确认/恢复 | W `confirmDocument`先save再expected_version确认；`restoreVersion` source_version+expected_version生成恢复版、历史不删 | R1 / R3历史面板需补 | Workbench / `M5ResearchDelivery.test.tsx` restore failure |
| 排版/引用设置 | W `applyFormatting` 保存先行，模板chinese-social-science/asa/custom、CSL GB/T7714/ASA/Chicago/自定义、locale zh/en、导入CSL/CSS；改变排版也生成新版本 | R1导出 / R3设置需补 | Workbench template/CSL new version；`documentExport.test.ts` official CSL & safe CSS |
| 文稿导出四种 | W `exportFormalDocument` Markdown、DOCX、打印/另存PDF、audit JSON；`loadFormalExport`先保存最新编辑；citation manifest状态/原版本保留，不把没有csl元信息的verified谎称核验完成；失败不能假报下载 | R1导出 | `documentExport.test.ts` unresolved citations/real docx/CSS；Workbench formatting |
| M5生成与重试 | `M5ResearchDeliveryController::generate` + `M5GenerationState`：只有当前确认theory plan下无document/pending proposal才生成；真实stream未产可审批草稿为失败；原prompt+key重试 | R5/R3空态扩展 | `M5ResearchDelivery.test.tsx` exact generation retry；`m5MutationAttempt.test.ts` |
| M5独立审阅 | `M5ResearchDeliveryPanel` / `M5ProposalReview`：pending/accepted/rejected/aborted，create vs revise_section，before/after，knowledge release/model/run provenance，拒绝必填reason；双击锁，失败留可重试 | R3/R5扩展 | M5 tests before/after/locks/reject reason/provenance |
| M5完成门禁 | `M5CompletionGate` ready + saveState=saved + 非busy/非completed；逐项checks/blockers，不能把不满足项藏掉；依据`api/m5ResearchDelivery::loadM5ResearchDelivery`真实快照 | R1阶段状态/完成动作需补 | M5 tests blockers/never confirms unsaved |
| 固定分析依据 | `M5ResearchAnalysisBasis` 展示当前文稿版本引用的analysis hash、memo/comparison等来源，无使用也明确 | R4资料/证据模式 | M5ResearchAnalysisBasis / M5ResearchDeliveryAnalysisBasis tests |
| M5正式成果包 | `M5ExportPanel` confirmed && gateReady && saved才允许；markdown/json两种（与W快捷四种导出不同）；下载结果/错误可见 | R1导出 | M5 export unavailable until confirmed；`api/m5ResearchDelivery.test.ts` |

## 5. 材料、分析、方法、记忆、归档

这些真实流程在两份mock中没有完整页面实例；应保留能力并用相同组件语汇容纳，不能因为视觉未画全而删模块或添加假自动化。

| 功能 | 源文件 / 稳定标记 | mock映射 | 已有测试 |
|---|---|---|---|
| 全局hub项目/文件筛选 | `app/research/ResearchMaterialsPage`：项目搜索、全部文件搜索（文件名+owner标题）、文档/媒体类别、owner filter、名称/更新排序、逐项目独立加载/失败重试/计数；某项目慢不挡其它项目 | R0/R4 | MaterialsPage searchable rows/per-project/error retry |
| hub材料上传/删除 | 同文件 `addMaterial/startFromMaterials/removeMaterial`：选项目上传，空库从材料建立研究；删除确认说明Agent不再引用；busy/notice/error | R4添加材料 | MaterialsPage upload completion / manages files |
| 项目阅读与搜索 | `ResearchMaterialsPanel` / `MaterialLibraryView` / `MaterialReaderView`：库与阅读台互切，跨ready材料检索、准确hit定位、文档内部搜索、大纲、24段分页、页/segment跳转、历史parse读取、不提前覆盖route位置 | R4→R3来源阅读 | MaterialsPanel exact locator/cross-search/long-doc/pagination/historical tests |
| 材料上传解析生命周期 | `handleFileChange/retry/remove`；真实accept含PDF/DOCX/TXT/MD/Markdown/MP3/M4A/WAV/MP4/WebM，由researchMaterialsModel校验extension/MIME；type/kind、queued/processing轮询、重新解析、明确删除确认；保留新上传行不被旧列表响应抹掉 | R4/C | MaterialsPanel upload late-list/race/reparse/delete；MaterialsModel MIME/format tests |
| 媒体能力边界 | 原有音视频转写原文可以阅读、带speaker/timecode；普通阅读页不暴露未接好的转写或coding入口，图片不能作为研究文档选择；不能按mock视频图标宣称任意视频可分析 | R4 | MaterialsPanel reads existing media without transcription/coding；MaterialsModel locators |
| 精确标注 | `MaterialAnnotationDrawer`、Panel `selectionDraftFromDomRange`/`createAnalysisAnnotation`；只接受同一source segment选区，UTF-16→Python code-point offsets；description/reflection独立、kind/case/observedAt；跨段选取清旧草稿 | R3选文/R4详情扩展 | MaterialsPanel selection and save fields；`researchMaterialSelection.test.ts` |
| 专业材料档案 | `ProfessionalMaterialArchive::saveProfile`：研究角色、specific_type、stage、sensitivity、consent_scope、deidentification_status、model_processing_scope、tags/batch/collection；受限仍可人工读，但Agent检索资格由已设策略决定，不能默认全放行 | R4详情需扩展 | `ProfessionalMaterialArchive.test.tsx` restrictions & explicit policy |
| 档案组织与批量导入 | 同文件 addBatch/uploadBatchFiles/addCollection/addCase/addRelation：批次多文件逐结果（含207部分成功），集合/个案属性/关联材料/关系类型说明，不复制材料 | R4无具体实例 | `professionalMaterialsApi.test.ts` 207 per-file；**多数组织UI分支未见专项测试** |
| 文献导入/导出/DOI | 同文件 importLiterature/exportLiterature/addByDoi：BibTeX/RIS/CSL-JSON、DOI核对加入、重复提示保留待核验 | R4/R1扩展 | professionalMaterials API tests有边界；**格式/DOI按钮未见专项UI测试** |
| 分析备忘 | `ResearchAnalysisPanel::saveMemo/decideMemo` / `ResearchAnalysisWorkspace`：confirmed user记录和Agent候选分开、typed memo、明确annotation links；候选确认/拒绝需reason+visible CAS version | R3/R4/R5拓展 | ResearchAnalysisWorkspace/Panel/CandidateCard/API tests |
| 案例比较 | `ResearchCaseComparison`：至少2个case/time/material units+来源annotations、title/question、支持/反例/矛盾至少一项、理论含义；竞争解释/缺口/后续行动类型优先级；Agent候选必须reason/version决策，只有confirmed进入正式map | R3/R4拓展 | AnalysisWorkspace create comparison/diagnostics；formalProjection confirmed only |
| 研究证据循环 | `ResearchCyclePanel` + `researchCycleModel`：gap source/id/hash/theory plan/version/destination/priority、coverage/reporting hints；只是可追溯提示，不得造score/审批按钮 | R4/R1状态拓展 | ResearchCyclePanel traceable gap routing/no score/approval；formalProjection cycle patch |
| 方法计划 | `modules/research-method/MethodPlanWorkspace`：loading先于empty-create；从已确认framework/theory prerequisites创建 qualitative/quantitative/mixed/deferred；method_kind/rationale/sections逐节由user决定后CAS存新version | R2/R3/R5扩展 | MethodPlanWorkspace load/edit tests；researchMethodApi deferred |
| 方法确认/审校/历史 | 同组件 `canConfirm`：所有REQUIRED_SECTIONS为user且无blocking unresolved review，stale/confirmed锁编辑；审校意见+blocking、mark resolved、restore版本、stale说明与按当前依据重建；固定知识/证据/伦理/材料上下文可见 | R1/R3/R4扩展 | MethodPlanWorkspace review note/blocking；**stale/restore全部UI路径未见专项测试** |
| 个人/项目记忆 | `ResearchMemoryPanel` + `modules/research-memory`：taskId null个人，否则项目；overview异步、details折叠、搜索/来源筛选/时间排序、创建/编辑/CAS冲突保留draft、UTF8字节上限和entry容量 | R0/R4没有实例，需保留原入口 | ResearchMemoryPanel scope/version/conflict/UTF8/capacity tests |
| 记忆权限与来源 | 同组件 `toggle`：use_memory和learn_memory独立；来源quote、来源对话link、最多50版历史、显式删除连历史而原对话保留；后台更改scope version后刷新、旧overview不可覆盖新写结果 | 无 | ResearchMemoryPanel separate flags/fresh scope/stale response/failed refresh；memoryApi validation |
| DEV预览边界 | `ResearchMaterialsPage preview=files`、MemoryPanel preview mode都受DEV/查询控制；preview写入仅本地，必须明确示例不能进入真实保存流 | 无 | MemoryPanel previews without network writes；MaterialsPage真实流程测试 |
| 项目归档 | `modules/research-exchange/ResearchArchivePanel`：真实BagIt/QDPX/native restore JSON/loss report/audit/manuscript归档导出，显示loss/blockingLossCount及审计type/version/time；**QDPX导入入口已退役**不能恢复 | R1导出下补“研究归档”/tool | ResearchArchivePanel retired import absent；researchExchangeApi generated client |

## 6. 不得改变的数据流与权限边界

1. 共享流：界面 → `modules/research-agent/index.ts` → gateway → AgentAPI → 统一 `apiClient.buildUrl` → `/api/agent/turns`。不得在新视觉页面另写 fetch/DTO，生成API文件不得手改。
2. 每轮完整契约：`conversation_id,message,mode,workspace,web_search,task_id,document_id,section_id,document_version,theory_plan_id,material_ids,reference_knowledge_base_id,deep_research_run_id,deep_research_action,deep_research_selection` + Idempotency-Key。恢复必须使用接受原问题时的完整request，不因用户后来切tool/section/scope而重算。
3. 独立workspace='agent'时 task/document/section/version/theoryPlan 都为null；research时才传研究上下文。已有会话的真实task和参考库绑定优先，不能任意把旧会话“移动”成当前视觉选项。
4. 所有Agent HTTP带credentials include；401/403错误不能换匿名路径重试。owner校验必须由后端契约落实，本桥接前端只可确认资源路径/ID绑定与错误处理，不能声称审核了后端授权。
5. conversation_id 与 task_id身份验证在ProjectWorkspace读取阶段阻止跨项目；resume storage只接受同task合法tool路径；不能把任意外来return/resume URL直接当项目资源。
6. 引用是带来源种类与版本的结构，不是fixture标题+段3：knowledge_base_id/knowledge_id/release，或task/material/parse/segment/locator，或http(s) web。保留deleted标志及source redaction。
7. mutation的 `expected_*_version`、Idempotency-Key、visible candidate IDs、source版本、拒绝/确认reason、analysis hashes、model/run provenance都要传递。视觉“完成”不替代后端确认响应。
8. 材料model_processing/consent/deidentification策略、文稿pending proposal/unsaved/CAS门禁、方法required user decision/review/stale状态均不能以禁用样式清理为名解除。
9. 仅有静态构建、mock成功、组件单测不能声明真实模型/资料读取/导出通过；空状态不注入“典型论文”假文稿。

## 7. Mock 有而真实无，或语义不一致：单列建议，不假接

| mock控件/行为 | 盘点结论 | 可实施建议（需父任务决定，不能默认为已有） |
|---|---|---|
| Agent“存为笔记” | mock无onClick；已审Agent/Research能力无把回答存作笔记的接口/流程；记忆不等于笔记 | 不显示可用成功态；明确用户后再定义note destination、引用保存与API |
| Agent“回答不好” | mock无handler；真实NewUI测试明确不得死feedback按钮 | 第一轮不暴露空动作；后续若需收反馈先确定API/隐私/结果 |
| Agent“放进研究” | mock无handler；真实有继续研究起点journey，但不是任意回答直接拷贝到既有文稿 | 可映射真实continueResearch，并采用符合其真实语义的文案；不可跳过提案确认 |
| Agent“复制” | mock空handler，但真实已有Clipboard成功/失败处理 | 绑定真实AssistantActions，不复制fixture或泄露内部引用tokens |
| Agent对话选项 | mock空handler；真实改名/删除已在history rail | 挂同一controller可实现，别新建另一份列表state |
| Composer加号/引用资料 | mock按钮空handler；真实上传、现有材料picker、项目scope/联网/mode更多 | 利用真实callbacks/state；新layout保留全部控制，尤其上传进度/ready门禁 |
| Research列表“新建研究/从问题开始” | mock按钮空handler；真实有 `/research/new` 和 `/research/existing` | 连接真实路由；原fake research id不传播到真实API |
| 四阶段stepper/百分比 | mock仅fixture.stage；真实7工具+不同后端阶段、formal confirmation | 仅展示经审定映射；不要让点stepper直接confirm/伪造完成 |
| 文稿“加一节” | mock空handler；W加载任意server sections，但未见当前新增section UI/专用交互 | 作为新增功能需另定义稳定section_id、source/evidence/version语义；不得本地append后称保存 |
| 左大纲点击 | mock所有a指向同一mock route；真实可选section并保存后切换 | 接W.activeSectionId与URL section_id，不能href回整页造成草稿丢失 |
| 中央contentEditable | mock无onInput持久化，无版本/未保存状态 | 必须保留TipTap/saveSection版本流，可变视觉容器不可只留裸editable |
| 右栏“让它改这一节” | mockComposer没有onSend，发送只清输入；真实Agent只生成建议待审 | 绑定真实document/section/version上下文，不把Agent内容直接覆写正式文稿 |
| 资料“从知识库添加” | mock无handler；真实有参考库选择、材料附件与项目上传，但本盘点未见一键将库中material复制/关联为正式项目材料的完整确认流程 | 只能映射已支持的选择语义；要“导入到项目”需另定ownership/引用关联契约 |
| 来源统一“知识库打开/第3段” | mock来源均走fixture library link且段数固定；真实来源多类别+历史parse+release+deleted | 只展示真实locator；按kind分流；没有位置时明确无可展示位置 |
| 顶栏统一导出 | mock空handler；真实深研报告、当前文稿、确认成果包、完整归档四类 | 下拉区分对象与门禁，不用一个假download覆盖全部 |

## 8. 已发现的基线风险（不当作本次改造引入）

- 当前 `App.tsx` 将 `/knowledge/*` 一律跳 `/library`，而 A 的 `knowledgeEntryHref/KnowledgeHandoffCards` 仍构造 `/knowledge/...?...release&return_to=...`，相关历史测试也断言旧link。视觉替换不应默默宣称精确知识原文跳转仍可用；需与知识库盘点合并确认可用canonical目标。
- `researchWorkspaceDestination` 支持version查询，但实际 `ResearchProjectWorkspacePage` 只向W传document/section，并将W当前版本写回URL。这是“URL能编码”与“渲染指定历史版本”差异，不可直接补一个假历史选择器。
- W有完整文稿自动保存逻辑，但现有Workbench测试重点为投影/route/匹配/建议，不足以证明“请求中连续输入→切节→导出”的所有竞态。改造需新增/补测而非仅维持快照。
- 上传错误提示中部分文案仍只写PDF/DOCX/TXT/Markdown，但 `RESEARCH_MATERIAL_ACCEPT` 和validator已接受MP3/M4A/WAV/MP4/WebM；能力盘点以真实契约为准，不能因旧文案缩窄格式。实际转写可用性仍需provider与解析状态。
- 深研组件名 `DeepResearchMockFlow` 与正式实现相连，不能按名字判断为应删除mock；反过来 `src/mock/pages/*` 的setTimeout回复才是纯展示逻辑。
- `modules/research-workspace/state.ts` 的版本化reducer有单测，但此轮所审route主控制器的行为以实际import/call链为准；不可仅凭该model存在就声称已有完整编辑/undo/任务队列UI。

## 9. 改造后最小回归验收顺序

以下是推荐检查，不是本轮已跑结果。

1. 单元/组件：AgentUI + NewUI + AgentAPI + AgentAnswerMarkdown/citationPresentation + ProjectScope/Conversation/Actions + ProjectWorkspace/WorkspaceModel + App/ResearchTaskNavigationRoute。
2. 文稿与地图：Workbench、MapCanvas、CanvasCardEditor、researchCanvasProjection/formalProjection/layout/collaboration、documentDiff/export、M5ResearchDelivery/AnalysisBasis、api/m5ResearchDelivery。
3. 材料与其它工具：ResearchMaterialsPage/Panel/selection/AgentPicker/ProfessionalArchive、AnalysisWorkspace/Panel/Candidate/Case相关、Cycle、MethodPlanWorkspace/API、MemoryPanel/API、ResearchArchivePanel/API。
4. 最关键手工/集成场景：新空会话预填不发 → 开联网/选库/选项目/附文件 →真实send →途中断线同key恢复 →暂停失败/重试→离页重开仍暂停→显式resume→来源打开与源删除遮蔽→改名/删会话/删项目。
5. 正式研究：已有提案恢复→确认一次→保留conversation进入7工具→map节点/文稿/片段对话→真实建议review→持续编辑自动保存→版本冲突→确认门禁→导出最新版本与引用审计。
6. 浏览器导航：Back/Forward、直接深链、项目间切换、手机pane/outline切换不remount活跃Agent；晚到的stream/material/detail/overview不能覆盖新对象；拒绝剪贴板或弹窗后反馈真实失败。
7. 测试命令用仓库当前脚本 `npm run test -- <上述相关文件>`、`npm run typecheck`、`npm run lint` 及实际变更影响面需要的boundary/style检查；逐项记录通过/失败/未执行，不能把此报告的“已有测试”列写成新代码已通过。

## 交付状态

本报告已完成静态源码盘点与mock映射；源码起始读取时git status为空，末次核对已可见父任务并行实施变更，此报告保留的是功能基线而非对父任务最终diff的验收。本人仅写此报告，无实施源码修改，无截图，无Mac/浏览器操作。功能矩阵中的“无mock实例”需要在同一设计语言里补呈现；“mock独有”只列建议，未实现或伪造任何功能。

## 2026-10-03：界面重写边界

用户已明确否定旧布局上的样式覆盖方案。应用界面重新从 mock 的页面结构实现，只复用接口、状态操作与编辑/图谱等功能引擎；旧页面仅作功能对照。官网 FoundationPage 保持独立冻结。

外观选择为当前浏览器的本地偏好，提供跟随系统、浅色、深色，刷新后保持，不写入账户 API。共享 token 和既有官网 shader 会跟随全局色彩偏好；官网源码未改。

### 新版展示层的边界

- 应用壳：ApplicationFrame 负责固定视口、240/64 侧栏、手机抽屉与唯一主内容滚动区；PageShell 仅接账户和导航状态。
- 对话：ConversationLayout、ConversationComposer、ConversationTurn、ConversationSourcePanel、ConversationResearchFlow 与 ConversationHistoryView 分开呈现。原流式协议、重试/暂停、草稿、引用版本和项目操作作为控制逻辑接入。
- 账户与引导：登录/注册及引导均重建独立视图，账户请求与步骤控制抽出。设置使用独立 controller、分类表单和原生 dialog 焦点边界。
- 知识：资料卡片、阅读正文/知识侧栏、图谱、导入重新排布。复用 Cytoscape 与知识编辑数据能力，不复用旧工作台展示壳。
- 研究：文稿/材料大纲进入左栏，中央保留真实编辑器或地图引擎，资料/Agent 位于右栏；手机以面板切换提供完整入口。
- 共享/发现/连接/订阅与后台：分别采用目录卡片、阅读面板、设置行和数据表，不保留原装饰眉标。

旧 app.css、mobile.css 与 Agent 页的叠加样式已退出运行入口；新版只从 qx token 取外观。官网 Foundation 目录、产品首页路由和 mock 标准仍保持不变。

### 此次整合发现并处理

- 空对话到有内容时保持同一个 composer 挂载，避免输入节点替换造成焦点和继续输入问题。
- 对话的工具菜单进入原生 popover 顶层，按实际上下空间定位；附件/上下文共用一个滚动区，尺寸受实际对话容器约束。
- URL 型引用在 Markdown 自动链接解析前识别，保留未知/删除引用保护规则。
- 资料翻页滚动至新正文起点，保留原文精确片段定位。

以上是实现记录，不能替代浏览器验收。新版尚需按路由逐一确认深浅模式、390px、短窗口、非空数据、发送停止、来源抽屉、导入/注册及设置操作；不沿用旧版 QA 的通过结论。


### 2026-10-03：可选双层侧栏与角色资料

- 设置“使用偏好”中的“新侧栏布局”默认关闭，原侧栏仍为默认界面。开启后桌面左侧保留64px图标导航，旁边为240px对话与研究记录区；常驻展开按钮可收起记录区。偏好按浏览器保存，即时生效，切换不重建主内容或清空草稿。
- 760px及以下仍使用手机抽屉；回到桌面时退出抽屉状态，释放滚动与焦点约束。导航、研究历史和账户入口保持可达。
- 左下角AI头像先打开菜单，提供编辑角色、记忆、设置、剩余额度与升级入口。既有通知入口与通知面板保留，不新增另一个悬浮头像。
- 角色身份使用右侧原生对话框，手机为底部面板。七种形象、颜色、名字和说话方式使用现有Agent Profile API保存，与全站共享同一缓存。未保存和失败的草稿在关闭/重开及页签切换时保留；切换账户重置私有状态。
- 记忆页签使用真实个人记忆模块，提供搜索、来源、修改、删除确认、历史和记忆开关。没有新增不可用的“灵魂文件”或连接状态。干净角色表单随其他设置入口的保存更新，有修改的草稿不会被后台刷新覆盖。
- 首页下方研究卡保持三列等宽，单项不撑满整行；上方问候、头像、输入和快捷入口不调整。Research的项目、知识库、联网和材料工具位于输入框内部，手机横向滚动保留所有入口。
- 已合并的新官网采用自己的展示标题token，保留原Foundation布局和小平组件。价格文案按确认后的官方标价10%更新；模型示意注明当前只提供GPT6 Luna，避免展示图被误认为已支持全部模型。

实现验证以最终提交的CI与浏览器验收记录为准。前端代码检查、单元测试和构建不替代真实模型、支付和生产部署验收。

发布收尾：演示用 src/mock 与 mock.html 已从发布树移除；design-system.html 保留。原 mock 仍可在设计分支历史中查阅。
