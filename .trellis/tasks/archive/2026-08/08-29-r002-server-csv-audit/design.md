# R-002 服务端流式 CSV 导出与操作审计：技术设计

## 1. 目标与边界

R-002 将管理员反馈/WorkTask 导出从“浏览器分页拉取后拼接”改为服务端有界分批导出，并为高影响管理员动作增加动作级、脱敏审计。核心运行时仍为 Node.js 24 + Express + CommonJS + 原生 HTML/CSS/JavaScript；SQLite、MySQL、PostgreSQL 继续共用 `server/db.js` 适配层。

本任务不引入数据库游标依赖、异步导出队列、临时文件系统、ORM、前端框架或跨实例协调；不提供并发写入的长事务快照。导出最大行数由环境变量调整，但仍受代码硬范围保护。

## 2. 组件边界

```text
管理员浏览器
  │ 管理员会话 + POST JSON
  ▼
server/app.js
  ├─ validation.js       导出/审计筛选校验
  ├─ admin-export.js      CSV 列定义、转义、分批写出和背压
  ├─ admin-audit.js       脱敏元数据与安全审计写入
  └─ db.js                计数、批量读取、审计表读写
         │
         └─ SQLite / MySQL / PostgreSQL
```

- `app.js` 只编排中间件、认证、参数校验、数据库函数和响应头；不直接拼 SQL 或在路由中复制 CSV 转义逻辑。
- `validation.js` 新增反馈/WorkTask 导出和审计查询验证器，复用现有状态、优先级、关键词、ID 和时间解析规则。
- `admin-export.js` 提供固定批次常量（250 行）、稳定列定义、CSV 转义、响应头和 `res.write` 背压处理；它接收批次查询回调，不依赖具体数据库驱动。
- `admin-audit-metadata.js` 维护动作元数据的白名单、字段长度和 2048 字节上限；`admin-audit.js` 接收路由显式构造的动作和白名单元数据，调用 `db.createAdminAudit`。任何写入异常只记录结构化日志并吞掉，不改变业务响应。它不接受原始请求体或业务正文作为 metadata。
- `db.js` 维护三数据库 `admin_audit` schema、导出计数/批次查询、审计写入/分页查询。SQL 全部使用现有 `placeholder`、`queryOne`、`queryAll`、`execute`。
- `public/admin/admin.js` 保留现有按钮和筛选 UI，只把导出动作改为一次 POST 下载；错误响应解析为现有消息/Toast，不再保存全量 rows。

## 3. 配置与资源边界

`server/config.js` 新增：

| 配置 | 默认值 | 约束 | 说明 |
|---|---:|---:|---|
| `ADMIN_EXPORT_MAX_ROWS` | `10000` | `100–100000` 的安全整数 | 单次反馈或 WorkTask 导出最大行数；改 `.env` 后需重启进程 |

配置同时放入 `rawInput.adminExportMaxRows`，由 `validateRuntimeConfig` 检查显式非法值和解析后的范围。缺失值使用默认值；非数字、浮点、负数、超出范围的显式值使启动 preflight 失败，错误中不回显原始值以外的敏感配置。批次大小 `250` 固定在 `admin-export.js`，不新增第二个可调参数。

## 4. CSV 导出契约

### 4.1 路由与请求

```text
POST /api/admin/feedback/export
{ "status": "", "keyword": "" }

POST /api/admin/worktask/export
{ "status": "", "priority": "", "keyword": "" }
```

两个路由都位于现有 `/api/admin` 会话、同源、JSON 和限流中间件之后。请求体只接受现有列表筛选字段；未知字段忽略，枚举/长度/类型错误返回 `400 INVALID_PAYLOAD`。

### 4.2 响应

成功响应在发送正文前设置：

```text
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="feedback_export_YYYY-MM-DD.csv"
Cache-Control: no-store
X-Export-Count: <开始导出前的匹配总量>
```

正文首字节为 UTF-8 BOM，随后是稳定表头和逐行 CSV。反馈列保持当前浏览器导出的 11 列：

