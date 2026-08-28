# 测试与发布门禁

## 自动检查

在与项目声明相符的 Node.js 版本上执行：

```powershell
npm test
git diff --check
npm audit --omit=dev --registry=https://registry.npmjs.org
```

发布基线为 Node.js 24.x LTS。npm 12 的安装脚本策略在
`package.json#allowScripts` 中仅允许 `better-sqlite3`；执行带有前台脚本的
`npm ci --foreground-scripts` 后，若预构建包不可用，再运行
`npm rebuild better-sqlite3`，确认 `process.versions.modules=137` 且原生模块可加载。
当前 Node 24 发布锁定 `better-sqlite3 ^13.0.3`；不要只凭 ABI 数字判断兼容性，
还要执行管理员登录回归，因为旧的 12.11.1 在 Express JSON 请求上下文中曾触发
原生环境清理断言。

### 当前环境基线记录（2026-08-28）

- Node.js：`v24.19.0`；npm：`12.0.2`；当前运行时模块 ABI：`137`，N-API：`10`。
- 依赖目标：`better-sqlite3 ^13.0.3`、`express ^4.22.2`、`nodemailer ^9.0.5`。
- 已在当前工作区以 canonical npm registry 执行 `npm ci --foreground-scripts`，
  干净安装后原生模块加载成功（ABI 137）；管理员登录/API 冒烟和新增回归通过，
  当前完整测试为 `69/69`。

## 必须覆盖的行为

- health、匿名反馈/WorkTask 提交、管理员登录和管理员列表查询；当前匿名提交不依赖 KyanetAccount 策略，旧 Account 路由应返回 404。
- 未登录管理接口、跨来源管理写请求、错误 Content-Type 和限流响应。
- 公共 highlights 不含 `content`、`contact`、`adminNote`、账号快照等内部字段。
- 任何用户安全列表不含管理员备注和其他用户数据。
- 备份脚本生成有效文件，并能在临时数据库完成 checksum、解压、schema 和关键表读取（`tests/backup-sqlite.test.js`）；本机真实 `.env` 数据库的脱敏隔离演练已记录，发布目标不同仍需重演。
- SQLite 发布前可使用 `npm run verify-backup:sqlite -- --backup <PRIVATE_BACKUP_PATH>` 在隔离临时路径执行 checksum、`integrity_check` 和关键表摘要；该结果不能替代真实脱敏恢复记录。
- MeowStatus 不可达、超时和关闭设置时，主页仍能给出可理解状态；上游 Dashboard/MIME/字段/favicon 超限不得阻塞提交。
- SMTP/Webhook 至少一条链路在测试环境可发送，失败目标能被记录和重试。
- outbox 入队异常可在私有 `notification-handoff.jsonl` 查询、脱敏并人工重试；journal 不可写时应暂停发布并记录人工补偿。

## 发布门禁

| 门禁 | 证据 | 状态 |
|---|---|---|
| 依赖安装和 Node ABI 匹配 | Node 版本、安装日志、启动结果 | Node 24 / ABI 137 已验证 |
| 单元/集成测试 | `npm test` 输出和退出码 | Node 24 / better-sqlite3 13.0.3：69/69 |
| 依赖漏洞 | `npm audit` 报告及升级/缓解结论 | canonical registry 当前 0 项 |
| API 冒烟 | health → 提交 → 管理登录 → 列表 | 已在临时数据库验证 |
| 隐私投影 | 接口响应断言 | 已有回归覆盖 |
| 备份恢复 | `tests/backup-sqlite.test.js` + 临时恢复记录和数据校验 | 本机真实脱敏副本已完成；发布目标不同需按模板重演 |
| 通知链路 | SMTP/Webhook 测试结果、handoff journal（如触发） | 本机真实 SMTP/Feishu 与隔离重试已完成；目标变更需重新授权和验证 |
| 代理与 TLS | Nginx/IIS/Caddy 配置测试 | 部署环境执行 |
| 配置与密钥 | `.env` 检查、无默认凭据 | 部署环境执行 |
| 观测与回滚 | request ID、日志、上一版本和备份 | 部署环境执行 |

## 手动验收记录格式

每次发布记录日期、Git 提交、Node/npm/ABI 版本、数据库类型、测试命令、结果、未覆盖项、备份 checksum/隔离恢复、通知成功/失败/重启/人工重试、代理/TLS 证据、回滚结果和操作者。真实服务器地址、凭据、用户数据和日志不写进仓库；请使用[发布验证证据模板](../operations/release-evidence-template.md)，实际记录放在被忽略的 `docs/internal/` 或部署系统。
