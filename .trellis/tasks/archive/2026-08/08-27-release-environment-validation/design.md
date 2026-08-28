# 发布环境验证与剩余 P0 加固设计

## 设计目标与边界

本子任务在父任务已完成的 Node.js 24 + Express 单体边界内，补齐发布前真实
环境证据，并关闭 D-007（MeowStatus 外部响应/图标资源边界）和 R-004（通知
outbox 入队异常的可查询人工补偿）两个本地缺口。不引入 ORM、队列服务、
React/TypeScript、微服务或新的 KyanetAccount 协议，也不直接修改生产环境。

真实域名、代理地址、证书、数据库 URL、管理员凭据、第三方密钥和脱敏备份由
部署操作者在私有环境提供；公开仓库只保存占位符、命令模板和不含敏感值的
摘要格式。

## 工作包总览

| 工作包 | 目标 | 主要文件 | 证据 |
|---|---|---|---|
| A. MeowStatus 边界 | 限制响应大小/MIME/字段/图标解码，保持关闭/不可达/成功三态 | `server/meowstatus.js`、`public/index/main.js` | 单元 + 本地 HTTP fixture |
| B. Handoff 补偿 | outbox 入队异常写入私有、可查询、可人工重试的 handoff journal | `server/notification-handoff.js`、`server/app.js`、`tests/*` | journal 折叠、重试和脱敏测试 |
| C. 备份验证工具 | 用显式输入在隔离临时路径读取真实 SQLite 备份并输出可审计摘要 | `scripts/verify-sqlite-backup.js`、测试、运维文档 | SHA-256、integrity/schema/关键表摘要 |
| D. 发布证据模板 | 把代理/TLS、备份、通知、观测和回滚步骤固化为可填写记录 | `docs/operations/release-evidence-template.md`、发布清单 | 不含真实值的模板 + 人工记录 |

## 数据流与契约

### A. MeowStatus 外部响应

```text
MEOWSTATUS_ENABLED + settings
  -> fetch with bounded timeout
  -> content-type/byte-limit gate
  -> JSON parse
  -> allow-list normalization
  -> public state: disabled | unavailable | ok
```

`server/meowstatus.js` 继续只负责只读适配，不把原始上游对象传到 Express。

- 响应体在读取前检查 `Content-Length`（若存在），读取过程中按字节上限截断
  并失败；建议初始上限为 dashboard 512 KiB。上限是代码常量，避免新增一组
  运行时配置键；若上游确实需要更大 payload，应在独立任务中评估。
- 成功响应必须是 `application/json` 或 `application/*+json`；`text/html`、
  二进制和解析失败统一转为不可用错误，不把响应正文写入日志。
- `profile`、widget、Minecraft payload 的字符串、数组和对象都经过长度/数量
  allow-list；widget `config` 只保留页面展示所需的 host/port 等非秘密字段。
- favicon 只接受受限的 raster `data:` URL（首选 `image/png;base64`），限制
  编码文本和解码后字节数（建议 256 KiB/128 KiB），校验 base64 后再返回；
  SVG、外部 URL、HTML、非法 base64 和超限内容返回空图标。前端继续进行
  HTML 属性转义并做同等格式/长度的二次检查。
- 超时、不可达、错误状态码、超限、MIME 不符和 JSON 解析失败不抛出到公共
  500；`/api/public/meowstatus` 维持 `ok: true` 的非阻塞 envelope，状态为
  `unavailable`，反馈/WorkTask 不等待该请求。

### B. Notification handoff journal

现有 `notification_delivery` 数据库 outbox 继续承载正常 pending/retrying/
failed/delivered 投递。仅当 `enqueueNotificationDeliveries` 抛出异常时，
`server/app.js` 追加一个私有 JSONL handoff 记录，避免继续“只写日志”。文件
位置由 `path.dirname(config.dbPath)` 推导为同一私有数据目录下的
`notification-handoff.jsonl`，不新增外部服务或公开 URL。

单条 journal 事件只允许以下字段：

