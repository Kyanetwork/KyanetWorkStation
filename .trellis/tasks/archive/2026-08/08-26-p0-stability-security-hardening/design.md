# P0 稳定性与安全加固设计

## 设计目标与边界

本任务把现有单体应用整理到一个可发布的安全与运行时基线，不改变
KyanetWorkStation 的基本技术架构。反馈和 WorkTask 继续使用独立业务表，
`server/db.js` 仍是唯一数据库访问边界，Express 仍负责 HTTP 组合，静态
前端继续使用原生 HTML/CSS/JavaScript。

本任务不实现统一首页、收件箱、AI Copilot 或新的 KyanetAccount 协议；这些
能力只能在 P0 门禁通过后以独立 Trellis 任务推进。

## 工作包总览

| 工作包 | 主要目标 | 主要边界 | 完成证据 |
|---|---|---|---|
| A. Node 24 与测试基线 | 让干净安装可加载 SQLite 原生模块并可重复验证 | `package.json`、锁文件、测试/冒烟脚本、发布文档 | ABI 137、完整测试、audit 和 API 冒烟记录 |
| B. 旧 Account 清理 | 从活动请求路径移除冻结联动，保留可回滚数据 | `app.js`、Account 模块、提交页、配置与旧测试 | 无 Account 依赖的匿名提交与路由缺失回归 |
| C. 隐私、代理与 WorkTask 边界 | 公开 DTO 最小化、来源校验收紧、安排支持清空 | `db.js`、`security.js`、`validation.js`、管理页 | DTO、spoof、assign/clear 契约测试 |
| D. 启动与外部集成可靠性 | 配置自检、MeowStatus fail-safe、备份恢复、通知可观测 | `config.js`、启动流程、状态/通知/备份模块 | preflight、恢复、外部失败/重试证据 |

工作包 A 先于其余工作包进入实现；B/C/D 可在同一代码任务中按下述顺序
逐步合并，但每个工作包必须有独立的回归和回滚点。

## 保留的系统边界

```text
Browser
  -> optional trusted reverse proxy
  -> Express middleware and route boundary
      -> validation / same-origin / admin session
      -> db.js (SQLite | MySQL | PostgreSQL)
      -> MeowStatus adapter (optional, read-only)
      -> notification outbox + SMTP/Webhook adapters (optional)
```

- 不在路由中直接调用 `better-sqlite3`、`mysql2` 或 `pg`，不引入 ORM。
- 所有成功响应继续使用 `{ ok: true, data }`，错误使用 `sendError` 的稳定
  错误码；启动错误只写结构化日志和配置键，不写密钥。
- 所有新列/表若确有必要，必须同时覆盖 SQLite、MySQL、PostgreSQL，使用
  幂等兼容迁移，且不得以重置数据库作为升级步骤。

## 数据流与契约

### 公共 highlights

1. `getHomeHighlights` 查询时只选择公开字段，或在 `db.js` 内立即经过专用
   `mapPublicHighlight` 投影。
2. `/api/public/highlights` 仅返回允许字段：`id`、`type`、`title`、`status`、
   WorkTask 的 `priority`/来源标记（如已有且确有展示用途）、`publicReply`
   和 `updatedAt`。
3. `content`、`contact`、`images`、`adminNote`、Account ID/快照、通知载荷
   和任何未列入契约的数据库列不得进入响应。查询层和响应测试都应阻止
   “先查整行再删除字段”的回归。

### 用户安全列表

P0 清理后不提供匿名历史查询。若实现阶段仍需保留兼容的 Account 路由以便
平滑下线，它只能使用独立安全 DTO 并明确标记为过渡路径；正常提交和工作台
代码不得依赖它。历史 Account 列表/会话路由最终返回稳定的 `NOT_FOUND` 或
移除，不得继续暴露完整 `mapFeedbackRow`/`mapWorktaskRow`。

### 提交路径

旧 Account 策略缓存和会话中间件从提交路径移除。反馈和 WorkTask 使用现有
输入校验、提交限流和数据库写入，默认按当前产品决策支持匿名提交；不提供
匿名历史查询，也不根据联系方式自动认领历史记录。新写入保留 Account
快照列的空值，以便未来独立迁移，不把第三方会话或 Token 写入记录。

### 代理与同源校验

