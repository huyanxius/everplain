# Everplain 收藏助手

构建：`npm ci --ignore-scripts && npm test && npm run build`。输出 `dist/` 和应用的 `public/downloads/everplain-clipper.zip`。

本地打包需要 Python 3 创建 ZIP。Web Docker 构建会安装此构建阶段依赖，先生成扩展 ZIP，再构建前端；全新检出无需预先生成或提交 ZIP。

在 Chrome 扩展管理页开启开发者模式，加载解压后的目录。填入你自己的 Everplain HTTPS 地址，并先在浏览器中登录；本机开发支持 localhost。点击收藏才读取当前页，点击导入书签才申请书签权限；目标站点权限仅申请你填写的来源。扩展不保存密码、Cookie 或访问令牌，也不读取其他标签页内容。通过目标应用页面的同源会话提交，跨站 Cookie 限制不会要求用户导出凭据。

尚未发布到 Chrome 应用商店，未替用户安装或授予权限。正文提取使用 Defuddle 0.19.0（MIT）；许可随构建保留。实现参考 [Defuddle](https://github.com/kepano/defuddle) 和 [Chrome scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting)。
