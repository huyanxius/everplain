# Everplain 本地开发

需要 Git、GNU Make、Python 3.12、uv、Node.js 22.18+ 和 npm。提交与 PR 使用 GitHub CLI。

```bash
git clone https://github.com/huyanxius/everplain.git
cd everplain
make bootstrap
```

两个终端分别运行 `make dev-api` 和 `make dev-web`。Web 在 `http://localhost:5196`，API 在 `http://127.0.0.1:8297`，默认数据在 `backend/var/everplain.db`。

## 配置真实研究

复制 `backend/.env.example` 为 `backend/.env` 并填写私有凭据。示例以生产约束为默认；本地 HTTP 开发需将 `EVERPLAIN_SESSION_COOKIE_SECURE=false`、`EVERPLAIN_CORS_ALLOWED_ORIGINS=["http://localhost:5196"]`。不要把这一开发设置用于公网。

- `EVERPLAIN_MODEL_BASE_URL`、`MODEL_NAME`、`MODEL_API_KEY`：支持 Agent 工具调用的 OpenAI-compatible 聊天模型，显式设置 `EVERPLAIN_RUNTIME_MODE=base`。
- `EVERPLAIN_EMBEDDING_BASE_URL`、`EMBEDDING_MODEL`、`EMBEDDING_API_KEY`：检索向量模型，当前模型为 `Pro/BAAI/bge-m3`。
- `EVERPLAIN_RERANKER_BASE_URL`、`RERANKER_MODEL`、`RERANKER_API_KEY`：重排模型，当前为 `Pro/BAAI/bge-reranker-v2-m3`。
- `EVERPLAIN_WEB_SEARCH_API_KEY`：默认 Tavily 网络检索，`EVERPLAIN_WEB_SEARCH_PROFILE=generic`。
- `EVERPLAIN_ACCOUNT_INITIAL_ADMIN_EMAIL`、`EVERPLAIN_ACCOUNT_INITIAL_ADMIN_PASSWORD`：初始化管理员，使用独立凭据。
- 可选 `EVERPLAIN_RESEND_API_KEY` 与 `EVERPLAIN_EMAIL_FROM`：注册邮件。缺少邮件配置时验证码接口明确不可用，使用初始管理员受控访问。
- 可选 `EVERPLAIN_TRANSCRIPTION_BASE_URL`、`TRANSCRIPTION_MODEL`、`TRANSCRIPTION_API_KEY`：语音转写，三个字段一起配置。

上表省略前缀的同组字段也均以 `EVERPLAIN_` 开头。环境文件不提交、不打印；不要从原产品复制环境或数据库。不配置模型时只能验证确定性本地流程，不能当作真实研究。

## 有意义的本地验收

在配置真实服务的隔离账号上验证：登录与刷新恢复；建立个人库并上传一份自己的测试文档；等处理成功后通过 Agent 提问并核对引用；生成、编辑和导出文稿；退出登录后私有资料不可读取。涉及账号删除时用专用测试账号。

`GET /api/health` 可检查 API 是否运行，不能替代上述路径。根据所改模块运行对应测试；API 变化运行 `make contract`，前端变化按需类型检查与构建。不要把构建或 Mock 测试描述成真实模型验收。

生产容器、完整环境检查与备份命令见 [部署与恢复手册](DISTRIBUTION.md)。协作纪律见 [CONTRIBUTING.md](../CONTRIBUTING.md)。