```text
id,type,title,content,contact,status,accountUserId,accountEmailSnapshot,accountDisplayNameSnapshot,createdAt,updatedAt
```

WorkTask 列保持当前浏览器导出的 16 列：

```text
id,type,title,content,contact,priority,status,accountUserId,accountEmailSnapshot,accountDisplayNameSnapshot,expectedAt,scheduledAt,assignee,tags,createdAt,updatedAt
```

每个值统一转为字符串；双引号加倍并用双引号包裹，换行、逗号和 Unicode 原样保留。`images`、`adminNote`、`publicReply`、`showOnHome` 等当前导出未包含的字段不新增到本任务。

### 4.3 有界分批流程

1. 校验筛选并查询匹配总数。
2. 若总数大于 `config.adminExportMaxRows`，在发送任何 CSV 响应头前返回 `413 EXPORT_LIMIT_EXCEEDED`；写入 `rejected` 审计，metadata 只含总量、上限和 `hasKeyword/status/priority` 等摘要，不保存关键词原文。
3. 设置响应头并写入 BOM/表头。
4. 以 `created_at DESC, id DESC` 查询固定 250 行，映射为 CSV 行后立即写入；`res.write` 返回 `false` 时等待 `drain`。循环以开始时的总量为上限，不因并发新增无限延长。
5. 正常 `finish` 事件写入 `success` 审计；客户端提前关闭或批次查询失败时写入 `failed` 审计并记录脱敏日志。响应头已经发送时不尝试追加 JSON 错误。

`X-Export-Count` 表示第 1 步的匹配总量；并发删除可能导致实际行数更少。该行为与“无长事务快照”边界一致，审计记录使用实际已写行数（若可得）。

## 5. 操作审计契约

### 5.1 表结构语义

三种数据库都创建 `admin_audit`：

| 字段 | 语义与限制 |
|---|---|
| `id` | 自增审计 ID |
| `created_at` | ISO 时间文本 |
| `actor_user_id` | 管理员 ID 快照，可空 |
| `actor_username` | 管理员用户名快照，最多 64 字符 |
| `action` | 稳定点号动作名，最多 64 字符 |
| `entity_type` | `feedback`/`worktask`/`ai_suggestion`/`notification` 等，最多 32 字符 |
| `entity_id` | 业务 ID，可空 |
| `request_id` | 现有请求 ID，最多 120 字符 |
| `result` | `success`、`not_found`、`rejected` 或 `failed` |
| `metadata_json` | 代码白名单元数据 JSON，序列化后最多 2048 字节 |

索引为 `created_at`、`action`、`entity_type/entity_id` 和 `actor_user_id`，不对 metadata 正文建索引。旧数据库使用 `CREATE TABLE IF NOT EXISTS` 追加表，不删除或重写既有数据。

### 5.2 动作覆盖

路由在业务调用完成后显式写入以下动作；`changes===0` 或导出超限分别使用 `not_found`/`rejected`：

| 动作 | 允许的 metadata 示例 |
|---|---|
| `feedback.export` / `worktask.export` | `rowCount`、`maxRows`、`hasKeyword`、状态/优先级筛选 |
| `feedback.status` / `worktask.status` | 请求状态、业务 ID |
| `feedback.delete` / `worktask.delete` | 业务 ID |
| `feedback.home_display` / `worktask.home_display` | `showOnHome`、业务 ID |
| `feedback.note_reply` / `worktask.note_reply` | `fields`、各字段长度，不保存正文 |
| `worktask.create` / `worktask.arrange` | 业务 ID、字段名、状态/清空标记，不保存标题/正文/负责人原文 |
| `ai.profile.save` / `ai.profile.active` / `ai.profile.delete` | profile ID、协议/模型名（不含 URL 或 key） |
| `ai.suggestion.decision` | suggestion ID、decision、字段名 |
| `notification.retry` / `notification_handoff.retry` | delivery/handoff ID、结果，不含 target/载荷 |
| `status.profile.update` / `status.minecraft.update` | enabled 或字段名 |
| `notify.smtp_test` / `notify.webhook_test` | provider、收件人数/结果，不含地址、正文或签名 |

