# 真实后台、缺密钥模型临时降级

生产使用 `EVERPLAIN_RUNTIME_MODE=base` 与 `EVERPLAIN_ALLOW_MODEL_FALLBACK=true`。
旧 `EVERPLAIN_DEMO_MODE` 已删除，不能再用 `runtime_mode=mock` 启动生产。

- 账号、真实 Resend 验证码、登录会话、权限、知识库、文件、导入、研究任务、文稿和对话继续走真实业务与独立 SQLite。没有内存样例仓储，也不创建管理员。
- 只对没有 key 的模型配置允许降级。有 key 的模型保留真实路由；配置不完整仍需修正。Agent 使用原 PydanticAI 的真实运行、工具注册、会话与持久化路径，只有模型适配器返回显著标注的缺配置响应。不会假装完成研究或发起虚构工具操作。
- 缺 embedding/reranker 时使用现有真实本地文本检索；图谱保留用户真实文档并标为待归类，不造向量/主题。缺模型的知识整理任务明确报告未配置，而非生产假成果。缺语音/图片模型不伪造转写或识别。
- Web search 不是模型模拟服务。保留已配的真实搜索配置；未配时明确不可用，不返回假结果。邮件配置也不被清除；配置缺失时真实注册验证码发送失败，不跳过验证。
- `/api/health.runtime_mode` 是既有 MODEL 能力字段，缺模型时仍为 `mock`，`model_status=degraded`；实际 Settings 后台运行模式是 `base`。健康 200 表示应用和数据库可用，不代表模型、邮件或搜索已经验收。

最小非秘密配置：

```
EVERPLAIN_RUNTIME_MODE=base
EVERPLAIN_ALLOW_MODEL_FALLBACK=true
EVERPLAIN_DATABASE_URL=sqlite:////data/everplain.db
EVERPLAIN_RETRIEVAL_INDEX_PATH=/data/everplain-retrieval.db
EVERPLAIN_SESSION_COOKIE_NAME=everplain_session
EVERPLAIN_SESSION_COOKIE_SECURE=true
EVERPLAIN_CORS_ALLOWED_ORIGINS=["https://e.qunxue.xyz"]
EVERPLAIN_EMAIL_FROM=noreply@windup.xin
```

Resend key 只由授权部署者在服务器既有私密配置中引用用户已批准的发送配置，禁止打印、打包或经聊天转移。只用于验证码。Gmail 收件身份不是认证凭据。此代码不导入其它产品的用户、Cookie 或数据库。
管理员配置可以全部缺省；输入管理员邮箱不获得管理员权限。普通用户完成真实邮件验证即可注册。

## 现有 Docker 最短启动交接（由部署者核对现态后执行）

本次云端没有 Docker daemon，未构建/运行后端镜像。使用交接中的精确 Git commit 在服务器源码目录构建，不能构建浮动 main：

```
REV=$(git rev-parse HEAD)
test "$REV" = '<交接的完整 commit SHA>'
docker build -f ops/api.Dockerfile -t everplain-api:$REV .
```

现有 Dockerfile 固定 uv 版本，以 `uv sync --locked --no-dev --no-editable` 安装仓库锁定依赖。
沿用已有服务器账户、Docker 与 `everplain-web` 静态目录，不使用半成品 CD 或新建宿主服务账户。
`ops/api.Dockerfile` 既有容器内用户是 10001:10001；这是容器用户，不是宿主账户。
现有空的 Everplain 数据卷可挂 `/data`，Docker 初始化卷时沿用镜像目录属主；如数据卷已存在，先核验内容及容器可写性，不能 chown 其它目录或复制其它产品数据。数据库已存在则先用 `ops/database.py backup` 做一致性备份，不覆盖备份/原库。

核实 API 8297 未被占用、无同名 API 后，使用已批准的私密 ENV_FILE 与独立 Everplain 数据卷：

```
docker run -d --name everplain-api --restart unless-stopped \
  --security-opt no-new-privileges:true \
  --env-file "$ENV_FILE" -e EVERPLAIN_RELEASE_REVISION="$REV" \
  -p 127.0.0.1:8297:8297 -v everplain-data:/data \
  everplain-api:$REV
```

入口点已执行生产预检、Alembic upgrade 与单 worker API 启动。首次空库可迁移；已有数据时必须先备份并核升级/代码回退兼容性，不能盲目降级数据库。

现役 Web 是 127.0.0.1:5196 上的 Docker。仅将其现有 `/api/` 的明确 503 段改为反代新 API，保留其它段、静态目录、旧 hashed assets 和 downloads。先 inspect 确认 Web/API 的既有 Docker 网络可互达，再采用新 API 在该网络的实际地址与 8297，不能杜撰固定 IP 或在 Web 容器里把 127.0.0.1 当宿主。不新建网络、不修改隧道/DNS。复用 ops/nginx.conf 的代理 headers/流式参数；保留配置原 UID/GID/mode，验证候选 `nginx -t`。单文件 bind mount 的原子替换不能假定容器已读到新 inode，部署者须核实际挂载再采取最小 reload/recreate。

验收：本机 API、经5196反代及公网 `/api/health` 的 exact revision 必须相同，静态 index/JS 可读；真实注册、验证码送达和登录另行实际验收。不要通过循环模型调用检查健康。失败保留旧容器/配置并回退代码；不覆盖新库或其它产品资产。新建数据卷/实际启动与配置由已授权部署者执行，本源码包未执行生产操作。
