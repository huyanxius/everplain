# 显式模型演示模式

设置 `EVERPLAIN_DEMO_MODE=true` 和 `EVERPLAIN_RUNTIME_MODE=mock`，复用既有确定性
模型/资料处理实现。预检不再要求模型、embedding、reranker、联网研究或转写 key。
显式演示模式清空这些运行时 provider 路由，关闭模型健康探测和自动记忆学习；残留模型
key 不会把 mock 偷偷升成真实调用。上传限制最多 5 MiB/文件、50 MiB/用户、3 个库、20
份资料/库。真实用户数据仍在 Everplain 独立数据库中。

仍需安全 Cookie、独立 `everplain_session`、文件型 SQLite 以及真实 HTTPS CORS 入口。
管理员配置可以全部缺省，此时不创建管理员，也不要求生成新的管理员密码。已配置
管理员时仍校验原来的邮箱与密码要求；输入某个 Gmail 地址不赋予任何权限。

注册、登录、邮箱验证码均保留真实实现和鉴权，不 mock、不免验证码。已有 Resend
发送代码直接复用；真实邮件需要通过安全方式配置 Everplain 获授权的
`EVERPLAIN_RESEND_API_KEY` 和已验证发信域名 `EVERPLAIN_EMAIL_FROM`。Gmail 收件身份
不是 SMTP/OAuth 凭据。不能复制另一个产品的 key、认证 secret、会话或用户数据库。

预检会区分 `configuration_ready_mock`、`registration_email=not_configured` 和
`administrator=not_provisioned`。API 能启动不等于邮件已经接通；缺发信配置时验证码
接口明确失败，注册不会绕过验证。邮件可用后普通用户可真实注册，无需先创建管理员。
没有可信登录时，公开首页提供显著标注的静态示例；它不是受鉴权工作区的匿名访问。

安全最小配置（不含任何秘密）：

```
EVERPLAIN_DEMO_MODE=true
EVERPLAIN_RUNTIME_MODE=mock
EVERPLAIN_DATABASE_URL=sqlite:////data/everplain.db
EVERPLAIN_RETRIEVAL_INDEX_PATH=/data/everplain-retrieval.db
EVERPLAIN_SESSION_COOKIE_NAME=everplain_session
EVERPLAIN_SESSION_COOKIE_SECURE=true
EVERPLAIN_CORS_ALLOWED_ORIGINS=["https://e.qunxue.xyz"]
```

使用现有 `ops/start-api.sh` 执行预检、迁移和单 worker 启动。数据库、Cookie、端口及
容器仍必须是 Everplain 自己的。没有发送真实验证邮件或跑真实模型，不得宣称其验收成功。
