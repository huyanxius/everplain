# Everplain 收藏助手

当前为未上架商店的 Manifest V3 扩展。主流程只下载普通 ZIP，不要求脚本。

## 用户流程

1. 下载 `everplain-clipper.zip`。macOS 双击解压；Windows 右键“全部解压缩”。保留解压目录，不从 ZIP 预览加载。
2. 地址栏打开 `chrome://extensions` 或 `edge://extensions`，启用“开发者模式”，点击“加载已解压的扩展程序 / 载入未封装的项目”。
3. 选择直接含 `manifest.json` 的文件夹，不选择 ZIP 或上一级。macOS 在 Finder 选中目录按 Option+Command+C 复制路径，在选择器按 Command+Shift+G 粘贴；Windows 在目录地址栏 Ctrl+L、Ctrl+C，在选择器 Ctrl+L 粘贴。
4. 同一浏览器用户资料登录 `https://e.qunxue.xyz`，保留标签页，固定扩展后收藏。

历史准备脚本只作为兼容文件保留，下载界面不再推荐，也不需要用户运行。

官网已预填；已有保存地址保持不变，自建站仍可填写自己的 HTTPS 地址。本机开发支持 localhost。首次点击收藏才申请目标站点权限并读取当前页，只有点击“选择书签或文件夹”才申请书签权限并读取书签。通过目标应用页面同源会话提交；无密码、Cookie、令牌或配对码流程。

## 无需先导出的书签导入

1. 点击“选择书签或文件夹”，允许浏览器的可选书签权限。初始不勾选任何内容，不会自动提交。
2. 勾选单条书签，或勾选一个文件夹中的全部可导入书签（包括子文件夹）。可按标题或网址搜索；搜索隐藏的已选内容保持选中。“全选可导入书签”会选中整个列表。
3. 点击“导入所选书签”。仅所选 HTTP(S) 书签及其目录结构会发送到你填写的 Everplain 站点，不需要先导出 HTML。浏览器内部链接、无效网址及网址中带账号/密码的链接不会提交。
4. 弹窗显示服务器返回的批次编号、后台处理数量、新增/更新/重复/失败数量。点击“查看本批导入进度”打开 `/imports?batch=编号`。提交成功不代表正文已读取完；失败条目在 Everplain 中单独重试。

收起或 Escape 不会提交，也不会清空本次弹窗的选择。未登录时打开同一浏览器的 Everplain 完成登录，再返回提交；权限拒绝不会读取书签或提交资料。

同一弹窗会阻止并发提交；请求键、SHA-256 摘要与接收确认状态只暂存在浏览器内存 `storage.session`，不保存书签正文或登录凭据。已打开的 Everplain 文档内保留按当前账号隔离的请求回执，同一次请求的并发操作共用提交结果。网络中断或不完整响应会提示“提交结果尚未确认”，再次提交仍复用本次请求键；服务端按账号隔离的幂等记录避免创建第二个批次。确认接收成功后，下次主动点击会使用新的请求键，允许检查所选网页正文是否变化；相同资料仍由服务端去重。目标站点刷新/导航或浏览器重启后内存回执不再存在，服务端记录仍以自己的状态为准。