- `TRUST_PROXY=0` 时，来源判断只使用直接连接可确认的协议/Host；客户端携带
  的 `X-Forwarded-Proto`、`X-Forwarded-Host` 不得改变判定。
- `TRUST_PROXY=n` 时，只在部署明确声明存在 n 个受信代理，并由 Express 的
  代理链计算出请求来源后使用转发值。测试至少覆盖直连、一个受信代理和
  直连伪造转发头三种情况。
- 任何不匹配仍返回 `403 CSRF_BLOCKED`；不通过放宽 headerless 选项来绕过
  生产边界。部署文档提醒应用应绑定回环地址或受控内网接口。

### WorkTask arrange

请求字段的语义按“是否出现”区分，而不是按真值区分：

| 字段 | 省略 | `null` 或空字符串 | 非空值 |
|---|---|---|---|
| `assignee` | 保持不变 | 清空负责人 | 设置负责人 |
| `scheduledAt` | 保持不变 | 清空计划时间 | 设置有效 ISO 时间 |
| `status` | 保持不变 | 不接受 | 设置允许的状态 |

请求至少出现一个可更新字段；只有清空字段的请求也是有效操作。验证器
返回字段存在性（或等价的显式更新掩码）给 `arrangeWorktask`，数据库层按
掩码写入 `NULL`/空值。仅当新增非空负责人或计划时间且调用者未给 status
时，才保留现有的自动转为 `scheduled` 行为；清空操作不隐式改变状态。

## 工作包 A：Node 24、依赖与测试基线

### 运行时和依赖

- 发布基线为 Node.js `24.x` LTS，文档同时记录实际 Node/npm 版本。
- `better-sqlite3` 从 11.x 升至 `^12.11.1`，在 Node 24 下执行干净的
  `npm ci --foreground-scripts`（npm 12 仅允许 package.json 中声明的安装脚本，
  必要时再 `npm rebuild`）并确认原生模块 ABI 137 可加载。
- Express 维持 4.x，升级至 `^4.22.2` 以取得修复后的 body-parser/qs 解析
  依赖；Nodemailer 升至 `^9.0.5` 以越过高危修复边界。升级必须同步
  `package-lock.json`，不能手工伪造完整锁文件。
- 升级后使用 canonical npm registry 重跑 `npm audit --omit=dev`；镜像的
  advisory 端点失败不能当作无漏洞。

### API 冒烟

以临时 DB 文件和临时端口启动子进程，顺序覆盖 health、匿名反馈/WorkTask
提交、管理员登录、管理员列表读取和进程关闭。测试必须在 `finally` 中
清理子进程、临时目录、定时器和测试数据，不能复用生产 `.env` 或数据库。

## 工作包 B：旧 Account 清理与数据保留

### 活动路径

- 从 `server/app.js` 删除旧 Account 跳转、回调、会话和提交 gating；删除
  `server/account-auth.js`、`server/account-session.js` 的活动引用，并移除
  `public/feedback`、`public/worktask` 的 Account 登录提示和请求。
- 移除旧 Account 配置解析和 `.env.example` 中的旧联动变量；不再为新功能
  读取这些变量。部署中遗留的变量不应被打印或作为新认证依据。
- 旧 Account 专用测试改为验证路由不再存在、匿名提交不依赖外部服务；不把
  旧 fake Account 服务保留为正常流程的测试依赖。

### Schema 与迁移

- 首轮只停用代码路径，不删除 `account_user_id`、邮箱/显示名快照列；新写入
  保持空值。`account_session` 表和兼容迁移若暂时保留，必须标记为“非活动、
  待后续迁移”，并在迁移前后清单中记录。
- 删除表/列属于后续独立任务，前置条件是脱敏备份、字段/行数盘点、临时恢复
  验证和可逆迁移。回滚优先恢复上一版代码与数据库，不在 P0 自动清除历史
  数据。
- `docs/plans/account-refactor.md` 作为未来边界唯一说明，包含 state/nonce、
  一次性回调、DTO 分离、匿名历史不自动认领和不传递第三方凭据等约束。

## 工作包 C：隐私、代理和 WorkTask

- 在 `db.js` 建立专用公共/用户投影，不复用管理员完整行映射；在 `app.js`
  保持错误封装和状态码不变。
- 在 `security.js` 集中实现受信代理来源判断；为 `TRUST_PROXY=0` 和受信
  代理分别构造测试请求，不修改管理员 Cookie 的独立权限边界。
