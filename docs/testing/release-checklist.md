# 测试与发布门禁

## 自动检查

在与项目声明相符的 Node.js 版本上执行：

```powershell
npm test
git diff --check
npm audit --omit=dev --registry=https://registry.npmjs.org
```

当前 Node 24 环境发现 `better-sqlite3` ABI 与运行时不匹配，`npm test` 不能据此宣称通过。应先使用项目支持的 Node 版本重新安装/重建依赖，再记录新的测试结果。

### 当前环境基线记录（2026-08-26）

- Node.js：`v24.19.0`；npm：`12.0.2`。
- 已安装的 `better-sqlite3` 原生模块使用 `NODE_MODULE_VERSION 127` 编译；当前 Node.js 要求 `NODE_MODULE_VERSION 137`。
- 具体错误为：`ERR_DLOPEN_FAILED`，提示 “was compiled against a different Node.js version … Please try re-compiling or re-installing”。因此涉及 SQLite 的测试失败，当前 `npm test` 结果不能视为通过。
- 修复验证：使用项目支持且与依赖 ABI 匹配的 Node.js 版本，执行干净的 `npm install` 或 `npm rebuild`，随后重新运行 `npm test`。

## 必须覆盖的行为

- health、默认 fail-closed 的匿名反馈/WorkTask 拒绝、显式允许匿名策略下的提交、管理员登录和管理员列表查询。
- 未登录管理接口、跨来源管理写请求、错误 Content-Type 和限流响应。
- 公共 highlights 不含 `content`、`contact`、`adminNote`、账号快照等内部字段。
- 任何用户安全列表不含管理员备注和其他用户数据。
- 备份脚本生成有效文件，并能在临时数据库完成恢复读取。
- MeowStatus 不可达、超时和关闭设置时，主页仍能给出可理解状态。
- SMTP/Webhook 至少一条链路在测试环境可发送，失败目标能被记录和重试。

## 发布门禁

| 门禁 | 证据 | 状态 |
|---|---|---|
| 依赖安装和 Node ABI 匹配 | Node 版本、安装日志、启动结果 | 当前待处理 |
| 单元/集成测试 | `npm test` 输出和退出码 | 当前环境受 ABI 阻塞 |
| 依赖漏洞 | `npm audit` 报告及升级/缓解结论 | 当前有 4 项待处理 |
| API 冒烟 | health → 提交 → 管理登录 → 列表 | 待建立/验证 |
| 隐私投影 | 接口响应断言 | P0 必须完成 |
| 备份恢复 | 临时恢复记录和数据校验 | 尚无真实演练证据 |
| 通知链路 | SMTP/Webhook 测试结果 | 需至少一条可用 |
| 代理与 TLS | Nginx/IIS/Caddy 配置测试 | 部署环境执行 |
| 配置与密钥 | `.env` 检查、无默认凭据 | 部署环境执行 |
| 观测与回滚 | request ID、日志、上一版本和备份 | 部署环境执行 |

## 手动验收记录格式

每次发布记录日期、Git 提交、Node/npm 版本、数据库类型、测试命令、结果、未覆盖项、备份位置、回滚结果和操作者。真实服务器地址、凭据、用户数据和日志不写进仓库。
