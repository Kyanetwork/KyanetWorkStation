# 发布验证证据模板

> 这是公开仓库模板，不要在此填写真实域名、服务器地址、证书路径、数据库 URL、
> 管理员凭据、SMTP/Webhook 密钥、收件人或用户数据。实际记录应复制到被忽略的
> `docs/internal/` 或部署系统，并限制访问权限。

## 记录元数据

- 发布日期/时区：`<RELEASE_DATE_TZ>`
- 发布提交：`<RELEASE_COMMIT>`
- 上一版本提交（回滚点）：`<PREVIOUS_COMMIT>`
- 操作者/复核者：`<OPERATOR>` / `<REVIEWER>`
- 变更单或任务：`<CHANGE_ID>`
- 结论：`通过` / `暂停` / `部分通过（列出阻塞）`

## 1. 运行时与依赖

- Node.js：`<NODE_VERSION>`（要求 24.x LTS）
- npm：`<NPM_VERSION>`
- `process.versions.modules`：`<NODE_MODULES_ABI>`（Node 24 基线为 137）
- `process.versions.napi`：`<NAPI_VERSION>`
- 安装命令及退出码：`npm ci --omit=dev --foreground-scripts` / `<EXIT_CODE>`
- 原生依赖加载：`better-sqlite3` 成功/失败；如重建，记录命令和原因：`<EVIDENCE>`
- 自动门禁：`npm test`、`npm audit --omit=dev --registry=https://registry.npmjs.org`、
  `git diff --check`、修改文件 `node --check`：`<RESULTS>`

## 2. 配置与监听边界

只记录键名、是否设置及安全摘要，不记录值：

| 项目 | 证据 |
|---|---|
| `DB_CLIENT`/数据库类型 | `<sqlite/mysql/postgres>` |
| `DB_PATH` 或 `DATABASE_URL` | 已设置；值未写入记录 |
| `LISTEN_HOST`/`PORT` | `<LOOPBACK_OR_PRIVATE_BINDING>` / `<PORT>` |
| `TRUST_PROXY` | `<HOP_COUNT>`；受信代理来源 `<TRUSTED_SOURCE_CLASS>` |
| `APP_BASE_URL` | 已设置；主机名以 `<REDACTED_HOST>` 表示 |
| SMTP/Webhook/MeowStatus 开关 | `<KEY=enabled/disabled>`，密钥未记录 |
| 日志与备份目录权限 | `<PERMISSION_EVIDENCE>` |

确认应用直连只在预期监听地址可达；若代理边界或跳数尚未确认，责任人、前置条件
和阻塞原因必须写在“阻塞项”中，不能用请求头 stub 代替。

## 3. 反向代理与 TLS（D-004）

- 代理类型/版本：`<nginx|IIS/ARR|Caddy>` / `<VERSION>`
- 外部入口（脱敏）：`<REDACTED_HOST>:<REDACTED_PORT>`
- 应用监听：`<LISTEN_HOST>:<PORT>`；直连是否被防火墙/代理边界阻断：`<YES/NO>`
- 配置检查命令及结果：`nginx -t` / `<IIS_OR_CADDY_CHECK>` / `<RESULT>`
- HTTP→HTTPS 状态、Location 脱敏：`<STATUS_AND_EVIDENCE>`
- 证书链、有效期和协议：`<CHAIN_EXPIRY_PROTOCOL_EVIDENCE>`
- Host/Proto 转发与应用观察到的来源：`<EVIDENCE>`
- 直连伪造 `X-Forwarded-Host`/`X-Forwarded-Proto` 的结果：`<403_OR_BLOCKED>`
- 停止条件与回滚结果：`<ROLLBACK_EVIDENCE>`

不得在模板或提交中替换占位符为真实值。未能执行时填写：责任人 `<OWNER>`、前置
条件 `<PREREQUISITE>`、阻塞原因 `<BLOCKER>`。

## 4. API 与隐私冒烟

