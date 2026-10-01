# Everplain Agent 工作规范

进入仓库先读本文件；存在 `HANDOFF.md`、`TASKS.md` 时一并阅读。人类协作流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 产品与隔离

Everplain 是面向个人的私有知识库与研究工具。所有首页、账号、知识库、研究和文稿流程使用 Everplain 定位；保留现有品牌图形及克制的视觉体系，不引入学科、课程、竞赛或师生前提。

- 独立仓库：`https://github.com/huyanxius/everplain`。
- 所有运行配置使用 `EVERPLAIN_`，不读取旧产品环境变量、账号或数据。
- 默认端口 Web 5196、API 8297；Compose 项目、数据卷及备份卷均使用 `everplain` 名称。
- 不连接、部署、重启或迁移其他产品；不从其他运行环境复制密钥、数据库和用户资料。
- `qunxue_api` 等内部包名暂时保留以兼容既有模块及迁移，它们不是运行环境的身份。

实现选择能完成当前目标的最简单方式，不扩大需求或加入当前交付不需要的抽象。

## Git 纪律

1. 先查看 `git status`，确认对应 Issue。在已有授权分支继续时不要重建工作区或覆盖他人更改。
2. 新任务从最新 main 创建 `<type>/<issue-number>-<short-name>` 分支。
3. 提交前确认没有 `.env`、密钥、数据库、依赖目录、大体积产物或截图。
4. 原子提交格式 `type(scope): 中文说明`，不加助手署名、`Co-Authored-By` 或工具名称尾注。
5. 推送分支并创建关联 Issue 的 PR，记录实际验证和架构影响。禁止直接推送 main，禁止 force push。
6. 与影响面匹配的验证完成后，自行合并所提交的 PR；不把等待队友 Review 当作默认门槛。用户明确限制时按用户要求执行。

## 工程边界

后端业务规则在 `modules/`，跨模块编排在 `application/`，HTTP 契约与鉴权入口在 `api/`，存储与外部服务在 `adapters/`；`bootstrap.py` 是装配入口。业务模块不能依赖 FastAPI、SQLAlchemy 或模型 SDK。跨模块使用包根公共接口。

前端 `src/app/` 承载应用路由和界面，`src/modules/` 封装产品能力。模块从 `index.ts` 暴露接口，页面不裸调用 `fetch`、重复定义 DTO 或直连模型。`backend/openapi.json` 与 `frontend/src/api/generated/` 只通过 `make contract` 生成。

个人库入口 `/library`，研究 Agent 入口 `/agent`。旧课程与公共知识路径仅用于兼容跳转；不能重新暴露公共学科目录。新增读取、导出、引用及删除路径必须检查资源所有者，不能只验证已登录。

## 运行与验收

```bash
make dev-api
make dev-web
```

默认使用最小充分验证；只有公共契约、依赖、数据结构、安全或跨模块基础设施的影响无法收窄时才执行广泛检查。禁止以 Mock、配置校验、健康检查、静态页面或构建通过宣称真实模型或浏览器全链路通过。

UI 改动完成基本运行检查后在真实浏览器查看，留给用户视觉验收；全程不截图。部署脚本仅操作 Everplain 资产，生产运行前必须通过 `ops/preflight.py`。恢复只写入新目标，不覆盖正在使用的数据库。生产流程见 [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md)。
