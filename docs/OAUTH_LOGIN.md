# Google / GitHub 登录与账户绑定

## 交付边界

这是后端 Authlib 授权码流程与前端入口，不含第三方应用创建或生产凭据。
未完整配置的提供方不会显示登录按钮，邮箱验证码注册和邮箱密码登录保持原流程。
OAuth-only 新用户不自动获得可猜测的本地密码；首次登录不强制额外设置密码。
OAuth-only 账户（`login_mode=federated`）使用已绑定的 Google 或 GitHub 登录，没有本地邮箱和密码。
管理员不能为这类账户签发有效的密码重置链接；即使已有历史重置令牌，消费端也拒绝把它转换为密码登录账户。
设置页说明第三方邮箱不会启用邮箱登录或密码重设；管理员用户页禁用这类账户的密码重置按钮。
已有邮箱密码账户的管理员辅助重设仍走原有身份核验、一次性链接及会话撤销流程；绑定第三方身份不改变其本地登录方式。
系统目前没有公开的“忘记密码”或邮箱验证码自助重设接口，不把注册验证码当作密码恢复凭证。
管理员签发能力依赖既有部署管理员配置；不得新增无需管理员或未核验身份的签发入口。
邮箱密码账户的改密码、停用和删除仍需当前密码校验。OAuth-only 账户没有本地密码；设置页隐藏这些自助操作，第三方重新认证后的停用/注销流程尚未实现。
设置页的“联系管理员”只是一条人工求助提示，不证明已有 OAuth-only 注销接口、替代登录方式或恢复保证。
当 OAuth-only 用户无法使用已绑定的提供方时，当前交付没有另一条自助账号恢复路径，不应把管理员密码重设当作替代登录方式。

当前已核实生产浏览器 origin 为 `https://e.qunxue.xyz`。精确回调：

- Google：`https://e.qunxue.xyz/api/session/oauth/google/callback`
- GitHub：`https://e.qunxue.xyz/api/session/oauth/github/callback`

GitHub 应建立 OAuth App，不使用需要不同授权契约的 GitHub App。
GitHub callback 的 wildcard matching 必须关闭，不填写其他子域名或通配地址。
Google OAuth client 类型为 Web application；配置上述 authorized redirect URI。
登录只请求 Google `openid email` 与 GitHub `user:email`，不请求仓库、组织、Drive、
离线访问或刷新令牌权限。

## 服务器配置

通过现有受保护的 Everplain 配置流程设置，禁止写入 Git、PR、前端构建或聊天：

```
EVERPLAIN_OAUTH_PUBLIC_ORIGIN=https://e.qunxue.xyz
EVERPLAIN_SESSION_COOKIE_SECURE=true
EVERPLAIN_OAUTH_GOOGLE_CLIENT_ID=<Google Web OAuth client ID>
EVERPLAIN_OAUTH_GOOGLE_CLIENT_SECRET=<Google Web OAuth client secret>
EVERPLAIN_OAUTH_GITHUB_CLIENT_ID=<GitHub OAuth App client ID>
EVERPLAIN_OAUTH_GITHUB_CLIENT_SECRET=<GitHub OAuth App client secret>
```

可只启用一个提供方。origin、对应 client ID、非空 secret 缺一则该入口关闭。
生产 origin 仅允许 HTTPS；本机开发可使用 loopback HTTP，并配置对应独立回调。
不要从 Host 或 X-Forwarded-Host 动态生成回调。现有 CORS 列表应包含实际浏览器 origin。
API 必须经过同站点反向代理。HTTPS OAuth state cookie 使用 __Host- 前缀、Secure、Path=/，
不设置 Domain，以防同父域其他子域植入 cookie。loopback HTTP 开发保留普通名称和限定路径。
既有应用会话也建议经正常配置审批使用 EVERPLAIN_SESSION_COOKIE_NAME=__Host-everplain_session，
Path=/、Secure、无 Domain 已由服务器设置满足。更名会使旧会话退出，应作为上线决策明确告知用户。

正式 Google 应用需完成其官方 consent screen 所要求的品牌、联系信息、网站与隐私信息，
并按实际发布状态配置测试用户或发布；控制台完成不等于用户登录已验收。
不要提交 credential 文件来进行“验证”。Provider token 仅在后端交换和身份读取时存在，
不持久化、不返回给浏览器。现有生产 `ops/start-api.sh` 已关闭 API access log；
反向代理也必须避免记录 OAuth callback 查询参数，以免记录临时 code / state。

