# Everplain 独立部署与恢复

仓库提供 FastAPI API、Nginx 静态前端、Compose 和数据库工具。部署目标是单实例、单 API worker。下面的命令由维护者在专用 Everplain 主机或目录执行；不会自动连接或操作其他产品。

## 1. 准备配置与镜像

需要 Docker Engine、Compose v2、可用磁盘及到模型/检索服务的出站 HTTPS。代码与依赖以同一个提交为单位发布。正式入口需由部署者提供 HTTPS 反向代理。

```bash
git clone https://github.com/huyanxius/everplain.git
cd everplain
cp backend/.env.example backend/.env
chmod 600 backend/.env
```

在私有编辑器中填写 `backend/.env`，不要在终端打印密钥。已有文件时不要重复覆盖。默认容器读取此文件；可用 `EVERPLAIN_ENV_FILE` 指定另一份专用于 Everplain 的环境文件。

| 服务 | 必需配置 | 说明 |
| --- | --- | --- |
| 聊天模型 | `EVERPLAIN_RUNTIME_MODE=base`、`MODEL_BASE_URL`、`MODEL_NAME`、`MODEL_API_KEY` | HTTPS 的 OpenAI-compatible 工具调用模型；三个模型字段均以 `EVERPLAIN_` 开头 |
| Embedding | `EVERPLAIN_EMBEDDING_BASE_URL`、`EMBEDDING_API_KEY`、`EMBEDDING_MODEL` | 模型固定为 `Pro/BAAI/bge-m3`，同组字段均以 `EVERPLAIN_` 开头 |
| Reranker | `EVERPLAIN_RERANKER_BASE_URL`、`RERANKER_API_KEY`、`RERANKER_MODEL` | 模型固定为 `Pro/BAAI/bge-reranker-v2-m3`，同组字段均以 `EVERPLAIN_` 开头 |
| 网络研究 | `EVERPLAIN_WEB_SEARCH_API_KEY` | 默认 Tavily；`EVERPLAIN_WEB_SEARCH_PROFILE=generic`。自定义 provider 还需 HTTPS `EVERPLAIN_WEB_SEARCH_BASE_URL` |
| 管理员 | `EVERPLAIN_ACCOUNT_INITIAL_ADMIN_EMAIL`、`EVERPLAIN_ACCOUNT_INITIAL_ADMIN_PASSWORD` | 独立邮箱和至少 12 位密码；启动时用于初始化管理员 |
| 会话 | `EVERPLAIN_SESSION_COOKIE_SECURE=true`、`EVERPLAIN_CORS_ALLOWED_ORIGINS` | 填实际 HTTPS 入口的 JSON 数组；Cookie 名称固定 `everplain_session` |
| 注册邮件（可选） | `EVERPLAIN_RESEND_API_KEY`、`EVERPLAIN_EMAIL_FROM` | 发件人须属于已在 Resend 验证的域名；未配置时不支持公开验证码注册，可由初始管理员受控使用 |
| 语音（可选） | `EVERPLAIN_TRANSCRIPTION_BASE_URL`、`TRANSCRIPTION_MODEL`、`TRANSCRIPTION_API_KEY` | 同组字段均以 `EVERPLAIN_` 开头，三个一起配置 |

已有备用聊天路由时使用 `EVERPLAIN_MODEL_FALLBACKS`，各路由也需要真实 HTTPS 地址、模型和凭据。检索模型与聊天模型分别计费和授权，单有聊天密钥不等于知识库检索可用。所有 `.env.example` 都是模板，不包含可用凭据。

```bash
docker compose build
docker compose run --rm --no-deps --entrypoint python api /app/ops/preflight.py
```

预检明确拒绝 Mock、不完整模型/检索/网络配置、旧产品环境变量和不安全的生产会话设置。未配置邮件、语音会单独报告；若配置了一部分则拒绝启动。结果仅输出字段名和状态，不输出密钥。`configuration_ready` 表示配置齐全，`provider_connectivity: not_checked` 表示尚未检查服务连通性，不能当成真实模型验收。

在已安装本地后端依赖时也可以单独校验指定的生产配置：

```bash
PYTHONPATH=backend/src backend/.venv/bin/python ops/preflight.py --env-file /secure/everplain.env
```

镜像使用 `uv sync --frozen --no-dev --no-editable` 和 `npm ci --ignore-scripts` 安装锁定的应用依赖。默认基础镜像使用受维护的版本系列标签；正式发布时应记录并固定基础镜像 digest，以及输出镜像 digest，避免后续同名标签改变。Dockerfile 支持 `PYTHON_IMAGE`、`NODE_IMAGE`、`NGINX_IMAGE` 构建参数以传入核对过的 `image@sha256:...`。未提供 digest 时只保证应用依赖锁定，不声称逐字节可重现。

## 2. 运行与入口

```bash
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1:8297/api/health
curl --fail http://127.0.0.1:5196/healthz
```

