# Everplain 收藏助手

当前为未上架商店的 Manifest V3 扩展。下载按钮先询问 macOS / Windows；系统识别仅作提示，不会自动下载。自动准备工具下载并校验扩展，打开固定目录和浏览器管理页。用户仍需打开开发者模式并“加载已解压的扩展程序”，脚本不会静默安装。

## 用户流程

1. 在导入页选择系统，下载并完整解压准备工具 ZIP。
2. macOS 双击 `.command`；Windows 双击 `.cmd`，保留同目录的 `.ps1`。选择 Chrome 或 Edge。
3. 在扩展管理页启用开发者模式并加载工具打开的文件夹；同一浏览器用户资料中登录 `https://e.qunxue.xyz`。

官网已预填；已有保存地址保持不变，自建站仍可填写自己的 HTTPS 地址。本机开发支持 localhost。首次点击收藏才申请目标站点权限并读取当前页，只有点击导入全部书签才申请书签权限。通过目标应用页面同源会话提交；无密码、Cookie、令牌或配对码流程。

Windows 默认执行策略、下载标记或组织管理可能阻止脚本；macOS Gatekeeper/文件权限也可能阻止。此时直接回退普通扩展 ZIP，不更改执行策略、不移除隔离标记、不绕过系统/浏览器限制。Windows 使用正常 `PowerShell -NoProfile -File`；无需管理员权限、额外运行时或注册表修改。Mac 仅用系统 Bash、curl、unzip、shasum 等工具。

## 安全与更新

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

- `npm test`：来源/书签与默认地址回归。
- `python3 test/setup.test.py`：Bash 准备逻辑及恶意 ZIP，使用临时目录，不实际安装。
- `powershell -NoProfile -File test/setup-windows.test.ps1`：Windows原生环境可运行。Linux的 `pwsh -NoProfile -File` 仅验证 PowerShell/.NET 核心逻辑，不能声称 Windows 5.1、Explorer、Edge/Chrome 或执行策略已端到端验证。
- 原生 macOS Finder、Gatekeeper、Bash3 与实际浏览器加载也需目标系统验收；Linux Bash 测试不能替代它。

[Chrome 官方加载步骤](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked)、[Chrome 分发限制](https://developer.chrome.com/docs/extensions/how-to/distribute)、[Edge 官方侧载步骤](https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading)。

正文提取使用 Defuddle 0.19.0（MIT）；许可随构建保留。未替任何用户安装或授权扩展。
