<div align="center">
  <img src="frontend/src/assets/qunxue-brand-mark.svg" alt="Everplain" width="72" />
  <h1>Everplain</h1>
  <p><strong>整理自己的知识，研究真正关心的问题。</strong></p>
</div>

Everplain 是面向个人用户的知识库与研究工具。保存资料，围绕自己的问题检索和讨论，把能够核对的来源整理成可编辑、可导出的研究文稿。它沿用已有产品基座与品牌图形，在独立仓库、账号、数据与运行配置中维护。

## 可以做什么

- **个人知识库**：建立私有资料库，上传和阅读文档，查看处理状态、来源、知识条目及其关系，管理容量与资料。
- **研究 Agent**：结合选定资料库和网络检索开展多轮研究，保留对话、工具运行和引用，继续已有研究。
- **研究文稿**：从资料与对话形成文稿，审阅修订建议，编辑内容、查看版本并导出；引用提供回到资料的核对入口。
- **账号管理**：登录、邮箱验证码注册、个人设置、记忆管理、账号数据导出与删除；管理员管理用户状态、用量和配额。

资料库及研究资源按账号授权。模型输出仍需要用户核对；外部模型与检索服务会接收完成请求所需的内容。详见 [隐私与安全边界](docs/SECURITY.md)。

## 本地开发

需要 Python 3.12、uv、Node.js 22.18+、npm 和 GNU Make。

```bash
git clone https://github.com/huyanxius/everplain.git
cd everplain
make bootstrap
```

分别在两个终端运行：

```bash
make dev-api
```

```bash
make dev-web
```

Web：`http://localhost:5196`；API：`http://127.0.0.1:8297`。未配置服务凭据时仅能验证本地界面及确定性流程，不能据此验收真实研究。配置方法见 [开发指南](docs/onboarding.md)。

## 独立部署

仓库提供 FastAPI 与 Nginx 静态前端镜像、独立 Compose 项目、生产配置预检和 SQLite 一致备份/恢复脚本。按 [部署与恢复手册](docs/DISTRIBUTION.md) 配置后打包，应用依赖使用已提交的锁文件安装。

真实研究需要：聊天模型的兼容接口、Embedding 与 Reranker 服务，以及网络检索凭据。注册邮件和语音转写是独立可选服务；未配邮件时使用初始管理员进行受控访问，不能宣称公开注册可用。配置清单在 [backend/.env.example](backend/.env.example)，密钥只放未跟踪的私有环境文件。

当前交付为单实例、单 API worker 的产品实现与部署资产。没有接入支付或订阅扣款，也没有宣称已完成高可用、容量压测、第三方安全认证。Everplain 的正式域名、DNS、TLS 和邮件发信域名验证需在目标环境完成；仓库不绑定其他产品域名，也不自动部署或迁移其他产品数据。

## 开发与验证

API 契约修改后运行 `make contract`，生成客户端不能手工编辑。按改动范围执行相关测试、类型检查或构建；`make check` 用于确实涉及公共边界的广泛验证，不是每次改字的默认步骤。

```bash
backend/.venv/bin/python -m unittest discover -s ops/tests -v
```

以上只验证部署脚本的配置校验与数据库恢复行为，不替代镜像运行、真实模型、浏览器或公网验收。`make check-backend` 以 `backend/tests/product-suite.txt` 中的当前产品用例为准；保留的旧学科测试与小型历史 fixture 用于兼容参考，不属于 Everplain 的公开产品契约，也不代表这些旧测试已全部通过。

- [产品范围](docs/product/README.md)
- [开发指南](docs/onboarding.md)
- [部署、备份与恢复](docs/DISTRIBUTION.md)
- [安全与隐私](docs/SECURITY.md)
- [协作规则](CONTRIBUTING.md)

所有代码经 `Issue → 分支 → 原子提交 → PR → main` 交付。密钥、数据库、依赖目录、截图与构建产物不得提交。