验证失败且未进入业务层的请求不写数据库审计，继续由现有访问/错误日志记录；登录密码、Cookie、Provider Key、完整正文、联系方式和 URL query 永不进入 metadata。

### 5.3 写入失败语义

`recordAdminAuditSafely` 对 metadata 再次做类型/长度限制，调用数据库写入并捕获异常；失败时用 `logger.warn({ event: "admin.audit.write.error", requestId, action, errorCode }, ...)` 记录有限字段。它不能抛回业务路由，因此审计故障不会回滚已成功的状态、删除、通知或导出。

### 5.4 查询接口

```text
POST /api/admin/audit/list
{
  "action": "feedback.status",
  "entityType": "feedback",
  "entityId": 42,
  "actor": "admin",
  "from": "2026-08-01T00:00:00.000Z",
  "to": "2026-08-31T23:59:59.999Z",
  "page": 1,
  "pageSize": 20
}
```

筛选字段均有长度/类型边界；时间标准化为 ISO，`pageSize` 最大 100。响应为 `{ ok: true, data: { items, page, pageSize, total, totalPages } }`，metadata 解析失败返回 `{}`，每项只暴露上表字段的 camelCase 投影。查询需要管理员会话，不新增公共入口，也不把审计写入访问日志 query。

## 6. 错误与日志

- `400 INVALID_PAYLOAD`：导出或审计筛选类型、枚举、时间、长度不合法。
- `413 EXPORT_LIMIT_EXCEEDED`：匹配总量超过配置上限；错误消息包含当前上限和缩小筛选范围的建议，但不包含关键词或业务正文。
- `401/403/415/429`：继续使用现有管理员会话、同源、JSON、限流中间件语义。
- 导出开始前的数据库错误走现有 async error handler；导出开始后的错误只能关闭响应，并写 `admin.export.stream.error` 脱敏日志。
- 访问日志只保留请求 ID、路由、状态、耗时；不得记录 POST body、CSV 内容、metadata 原文或密钥。

## 7. 兼容、部署与回滚

- 新环境变量缺失时使用默认 10,000，不影响旧 `.env`；显式非法值在启动 preflight 阶段失败，避免运行中才出现不可预测上限。
- 新表为追加式初始化；旧版本回滚时会忽略 `admin_audit`，不执行删除迁移。数据库备份包含审计记录，按现有备份策略保留；本任务不新增清理作业。
- 代码回滚不覆盖生产 `.env`、数据库、备份或日志。若导出压力过大，可先调低 `ADMIN_EXPORT_MAX_ROWS` 并重启 PM2；若功能异常，可回退版本，现有分页列表仍可用。
- MySQL/PostgreSQL 真实连接验证继续作为 V-005 隔离环境工作；本任务至少确保 schema/placeholder 与 SQLite 回归一致。

## 8. 验证策略

1. 配置测试：默认值、100/100000 边界、非法字符串/浮点/越界启动失败且不泄露值。
2. CSV 单元/API 测试：BOM、稳定列顺序、逗号/引号/换行/Unicode 转义、筛选、文件名/响应头、250 行批次、背压、上限拒绝和服务端不收集全量数组。
3. 审计数据库/API 测试：表幂等初始化、写入失败降级、动作/实体/管理员/时间筛选、分页、metadata 脱敏与管理员权限。
4. 现有管理动作回归：状态、删除、主页展示、备注/回复、安排、创建、AI decision、通知 retry 均生成对应动作；业务表和通知语义不变。
5. 质量门禁：变更 JavaScript `node --check`、聚焦 `node --test`、完整 `npm test`、canonical `npm audit`、`git diff --check`、Trellis check，以及本地管理员浏览器下载/错误/亮暗主题/窄屏冒烟。