API 启动顺序为配置预检、Alembic 迁移、单 worker Uvicorn。迁移或预检失败时 API 不对外提供服务。Web 等 API 健康后启动。

- Compose 项目名：`everplain`。
- Web 宿主端口：`127.0.0.1:5196`，容器内 `8080`。
- API 宿主端口：`127.0.0.1:8297`。
- 主数据库：`everplain-data` 卷的 `/data/everplain.db`。
- 派生检索缓存：同卷 `/data/everplain-retrieval.db`。
- 备份目录：独立 `everplain-backups` 卷的 `/backups`。

宿主机 HTTPS 代理转发到 `127.0.0.1:5196`，保留 Host 并设置 `X-Forwarded-Proto: https`。同源 `/api/` 已转发到 API；Nginx 支持 SPA 子路径与流式响应。外层代理也应关闭流式响应缓冲，设置至少 600 秒的读取超时，并允许所需上传大小。默认应用上传上限 20 MiB，内部 Nginx 请求上限 21 MiB；提高配额时同步调整代理限制。

不要直接把开发 reload 服务暴露公网。生产 secure cookie 在 HTTP 页面不能正常完成会话，这是要求先接 HTTPS 的原因。Everplain 尚无在本次交付中验证过的正式域名、DNS、TLS 或发信域名；不要使用原产品域名代替。

## 3. 发布验收

在目标环境使用专用测试账号，实际走完登录、刷新恢复、创建私有库、上传并完成解析、基于资料进行真实 Agent 研究、打开引用、编辑及导出文稿。再用另一账号确认私有资料不可读取。若启用公开注册，验证真实收信与验证码登录链路；若启用语音，验证实际音频转写。

健康检查只表示进程可响应，配置预检只表示字段齐全。两者都不能代替真实模型、引用、浏览器或邮件验收。公网开放前还需按实际用户规模配置监控、告警、磁盘容量和备份保留策略；当前没有自动支付扣款、跨实例协调或高可用保证。

## 4. 一致备份

主数据库包含账号、会话、研究、资料原始 BLOB、知识内容、文稿与版本。`ops/database.py` 使用 SQLite Online Backup API 获取一致快照，包括已提交到 WAL 的数据；不会用直接复制运行中 `.db` 文件的方式备份。

```bash
docker compose exec -T api python /app/ops/database.py backup /data/everplain.db /backups/everplain-20260912.sqlite3
docker compose exec -T api python /app/ops/database.py verify /backups/everplain-20260912.sqlite3
```

每次使用新的文件名。脚本检查数据库完整性、外键和基本应用表，并输出 schema revision、用户数及 SHA-256；不输出用户内容。目标文件权限为 `0600`，已存在的目标一律拒绝覆盖。

备份卷只是一份本机副本；还应定期复制到访问受限、加密的异地位置，记录对应代码和镜像版本。自动调度、加密、保留清理和恢复演练由部署者配置，当前脚本不擅自执行这些操作。环境密钥单独管理，不混入备份清单或公开文件。

## 5. 恢复与升级

恢复前保留旧镜像和旧卷。恢复脚本只写新目标；切换运行数据库前停止 API 写入，并确保没有另一实例使用同一卷。下面以新的 `everplain-restored` 卷为例：

```bash
docker compose stop api
docker run --rm --entrypoint python \
  -v everplain-backups:/backups:ro \
  -v everplain-restored:/data \
  everplain-api:local /app/ops/database.py restore \
  /backups/everplain-20260912.sqlite3 /data/everplain.db
```

新卷首次挂载会继承镜像中 `/data` 的权限。使用的镜像标签须替换为备份对应的已保留版本。备份中只有主数据库，派生缓存将在新数据卷中按需重建，不应从旧数据卷复制一个不匹配的缓存。

创建一份恢复覆盖文件，例如私有的 `/secure/everplain-restore.yaml`：

```yaml
volumes:
  data:
    name: everplain-restored
```

```bash
docker compose -f compose.yaml -f /secure/everplain-restore.yaml up -d
```

之后所有管理命令继续带上同一覆盖文件。启动时会按选定镜像执行迁移；升级失败时使用旧镜像和未经升级的旧卷恢复，不在已迁移数据库上试验降级。恢复后重复账号登录、私有库阅读、引用和文稿打开的验收，再决定是否清理旧卷。

禁止用 `docker compose down -v` 作为常规升级或故障处理。当前恢复工具验证数据库结构完整与副本可读，业务级恢复仍需上述实际账号验收。

## 6. GitHub Actions 自动发布

日常发布入口与一次性配置清单见 [ops/cd/README.md](../ops/cd/README.md)。PR 仅检查；main
同提交检查通过后构建不可变 Docker 产物，再串行部署。该流程使用独立版本目录和 SQLite
一致备份，失败按迁移兼容策略回滚，不修改 DNS/隧道。生产凭据、初始完整 API 基线和
受限部署访问尚需一次性安全接通；源码与离线测试通过不表示生产自动发布已启用。
