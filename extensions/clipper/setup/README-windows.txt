Everplain Clipper / 收藏助手 · Windows 自动准备

1. 右键 ZIP 选择“全部解压缩”。保持 .cmd 与 .ps1 在同一个文件夹，双击 everplain-clipper-windows.cmd。
   按终端提示选择 1 Chrome 或 2 Edge；脚本会打开浏览器和扩展文件夹。
2. 在扩展管理页打开“开发者模式”，点击“加载已解压的扩展程序”，选择脚本打开的文件夹。
3. 在同一浏览器用户资料中登录 https://e.qunxue.xyz 。收藏助手已预填该地址。

首次收藏申请访问目标 Everplain 站点；只有选择导入全部书签才申请书签权限。
无需密码、Cookie、配对码、管理员权限或额外运行时；使用 Windows 自带 PowerShell 5.1。

Windows 可能默认禁止 PowerShell 脚本；下载标记、组织策略或安全软件也可能拦截运行。
遇到这类提示请停止使用脚本，不要更改 ExecutionPolicy、取消下载保护或绕过警告。
回到 https://e.qunxue.xyz/imports 选择“手动下载 ZIP”，解压后在浏览器加载即可。
本助手使用正常 -File 执行，不会修改系统执行策略或注册表。终端提示为英文。

固定目录：%LOCALAPPDATA%\Everplain\Clipper\release-<校验值>
不要移动或删除已加载目录。同版校验后复用，新版会创建新目录并保留旧版。
更新需要在浏览器移除旧版、再加载新目录；移除前留意浏览器提示会清除扩展本地设置。
不会静默安装，不会自动更新或删除旧版，也不会预先授权所有网站。

校验清单与 ZIP 来自同一 HTTPS 官方站点，用于检测损坏/错版，不是独立代码签名。
