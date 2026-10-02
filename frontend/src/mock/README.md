# Everplain 界面 Mock

这是重做整个应用 UI 的参照稿：纯前端、假数据、不接后端。照着它改真实页面，改完这个目录整个删掉。

打开方式：`npm run dev`，然后访问 `http://localhost:5196/mock.html`。右下角「全部页面」可以跳到任意一页。组件样张在 `/design-system.html`。

## 哪一页对应哪一页

| Mock | 真实路由 | 说明 |
| --- | --- | --- |
| `#/login` | `/login`、`/register` | 单列居中，邮箱和密码分两屏 |
| `#/setup/1`–`4` | `/welcome/setup`（计划中） | 导入 → 取名与外观 → 问卷 → 生成图谱，每一步都能跳过 |
| `#/` | `/app` | 问候 + 输入框，下面是「接着研究」「最近收进来的」 |
| `#/library` | `/library` | 卡片网格 + 搜索 + 主题/类型筛选；「添加」打开导入弹窗 |
| `#/library/m1` | 新增资料详情 | 左边读原文，右边知识点、关联、用在了哪个研究 |
| `#/graph` | 新增，次级视图 | 同心圆：Agent 居中，主题第一圈，资料外圈。真实实现用 `ObsidianKnowledgeGraph` 换 concentric 布局 |
| `#/agent`、`#/agent/c1` | `/agent` | 空状态居中问候；对话里用户灰气泡、Agent 衬线正文；引用点开右侧来源抽屉 |
| `#/research` | `/app?research=all` | 研究卡片，四段进度条 |
| `#/research/r1` | `/research/:id/workspace` | 左大纲、中文稿、右资料/Agent |
| `?settings` | `/settings` 弹窗 | 我的 Agent、记忆、导入来源、外观、账号与数据 |

## 改真实页面时的规矩

1. **样式只用全局层。** 按钮、输入、卡片、列表行、标签、菜单、气泡、提示一律用 `src/styles/components.css` 里的 `qx-*` 类；页面 CSS 只管布局。颜色、字号、圆角、阴影只能写 `var(--qx-*)`，不写 `#212121`、`13px`、`border-radius: 9px` 这类字面值。缺什么先加 token，再用。
2. **圆角按物件选**：标签 tag，侧栏/菜单行 item，卡片 card，多行输入 field，面板 panel，弹窗 modal，按钮和单行输入 pill。
3. **衬线给内容，无衬线给界面。** 页面题目、卡片标题、Agent 回答、原文、文稿用 `--qx-font-reading`；导航、按钮、字段用 `--qx-font-ui`。
4. **删掉没有信息量的小字。** 11px 加宽字距的眉标、"AI 将为你……"、"当前研究"这类领读词、重复标题的副标题，直接删。最小字号是 meta（13px）。
5. **Agent 角色贯穿全站**：侧栏底部、首页问候、对话头像、引导、图谱中心都是用户选的那个角色，状态跟着场景换（问候 greet、等待回复 think、导入/生成 work）。正式代码用官网 PR #4 的 `src/modules/agent-avatar`，这里的 `agent-avatar/` 只是它的拷贝。
6. **配色不动。** 界面保持现有中性色；彩色只来自 Agent 角色和主题色点，它们是数据色，不要拿来当按钮或状态色。
7. 布局可以照抄这里的 `mock.css`，但其中的数字要换成 token；手机宽度下侧栏变抽屉、来源抽屉变底部面板、研究工作台只留文稿。

## 有意没做的

- Mock 没有接任何接口，交互只到"看起来能用"为止；真实数据流以 `src/api/generated/` 为准。
- 图谱的缩放、拖拽、搜索在真实实现里由 cytoscape 提供，这里只做了样子。
- 文稿编辑器在真实页面继续用 Tiptap，这里是 `contentEditable` 占位。
