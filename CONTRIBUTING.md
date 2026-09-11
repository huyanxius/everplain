# 参与 Everplain 开发

采用 `Issue → 分支 → 原子提交 → PR → main`。从 [Issues](https://github.com/huyanxius/everplain/issues) 确认范围，先读 [AGENTS.md](AGENTS.md)。

```bash
git status --short
git switch main
git pull --ff-only
git switch -c <type>/<issue-number>-<short-name>
```

在已分配的工作分支上继续时不重复切分支。与其他人并行修改时保留其改动，只暂存自己负责的文件。

后端模块从包根导入，前端模块通过 `index.ts` 暴露能力。API 变化后执行 `make contract`，生成文件和后端变更一同提交，不手改生成客户端。保持 Everplain 的账号、数据、配置、端口和部署资产独立。

按影响范围执行相关测试、必要的类型检查或构建。仅当公共边界的变化无法可靠收窄时运行 `make check`；不要为了提交文档重复全量门禁。UI 用真实浏览器验收，不截图。明确区分单元测试、构建、真实模型和部署验收。

提交格式为 `type(scope): 中文说明`。一个提交一个逻辑单元，不加助手署名或 `Co-Authored-By`。禁止提交密钥、环境文件、数据库、依赖目录和构建产物。禁止直接推 main 或 force push。

PR 关联 Issue（例如 `Closes #24`），说明问题、最终行为、实际验证以及迁移或契约影响。完成必要验证后按仓库规则自行合并，不要求队友 Review；涉及高风险变化可进行有边界的独立评审，评审只读、不重复已执行测试。