API 使用依据：[Chrome 书签树](https://developer.chrome.com/docs/extensions/reference/api/bookmarks)、[点击时申请可选权限](https://developer.chrome.com/docs/extensions/reference/api/permissions)、[仅内存的会话存储](https://developer.chrome.com/docs/extensions/reference/api/storage)、[隔离世界脚本注入](https://developer.chrome.com/docs/extensions/reference/api/scripting)。不增加自动内容脚本、后台读取、Cookie 权限或长期认证信息。

Windows 默认执行策略、下载标记或组织管理可能阻止脚本；macOS Gatekeeper/文件权限也可能阻止。macOS 脚本未签名/公证；用户核对官方下载来源后，可在“系统设置 → 隐私与安全”中针对该脚本手动选择“仍要打开/强制打开”（[Apple 官方说明](https://support.apple.com/102445)）。这不是安全保证。不愿运行或被组织策略限制时回退普通扩展 ZIP，不更改执行策略、不移除隔离标记、不绕过管理限制。Windows 使用正常 `PowerShell -NoProfile -File`；无需管理员权限、额外运行时或注册表修改。Mac 仅用系统 Bash、curl、unzip、shasum 等工具。

## 历史脚本的安全与更新（兼容说明）

- 下载仅来自固定 HTTPS 官方源；TLS 校验保留，拒绝重定向，下载体积/时间受限。
- 同源 SHA-256 清单由每次构建自动生成，验证 ZIP 和每个文件；它防损坏/错版，**不是独立代码签名或第三方信任保证**。
- 扩展包仅允许六个准确的根级文件名，拒绝路径穿越、绝对路径、重复、未知文件、符号链接；不按 ZIP 路径进行常规解压。
- 逐文件输出受大小限制，写入新临时目录，验证后进入用户自己的版本目录。任何已存在的不同文件都保留，绝不覆盖。
- macOS：`~/Library/Application Support/Everplain/Clipper/release-<sha256>`。
- Windows：`%LOCALAPPDATA%\Everplain\Clipper\release-<sha256>`。
- 相同包校验后复用，新包建立新目录。更新需要移除旧扩展再加载新目录，留意浏览器移除操作会清除扩展本地设置。脚本不会自行更新、删除旧目录或改变浏览器用户资料。

## 构建与部署

`npm ci --ignore-scripts && npm test && npm run build`

构建阶段需要 Python 3 写 ZIP；用户机器不需要 Python。输出 `dist/` 和前端 `public/downloads/` 下的：

- `everplain-clipper.zip`：六文件扩展包
- `everplain-clipper.sha256`：自动生成的准确 ZIP/文件校验值
- `everplain-clipper-macos.zip`：保留可执行位的 `.command` 与说明
- `everplain-clipper-windows.zip`：`.cmd`、可审阅 `.ps1` 与说明
- 三个直接可下载、可审阅的脚本源文件

先构建扩展，再构建前端；同批发布全部下载文件，不能只发布新按钮或新校验清单。跨部署短暂不一致时工具校验失败并停止，稍后重试即可。不要用仅含前端的旧 dist 覆盖 downloads。

## 验证

- `npm test`：来源、所选书签/目录、默认地址、批次进度、弹窗 DOM 交互、登录中断、权限拒绝、重复点击与未知提交结果回归。DOM/API fixture 不等于真实 Chrome 权限弹窗、侧载或线上导入验收。
- `python3 test/setup.test.py`：Bash 准备逻辑及恶意 ZIP，使用临时目录，不实际安装。
- `powershell -NoProfile -File test/setup-windows.test.ps1`：Windows原生环境可运行。Linux的 `pwsh -NoProfile -File` 仅验证 PowerShell/.NET 核心逻辑，不能声称 Windows 5.1、Explorer、Edge/Chrome 或执行策略已端到端验证。
- 原生 macOS Finder、Gatekeeper、Bash3 与实际浏览器加载也需目标系统验收；Linux Bash 测试不能替代它。

[Chrome 官方加载步骤](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked)、[Chrome 分发限制](https://developer.chrome.com/docs/extensions/how-to/distribute)、[Edge 官方侧载步骤](https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading)。

正文提取使用 Defuddle 0.19.0（MIT）；许可随构建保留。未替任何用户安装或授权扩展。


## 共享界面令牌与商店准备

`build.mjs` 将 Web 的 `frontend/src/styles/tokens.css` 原样内嵌到扩展 `popup.css`，不请求远程样式，按钮、字体、间距和浅深色使用同一语义令牌。修改 Web 令牌后重新构建扩展即可同步。

运行 `node build-store.mjs` 会基于已构建的 `dist/` 生成独立商店 ZIP，并包含 16/48/128 品牌图标。普通侧载 ZIP 仍保持六个文件，与历史校验脚本兼容。商店包准备不代表提交或上架；真实功能截图、公开准确的隐私政策和开发者账户审核仍需完成。