## 身份与安全契约

- Google 由 Authlib 进行 JWKS 签名、issuer、audience、nonce、exp / iat 校验，
  email_verified 必须为布尔 true；只接受授权码流程。
- GitHub 每次兑换后从官方 `/user` 重新读取稳定 numeric ID，再从 `/user/emails`
  读取已验证主邮箱；不以公开 email 字段替代验证。不接受超出 user:email 的授权范围。
- 主键为 `(provider, subject)`，邮箱相同绝不自动合并或登录现有账户。
- 登录已有账号后，在设置 → 安全中明确点击“绑定 Google / GitHub”。绑定 callback
  必须与发起时完全相同且仍有效的服务器会话匹配。其他人的已绑定 subject 无法转移。
- 随机 state、单独 HttpOnly SameSite=Lax 浏览器绑定 cookie、S256 PKCE 与 nonce。
  state 只存摘要，10 分钟有效，callback 通过数据库原子 DELETE RETURNING 领取一次，
  在网络请求前提交；失败与取消也不能重放。
- 发起仅接受来自配置 origin 的 POST。回跳只允许站内 root-relative 应用 URL，
  拒绝绝对 URL、协议相对 URL、反斜杠、编码控制字符与 API 路径。
- 提供方网络请求不持有 SQLite 写锁；创建用户、绑定身份、30 注册额度与服务器会话
  使用同一个短事务。并发同 subject 登录只创建一名用户；拒绝 disabled 账户。
- OAuth 登录 / 绑定不启动 first-message 周期；周期仍由原有业务流程负责。
- 返回页面只包含固定错误码，没有 provider token、错误原文或用户身份明细。

## 迁移与发布

`20261005_0620_federated_login` 的 down_revision 是 `20261005_0615`。
0620 新增 federated_identities 与短期 oauth_transactions；后续 0630 区分第三方联系邮箱和本地邮箱登录方式。
这些迁移已属于当前源码历史，0620 不是当前发布 head。发布时应针对实际候选运行完整迁移图和旧数据升级检查，
确认单 head、必要检查及前置迁移完整；不得为提前发布创建另一个 head、修改既有 down_revision 或跳过迁移。
升级保留既有用户、会话与绑定关系；不能根据提供方邮箱推断本地密码登录资格。
不能通过 downgrade 删除已绑定身份；恢复应遵循现有新目标备份恢复流程。

实现核对：[身份服务](../backend/src/qunxue_api/modules/identity/service.py#L149)、[重置签发](../backend/src/qunxue_api/modules/account_management/service.py#L573)、[重置消费](../backend/src/qunxue_api/adapters/sqlite/account_management_repository.py#L518)、[设置页](../frontend/src/modules/account/AccountSettingsPage.tsx#L193)、[管理员入口](../frontend/src/modules/account/AdminUsersPage.tsx#L276)。

## 验证与最终验收

本地 tests/test_oauth_login.py 使用合成 provider HTTP 流量与真实 RSA / JWKS / Authlib 验证。
包括拒绝错误 issuer / audience / nonce / expiry / verified-email / signature、
GitHub 验证主邮箱和最小 scope、callback 浏览器与 provider 绑定、重放、显式绑定、
原会话匹配、用户停用、事务回滚及并发身份唯一性。
合成流量、构建和配置校验不代表第三方实号登录或生产验收。

生产凭据通过受保护流程配置并部署后，必须从真实浏览器分别验证：
1. Google 与 GitHub 完成首次创建或已绑定账户登录，拿到正常 HttpOnly Secure session。
2. 刷新页面仍保持登录，目标路径正确，第三方 token 没有进入 URL / 浏览器响应。
3. 相同联系邮箱不会合并或登录已有账户；未绑定的 provider subject 创建独立账户。要给已有邮箱密码账户绑定提供方，先登录该账户并明确发起绑定，原有数据和权限不变。
4. 重复登录不重复发放 30 注册额度，不重置额度周期；邮箱登录继续有效。
5. 取消授权、过期 state、错误回调与绑定会话退出都安全失败。

官方资料：
- [Authlib Starlette OAuth client](https://docs.authlib.org/en/stable/oauth2/client/web/starlette.html)
- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
- [GitHub OAuth App authorization](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [GitHub OAuth scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)
