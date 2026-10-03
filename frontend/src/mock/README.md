# Everplain 界面 Mock

这是重做整个应用 UI 的参照稿：纯前端、假数据、不接后端。照着它改真实页面，改完这个目录整个删掉。

打开方式：`npm run dev`，然后访问 `http://localhost:5196/mock.html`。右下角「全部页面」可以跳到任意一页。组件样张在 `/design-system.html`。

## 信息结构

整站只围绕三样东西：**资料（知识库）、研究、Agent**。其余功能挂在它们身上，不再单独占导航。

```
侧栏    新对话（= 首页）
        知识库 · 研究 · 发现
        最近（对话和研究按时间混排）
        底部：Agent 角色 → 我的 Agent；账户 → 额度 / 通知 / 设置 / 退出
```

现在要取消的东西：侧栏「更多功能」折叠（7 项）、首页底部的功能按钮墙、账户菜单里的「Soul · 人格」「Memory · 记忆」、独立的 `/imports` `/sharing` `/connections` `/subscription` `/my/graph` `/library/knowledge` `/research/new` `/research/existing` 页面。旧路径都保留为重定向，指向新的位置。

## 哪一页对应哪一页

| Mock | 真实路由 | 说明 |
| --- | --- | --- |
| `#/login` | `/login`、`/register` | 单列居中，邮箱和密码分两屏 |
| `#/setup/1`–`4` | `/welcome/setup` | 导入 → 取名与外观 → 问卷 → 生成图谱，每一步都能跳过 |
| `#/` | `/app`，`/agent` 无参数时重定向到这里 | 首页就是新对话：问候、输入框（带"在哪些资料里找"）、接着研究、最近收进来的 |
| `#/c/c1` | `/agent?conversation=…` | 只负责已开始的对话。顶部是范围选择，以及"转成研究"或回到所属研究 |
| `#/library` | `/library` | 左栏选库（我的 / 共享给我的），右边三个视图 |
| `#/library?view=points` | `/library/knowledge` → 重定向 | 知识点视图，按主题分组，可直接改 |
| `#/library?view=graph` | `/my/graph` → 重定向 | 图谱视图，`ObsidianKnowledgeGraph` 换 concentric 布局 |
| `#/library?add`、`?add=records` | `/imports` → 重定向 | 添加弹窗：链接、文件、5 个导入来源、B 站 UID、插件；第二页是导入记录 |
| `#/library?lib=thesis&share` | `/sharing` 的管理部分 | 共享以库为单位：邀请链接、成员、公开到发现 |
| `#/library?lib=j1` | `/shared/:libraryId` | 共享给我的只读库，没有添加和共享按钮 |
| `#/library/m1` | 资料详情（新） | 左读原文，右知识点、关联、用在了哪个研究；返回到所在库 |
| `#/research` | `/research/materials`（改名 `/research`） | 研究卡片，四段进度 |
| `#/research?new`、`?new=chat` | `/research/new`、`/research/existing` → 重定向 | 一个弹窗三种起点：问题、已有稿子、一段对话；选用哪些库 |
| `#/research/r1` | `/research/:id/workspace` | 文稿 / 地图切换；右栏资料、Agent、版本；挂在研究下的对话列在资料下面 |
| `#/discover` | `/discover` | 公共主题 + 粘贴邀请链接加入 |
| `#/discover/p1` | `/discover/:id`、`/shared/:id` | 只读阅读，"加入我的知识库" |
| `?agent` | 账户菜单里的身份面板 | 我的 Agent：人格、记忆、模型与引用格式 |
| `?settings` | `/settings` 弹窗；`/subscription` `/connections` 重定向到对应分类 | 账号、外观、套餐与额度、共享总览、外部连接（MCP 只读钥匙）、数据 |
| `?inbox` | 现在侧栏的通知铃铛 | 通知收进账户菜单，红点挂在头像上 |
| 账户菜单里的"管理后台" | `/admin/*` | 仅管理员可见 |

## 改真实页面时的规矩

1. **样式只用全局层。** 按钮、输入、卡片、列表行、标签、菜单、气泡、提示一律用 `src/styles/components.css` 里的 `qx-*` 类；页面 CSS 只管布局。颜色、字号、圆角、阴影只能写 `var(--qx-*)`，不写 `#212121`、`13px`、`border-radius: 9px` 这类字面值。缺什么先加 token，再用。
2. **圆角按物件选**：标签 tag，侧栏/菜单行 item，卡片 card，多行输入 field，面板 panel，弹窗 modal，按钮和单行输入 pill。
3. **衬线给内容，无衬线给界面。** 页面题目、卡片标题、Agent 回答、原文、文稿用 `--qx-font-reading`；导航、按钮、字段用 `--qx-font-ui`。
4. **删掉没有信息量的小字。** 11px 加宽字距的眉标、"AI 将为你……"、"当前研究"这类领读词、重复标题的副标题，直接删。最小字号是 meta（13px）。
5. **Agent 角色贯穿全站**：侧栏底部、首页问候、对话头像、引导、图谱中心都是用户选的那个角色，状态跟着场景换（问候 greet、等待回复 think、导入/生成 work）。角色组件就是 `src/modules/agent-avatar`。
6. **配色不动。** 界面保持现有中性色；彩色只来自 Agent 角色和主题色点，它们是数据色，不要拿来当按钮或状态色。
7. 布局可以照抄这里的 `mock.css`，但其中的数字要换成 token；手机宽度下侧栏变抽屉、来源抽屉变底部面板、研究工作台只留文稿。

## 有意没做的

- Mock 没有接任何接口，交互只到"看起来能用"为止；真实数据流以 `src/api/generated/` 为准。
- 图谱的缩放、拖拽、搜索在真实实现里由 cytoscape 提供，这里只做了样子。
- 文稿编辑器在真实页面继续用 Tiptap，这里是 `contentEditable` 占位。
