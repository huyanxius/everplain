# Mac → 云端开发交接（WIP）

只授权分支推送、Issue 与草稿 PR。禁止合并、部署或绕过 GitHub 门禁。生产本轮未变更。

## 获取完整最新源码

```bash
git clone https://github.com/huyanxius/everplain.git
cd everplain
git fetch origin
git switch --track origin/feat/60-soul-memory-panel
```

该分支累计包含原设计历史、计费修复、完整功能 UI、Soul、侧栏、常驻模型栏、按钮对比与最新抽屉布局。不是已验收发布。

## 精确分支依赖快照

| PR | 分支 | 提交 | 基分支 | CI |
|---|---|---|---|---|
| #43 | feat/42-design | 72faed2d529fb137bdc93f2bb2e4794bce15cb5a | fix/40-cross-run-refund | backend:SUCCESS, frontend:SUCCESS |
| #45 | feat/44-models | 72f18f1e86d6e564baee876505c2104a52830ab2 | feat/42-design | backend:SUCCESS, frontend:SUCCESS |
| #47 | feat/46-account-navigation | 1826d1df2914c70ad70ee9872f61dda29faf397f | feat/44-models | backend:SUCCESS, frontend:SUCCESS |
| #49 | feat/48-library | 5ac30a91a646d34ebe33c3e071d459c7aee3c7f4 | feat/46-account-navigation | backend:SUCCESS, frontend:FAILURE |
| #51 | feat/50-research | 237cf5adc2046b4270597f1ff556e68daf483c00 | feat/48-library | backend:SUCCESS, frontend:SUCCESS |
| #53 | feat/52-pricing | aed7fa67d2ca154f40a8b1bfb36332b1de07ba1d | feat/50-research | backend:SUCCESS, frontend:SUCCESS |
| #55 | feat/54-soul-profile | 620b7639d8d470782a4324d662b4795c81015857 | feat/52-pricing | backend:SUCCESS, frontend:SUCCESS |
| #57 | feat/56-model-toolbar | 0a6734d645bb8d8b830777ecd18536593233ba14 | feat/54-soul-profile | backend:SUCCESS, frontend:FAILURE |
| #59 | fix/58-primary-button-contrast | e4f6eca240ebb71fd4c9d15f9441ce5b7765c1ed | feat/56-model-toolbar | backend:SUCCESS, frontend:FAILURE |
| #61 | feat/60-soul-memory-panel | 44c09b27ac39a3b29daad0e46b1a21cb756d499e | fix/58-primary-button-contrast | backend:QUEUED |

本文件提交会使 #61 的 head 前进；上表 #61 是四文件布局提交，可用 `git rev-parse HEAD` 获取文档后的精确 head。

## 云端环境

使用 Python 3.12+、uv、Node 24（生产最近只读核实为 24.21.0）。锁文件已在仓库：backend/uv.lock、frontend/package-lock.json、extensions/clipper/package-lock.json。

```bash
cd backend && uv sync --frozen && cd ..
cd frontend && npm ci --ignore-scripts && cd ..
# 按 .env.example / backend/.env.example 设置独立 Everplain 本地配置
make dev-api
make dev-web
```

只使用全新的 Everplain 开发数据库，禁止复制群学或线上数据库。没有模型凭据时保持 mock/现有受限模式，不执行付费请求。前后端端口 8297/5196。运行前阅读 AGENTS.md、HANDOFF.md、CONTRIBUTING.md 和 docs/DISTRIBUTION.md。Mac 本轮未安装依赖或启动新后台，云端环境尚需实际安装验证。

## 已知待办

- #49 前端单项失败：App.test.tsx 的 “opens private knowledge in the library and links each topic to its original segment”，旧按钮名“查看知识点 追问”与新 UI 不符；812 测试通过，1 失败。只对齐同名测试块，不能把后续研究测试全移入早期 PR。
- #57/#59 前端 CI 失败待查；backend 成功。必须查看当前 exact-head 日志，不能宣称完整 UI 通过。
- #61 新 CI 等待中；布局作者报告 29 项相关测试与组合 typecheck 通过，主发布未重跑。
- Stage-only 测试修复顺序：49→51→53→55→57→59→61，正常 merge 上游到功能分支并 push；55 在独立工作树。所有 PR 仍 draft。
- 用户真实视觉验收未完成；按钮 CSS layer 修复需完整刷新，HMR 不能重排已注册层。
- 没有新模型真实调用或生产验证。Soul migration 20261003_0520 follows 20261002_0510，仅未来获准部署时运行。

## 额外交付备份

Soul + 最新 panel Library：libfile_59330d9381788191a7552d69c67d779f；file_00000000c78c81fdb9e438042dcf15e2；v0；everplain-soul-panel-delivery.tar.gz；SHA256 163ffcc24975e3bc1804cf97ca249b15a844eb793d63dc812bebb850326f13ae（23301 bytes，作者已上传）。

模型栏 Library：libfile_dfda21b3bf048191aaa7b331ac71d861；file_000000000e2881fd85efa9c4ad1129de；v0；SHA256 0c22971516292f04198785f1c6595d94c474f2828f6e399695b7c09b4ae0a7d0。

所有发布工作树已检查无未提交改动；新增 panel 四文件逐项 before/after SHA256 与补丁 SHA256 核对通过。不存在等待本机上传的发布工作树 hunk。其他 owner 原工作树保留，由各 owner 负责补丁备份。