- 在 `validation.js` 和 `db.js` 实现 arrange 的显式清空掩码；在
  `public/admin/admin.js` 增加清空操作或等价控件，提交后重新读取服务端行，
  确认未改变其他字段。

## 工作包 D：配置、MeowStatus、备份和通知

### 启动 preflight

`startServer` 在 `initializeDatabase()` 之前执行 `validateRuntimeConfig`：

- `DB_CLIENT` 必须为 `sqlite`、`mysql` 或 `postgres`；非 SQLite 必须有可解析
  的 `DATABASE_URL`，SQLite 必须有非空 `DB_PATH`。
- `PORT`、超时和限流值为合理正整数；`APP_BASE_URL` 和外部服务 URL 必须
  使用允许的 `http`/`https` 协议；`TRUST_PROXY` 为非负整数。
- SMTP/Webhook 启用时检查主机/端口、发件/收件或 URL/Provider 等必需键；
  错误消息只指出配置键和修复建议，不包含密码、签名或完整 URL 查询参数。
- preflight 失败时不监听端口、不初始化数据库，并以 `bootstrap.error`
  记录结构化错误。

### MeowStatus

- 增加显式 `MEOWSTATUS_ENABLED=false` 默认门；只有环境门开启且对应卡片
  设置启用时才调用外部 API。新数据库的卡片默认关闭，旧数据库的设置不
  被静默改写，但全局门关闭时仍不发起请求。
- `/api/public/meowstatus` 保持 `{ ok: true, data }` 非阻塞形状，增加或规范
  `state: disabled|unavailable|ok`（可保留短 `error`），使前端能区分关闭、
  不可达和成功；反馈/WorkTask 路由不等待或依赖该请求。
- 外部响应继续有超时、大小和字段规范化边界；公共页面只展示短错误。

### 备份与恢复

保留现有备份脚本，增加可重复的临时恢复检查：生成备份后计算校验和，恢复
到独立路径/实例，使用 `initializeDatabase()` 和关键表/行读取验证，再在
`finally` 清理临时目录。证据记录命令、版本、校验和、耗时、失败点和回滚
动作，不写入生产数据、凭据或完整日志。

### 通知可靠性

首选在现有数据库中增加一个窄化的 `notification_delivery` outbox（跨三种
驱动同构）而不是引入新队列服务。每行至少包含事件 ID、provider、目标标识、
状态、尝试次数、下次尝试时间、最后错误和创建/更新时间；凭据和完整联系
方式不进入日志。提交成功后创建待投递记录，后台 worker 以有界重试处理，
管理员可看到失败并触发重试。若实现阶段证实已有表可提供同等的有界、可审计
语义，可复用该表，但不得把无界 JSON 设置值冒充 outbox。

写入 outbox 不宣称外部已送达；数据库写入成功而投递失败时，业务响应仍成功，
失败状态必须可查询。若跨驱动原子写入无法在 P0 内安全实现，则保留一个
明确的“业务记录 → 手动重试”恢复命令，并把这一降级写入发布门禁，不能再
使用无记录的 fire-and-forget。

## 迁移、发布与回滚

1. 发布前保存 Git 提交、`package.json`/锁文件、配置键摘要和数据库备份。
2. 先在临时目录完成 Node 24 clean install、ABI 检查和 API 冒烟，再执行生产
   代码切换。
3. Schema 只做幂等新增/兼容操作；Account 历史列/表不删除。每个工作包的
   回归测试和文档证据通过后才能进入下一包。
4. 若原生模块、API、SMTP 或数据库兼容性失败，回滚代码与依赖锁文件成对
   恢复；若 schema 已新增且向后兼容，保留新增结构，必要时再用备份恢复到
   隔离实例核对。
5. 若出现数据风险，先保留脱敏日志和备份、停止新进程，再按部署手册恢复
   上一版本；不通过删除日志或重置生产数据库“修复”问题。

## 关键取舍

- 选择 Node 24 单一发布基线，避免同时为三个 ABI 承诺相同门禁；Node 20/22
  作为可选兼容检查。
- 保留 Express 4 和当前数据库抽象，依赖升级只覆盖已确认的安全/ABI 问题。
- 选择窄化 outbox 或可审计手动重试，不引入 Redis、消息队列或微服务。
- 先停用 Account 代码和入口、保留数据，避免在缺少恢复证据时做不可逆迁移。
