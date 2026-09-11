# Everplain API

FastAPI 模块化单体，提供账号、私有知识库、研究 Agent、资料引用和研究文稿 API。入口 `qunxue_api.main:app` 保留内部包名兼容，并提供 `everplain-api` 命令别名；运行环境仅识别 `EVERPLAIN_` 配置。

```bash
uv sync --frozen
uv run alembic upgrade head
uv run uvicorn qunxue_api.main:app --reload --host 127.0.0.1 --port 8297
```

默认数据库 `backend/var/everplain.db`，迁移与 API 使用相同配置。开发凭据放本目录未跟踪的 `.env`，字段见 [.env.example](.env.example)。业务模块不依赖 Web、ORM 或具体模型 SDK；外部调用由 adapters 承担，bootstrap 负责装配。

生产使用仓库根目录的 Compose 与预检，不使用 reload；单实例、单 worker。配置、TLS、备份及恢复见 [部署手册](../docs/DISTRIBUTION.md)。