- `GET /api/health`：`<STATUS_REQUEST_ID>`
- 匿名反馈/WorkTask 提交：`<STATUS_ID_ONLY>`；业务写入成功不依赖外部通知
- 管理员登录与列表：`<STATUS_REQUEST_ID>`
- 公共 DTO 敏感字段断言：无 `content`、`contact`、`adminNote`、账号快照、provider payload
- MeowStatus：`disabled` / `unavailable` / `ok`；异常不阻塞反馈/WorkTask
- 管理写请求来源/JSON/会话保护：`<EVIDENCE>`

## 5. 备份与隔离恢复（V-002）

- 备份来源/数据库类型：`<REDACTED_SOURCE>` / `<sqlite|mysql|postgres>`
- 脱敏确认者及时间：`<OWNER_AND_TIME>`
- 备份文件仅记录 basename：`<BACKUP_BASENAME>`
- SHA-256：`<SHA256>`
- SQLite 本地摘要命令：`npm run verify-backup:sqlite -- --backup <PRIVATE_BACKUP_PATH>`
- `integrity_check`、schema、关键表行数摘要：`<JSON_EVIDENCE_WITHOUT_ROWS>`
- RDBMS 隔离恢复命令/实例标签：`<REDACTED_COMMAND_OR_SYSTEM_REF>`
- 恢复耗时与清理确认：`<DURATION_CLEANUP>`
- 生产库未被覆盖的证据：`<ISOLATION_EVIDENCE>`
- 回滚/删除临时实例结果：`<ROLLBACK_EVIDENCE>`

脚本或测试通过不能替代真实脱敏备份演练；真实路径、URL、凭据和数据只存在于
私有记录或部署系统。

## 6. 通知链路（V-003）

- Provider（只写类型）：`<smtp|webhook>`
- 成功投递时间/脱敏目标标签：`<TIME>` / `<configured-recipients|configured-endpoints>`
- 失败响应与错误摘要（不得含 URL、密码、签名、完整收件人或请求体）：`<SUMMARY>`
- 有界重试次数与最终状态：`<ATTEMPTS_STATUS>`
- 进程重启后继续处理的 outbox 记录：`<DELIVERY_ID_STATUS>`
- 管理员查询/人工重试：`<HANDOFF_OR_DELIVERY_ID_STATUS>`
- 业务记录未因通知失败回滚：`<EVIDENCE>`
- `notification-handoff.jsonl`（如触发）：仅记录事件/业务 ID、provider、状态、次数、
  时间和脱敏错误；文件权限与备份位置：`<EVIDENCE>`

若 outbox 入队或 handoff journal 仍不可写，必须暂停发布并记录人工补偿责任人，
不得以“接口返回 201”作为投递成功证据。

## 7. 观测与回滚

- Request ID、应用日志、代理日志关联样例（脱敏）：`<EVIDENCE_REF>`
- 磁盘空间、日志轮转、备份保留：`<EVIDENCE>`
- 停止发布阈值：`<STOP_CONDITIONS>`
- 回滚命令/上一版本：`<COMMAND_REF>` / `<PREVIOUS_COMMIT>`
- 回滚后 health/API/通知/数据检查：`<RESULTS>`
- 数据是否发生写入及后续处理：`<YES_NO_AND_ACTION>`

## 8. 阻塞项与批准

| 门禁 | 责任人 | 前置条件 | 阻塞原因 | 下一步/截止时间 |
|---|---|---|---|---|
| D-004 | `<OWNER>` | `<PREREQUISITE>` | `<BLOCKER_OR_NONE>` | `<NEXT_STEP>` |
| V-002 | `<OWNER>` | `<PREREQUISITE>` | `<BLOCKER_OR_NONE>` | `<NEXT_STEP>` |
| V-003 | `<OWNER>` | `<PREREQUISITE>` | `<BLOCKER_OR_NONE>` | `<NEXT_STEP>` |

批准人：`<APPROVER>`　批准时间：`<APPROVAL_TIME>`
