# Everplain Web

React、TypeScript 与 Vite。首页介绍个人知识与研究产品；登录后使用 `/library` 私有资料库、`/agent` 研究对话、研究文稿和账号设置。

```bash
npm ci --ignore-scripts
npm run dev
```

开发入口 `http://localhost:5196`，Vite 将 `/api` 代理到 `http://127.0.0.1:8297`。页面通过模块公共接口和生成的 OpenAPI SDK 调用后端。API 变化时在仓库根目录执行 `make contract`，不直接修改 `src/api/generated/`。

```bash
npm run build
```

生产 Nginx 配置由 `ops/nginx.conf` 提供，支持 SPA 子路径刷新、同源 API 代理及 Agent 流式响应。模型和邮件密钥只能保存在服务端，不能放入 `VITE_` 变量或构建产物。详细运行步骤见 [部署手册](../docs/DISTRIBUTION.md)。