```json
{
  "handoffId": "uuid",
  "eventId": "feedback:123:webhook",
  "entityType": "feedback",
  "entityId": 123,
  "providers": ["webhook"],
  "status": "pending|retrying|resolved|failed",
  "attempts": 0,
  "lastError": "bounded, redacted message",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

禁止写入 content、contact、SMTP 收件人、Webhook URL、密码、签名、请求体或
上游响应正文。读取时按事件 ID 折叠最新状态并限制记录数；写入使用单进程
串行 append，单行有大小上限，目录/文件按当前平台可用的私有权限创建。

管理员新增查询/重试入口（沿用现有会话、JSON 和同源保护）：

- `GET /api/admin/notification-handoffs`：只返回未解决或最近记录的安全 DTO；
- `POST /api/admin/notification-handoffs/retry`：输入 `handoffId`，按事件/业务
  ID 重新调用现有幂等 outbox 入队，成功追加 `resolved`，失败追加 bounded
  `retrying`/`failed`；已解决记录不可重复重放。

若 journal 文件本身不可写，仍记录不含秘密的 `handoff.persistence.error`，
并在业务响应中保持原有成功语义；运维文档将该极端故障列为“暂停发布、从日志
按 event/entity 手动补偿”的明确降级边界，而不是隐式丢失。

### C. 隔离 SQLite 备份验证

新增 `scripts/verify-sqlite-backup.js --backup <path>`，只接受显式 `.db` 或
`.db.gz` 路径：

1. 计算源文件 SHA-256，不打印完整路径或数据内容；
2. 将 gzip 解压/数据库复制到 OS 临时目录，使用 read-only better-sqlite3 打开；
3. 执行 `PRAGMA integrity_check`，确认 `feedback`、`worktask`、`admin_user`、
   `workstation_setting` 以及历史 `account_session`/`notification_delivery`
   表存在，并只输出行数/布尔结果；
4. 在 `finally` 关闭连接并删除临时目录，输出 JSON 摘要供内部记录。

该工具不读取 `DATABASE_URL`、不覆盖生产库，也不代替 MySQL/PostgreSQL 提供商
的隔离恢复；RDBMS 恢复继续由发布模板记录实际 `mysqldump`/`pg_dump` 及供应商
恢复命令。

### D. 发布验证证据

公开模板使用 `<REDACTED_HOST>`、`<RELEASE_COMMIT>` 等占位符；实际记录放在
被 `.gitignore` 忽略的 `docs/internal/` 或部署系统。模板按以下顺序记录：

1. Node/npm/ABI 和依赖安装；
2. 配置键摘要、监听地址、代理 hop/来源边界；
3. HTTP→HTTPS、证书链、Host/Proto 转发和直连不可达；
4. health/API 冒烟与隐私/同源回归；
5. 真实脱敏备份 checksum、隔离恢复、schema/关键行、清理和回滚；
6. SMTP/Webhook 成功、失败、有限重试、重启恢复和管理员重试；
7. 观测、停止条件、上一版本和数据库回滚结果。

## 兼容性、迁移与回滚

- 不改现有业务表和 `notification_delivery` schema；journal 是可删除/可迁移的
  私有旁路文件，SQLite/MySQL/PostgreSQL 行为保持一致。
- 所有新增 API 使用现有 `{ ok: true, data }`/`sendError` 契约和管理员会话；
  journal 读取失败返回安全的内部错误，不把文件内容原样返回。
- D-007 只收紧上游输入边界；若真实 MeowStatus 不符合 MIME/大小契约，状态卡
  片进入 unavailable，核心提交流程不受影响。
- 若 handoff journal 或新脚本回归失败，回滚新增模块、路由和 npm script；保留
  已有数据库 outbox 与业务数据，不删除历史 journal/备份证据。
- 真实部署验证失败时停止切换并按上一版本文件 + 备份恢复；不修改 DNS、证书、
  防火墙或第三方 provider 配置，除非用户另行批准。

## 关键取舍

- 采用私有 JSONL handoff 作为极少数 outbox 入队异常的补偿边界，复用现有
  数据库 outbox 处理正常路径，避免为了 P0 引入消息队列或第二套持久化数据库。
- 采用固定安全上限而不是新增可变环境键，降低配置面和错误组合；上游确需放宽
  时再以独立任务评估并配套审计。
- 自动化只验证本地可复现部分；代理/TLS、真实备份和真实通知坚持保留人工
  部署证据，不用 stub 冒充生产验证。
