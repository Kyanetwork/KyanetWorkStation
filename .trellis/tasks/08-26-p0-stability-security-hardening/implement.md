# P0 稳定性与安全加固实施计划

> 本文是实现阶段的有序清单。用户已批准规划摘要，任务已进入
> `in_progress`；本轮代码实现和回归已完成，下面的勾选状态记录实际证据。

## 完成定义

- Node.js 24.x LTS 是唯一必需发布运行时，`better-sqlite3` 在 ABI 137 下
  可加载，锁文件可由干净安装复现。
- 旧 KyanetAccount 不再出现在正常提交、前端页面或管理员工作流的活动
  请求路径中；历史列/表未经恢复证据不删除。
- 公共和用户投影通过 allow-list DTO 契约测试；直连伪造转发头不能通过
  管理来源校验；WorkTask 可显式清空负责人/计划时间。
- 启动 preflight、MeowStatus 关闭门与三态代码路径、临时备份恢复以及至少
  一个可观测可重试通知路径已有自动或可审计证据；D-007/R-004 的本地边界
  已由子任务补齐，真实代理/备份/通知证据仍是发布门禁。
- `npm test`、依赖 audit、API 冒烟、语法检查、`git diff --check` 和
  `task.py validate` 的结果已记录；未通过项有日期、原因和负责人。

## 0. 启动前检查（必须在 `task.py start` 之后执行）

- [x] 用户批准最新规划摘要；确认当前任务仍为
      `.trellis/tasks/08-26-p0-stability-security-hardening`。
- [x] 运行 `python ./.trellis/scripts/task.py start .trellis/tasks/08-26-p0-stability-security-hardening`，确认状态变为 `in_progress`。
- [x] 加载 `trellis-before-dev`，读取本任务的 PRD、设计、实施计划和
      backend/frontend 相关规范。
- [x] 保存 `git status --short`、当前分支、Node/npm 版本和现有测试基线；
      不覆盖用户已有改动。
- [x] 确认 `.trellis/.gitignore` 只忽略运行时状态和研究临时二进制/审计
      输出；Markdown 任务工件仍可被 Git 跟踪。

## 1. 工作包 A：Node 24、依赖与测试基线

### 1.1 记录和升级

**预期文件：** `package.json`、`package-lock.json`、
`docs/operations/deployment.md`、`docs/testing/release-checklist.md`。

- [x] 在 Node 24.x LTS 下记录 `node --version`、`npm --version`、
      `process.versions.modules` 和 `process.versions.napi`。
- [x] 将 `engines.node` 改为 `24.x`（等价的 `<25` 约束亦可），将
      `better-sqlite3` 设为 `^12.11.1`、Express 设为 `^4.22.2`、
      Nodemailer 设为 `^9.0.5`；使用 npm 重新生成锁文件，不手工拼接完整
      lock 条目。
- [x] 在临时、干净目录执行 `npm ci --foreground-scripts`；若 npm 无法取得预构建包，再在同一
      Node 24 环境执行 `npm rebuild` 并保存输出。禁止提交 `node_modules`。
- [x] 用最小脚本 `require("better-sqlite3")` 并创建临时数据库，确认加载
      成功、ABI 为 137、数据库可初始化和关闭。
- [x] 以 canonical registry 执行
      `npm audit --omit=dev --registry=https://registry.npmjs.org`；若仍有
      漏洞，记录具体路径、固定版本或经负责人批准的限时缓解，不以镜像
      advisory 端点失败作为“干净”。

### 1.2 API 冒烟和隔离

**预期文件：** `tests/api-smoke.test.js`（或等价的现有测试入口）、必要的
测试辅助模块、`docs/testing/release-checklist.md`。

- [x] 以 `fs.mkdtemp` 创建临时 DB 目录，以空闲端口启动 `server/app.js`
      子进程；测试环境显式关闭 SMTP/Webhook/MeowStatus 外部调用。
- [x] 按顺序请求 `GET /api/health`、匿名 `POST /api/feedback`、匿名
      `POST /api/worktask`、`POST /api/admin/login`、管理员反馈/WorkTask
      列表；断言状态码和 `{ ok, data/error }` 形状。
- [x] 在 `finally` 中关闭子进程、定时器和临时目录；子进程提前退出时
      包含有限的启动日志，不能把凭据写入断言或输出。
- [x] 保留 Node 20/22 为可选兼容矩阵，不把它们混入 Node 24 的发布门禁。

**检查点 A：** 原生模块可加载、API 冒烟通过后再进入 Account 清理；若失败，
只回滚 `package.json`/`package-lock.json` 成对变更并保留失败证据。

## 2. 工作包 B：移除冻结 Account 活动路径

### 2.1 后端与配置

**预期文件：** `server/app.js`、`server/account-auth.js`、
`server/account-session.js`、`server/config.js`、`server/db.js`、
`.env.example`、对应测试和 `docs/api/reference.md`。

- [x] 删除旧 Account 跳转、回调、会话 API、策略缓存和提交 gating 的活动
      引用；反馈/WorkTask 仅保留本地校验、限流和数据库写入。
- [x] 移除旧 Account 配置对象及示例变量；对部署环境遗留变量不做新认证
      依据，不在启动日志中回显其值。
- [x] 保留 `account_user_id`、邮箱/显示名快照列以及必要的兼容 schema
      定义，但将其标记为非活动；新匿名写入使用空值。`account_session`
      表若暂时保留，必须从活动查询中断开并记录后续清理条件。
- [x] 删除无引用的 Account 模块或将其移出运行时包；删除前执行全仓库引用
      搜索和备份/恢复检查，避免误删共享逻辑。
- [x] 将 Account 路由从 API 参考标为已移除/历史，不把未来协议写成当前接口。

### 2.2 前端和测试

**预期文件：** `public/feedback/index.html`、`public/feedback/main.js`、
`public/worktask/index.html`、`public/worktask/main.js`、
`tests/account-*.test.js` 及新的匿名提交测试。

- [x] 移除 Account 登录状态请求、跳转链接和提示文案，保留已有主题、表单
      字段和错误显示。
- [x] 重写测试使其验证：无外部 Account 服务仍可提交；旧 Account 路由不再
      提供业务数据；管理员 Cookie 与任何历史字段无关。
- [x] 不自动按邮箱、联系方式或标题认领历史匿名记录。

**检查点 B：** 在临时数据库上确认匿名反馈/WorkTask、管理员登录和主页读取
不依赖 Account；若发现需要保留兼容入口，入口必须是明确的 404/迁移提示，
不能恢复隐式联动。

## 3. 工作包 C：隐私、代理与 WorkTask 边界

### 3.1 DTO 和公开响应

**预期文件：** `server/db.js`、`server/app.js`、相关 API/安全测试。

- [x] 增加独立的公共 highlights 投影；查询或映射只允许 `id`、`type`、
      `title`、`status`、适用的 `priority`/来源、`publicReply`、`updatedAt`。
- [x] 为任何仍存在的用户安全列表提供独立 allow-list mapper；不得复用
      `mapFeedbackRow`/`mapWorktaskRow` 的管理员完整行。
- [x] 添加回归断言，明确 `content`、`contact`、`images`、`adminNote`、
      Account ID/快照、通知载荷和未知字段均不在响应中。
- [x] 保持 API envelope 和分页/错误码不变；数据库值继续全部参数化，三种
      驱动的 SQL/映射同步维护。

### 3.2 受信代理来源

**预期文件：** `server/security.js`、`server/app.js`、
`tests/security.test.js`、`docs/operations/security.md`。

- [x] 明确 `TRUST_PROXY=0` 的直连路径不采纳客户端转发头；受信代理模式
      只在显式 hop 配置下使用 Express 解析的代理链。
- [x] 测试直连正常来源、一个受信代理的正常来源和直连伪造
      `X-Forwarded-Proto/Host` 三种情况；伪造请求必须得到
      `403 CSRF_BLOCKED`。
- [x] 保留 JSON Content-Type、管理员会话和 headerless 调试开关的独立
      边界，避免用放宽来源检查来“修复”测试。

### 3.3 WorkTask arrange 清空语义

**预期文件：** `server/validation.js`、`server/db.js`、
`server/app.js`、`public/admin/admin.js`、`tests/validation.test.js` 及
WorkTask/API 测试。

- [x] 让验证器区分字段省略与显式 `null`/空字符串；空清除请求在出现字段
      时有效，完全没有可更新字段时仍返回 `INVALID_PAYLOAD`。
- [x] 数据库更新按显式更新掩码写入清空值；禁止以 truthy 判断丢弃清除动作。
- [x] 仅在新增非空负责人/计划时间且未给 status 时自动设为 `scheduled`；
      单独清空不改变状态或其他字段。
- [x] 管理页加入清空负责人/时间的可发现操作，提交后重新加载服务端记录，
      断言其他列保持不变。

**检查点 C：** 公共/用户 DTO、spoof 防护、assign→schedule→clear 全链路测试
通过后再进入运维改动。

## 4. 工作包 D：配置、MeowStatus、恢复和通知

### 4.1 启动配置 preflight

**预期文件：** `server/config.js`、`server/app.js`、`tests/config.test.js`、
`docs/operations/configuration.md`、`docs/operations/deployment.md`。

- [x] 添加无副作用的 `validateRuntimeConfig`（或等价函数），在
      `initializeDatabase()` 之前调用。
- [x] 校验 DB 客户端/连接串或 SQLite 路径、端口、`APP_BASE_URL`、
      `TRUST_PROXY`、外部 URL、超时、SMTP/Webhook 启用组合；消息只包含
      配置键、允许值和修复提示。
- [x] 为每个失败组合写纯函数测试，并确认 preflight 失败不会监听端口、
      创建数据库或打印密钥。
- [x] 更新 `.env.example`、配置参考和部署文档，明确 Node 24 与新
      `MEOWSTATUS_ENABLED` 策略。

### 4.2 MeowStatus fail-safe

**预期文件：** `server/config.js`、`server/db.js`、`server/app.js`、
`server/meowstatus.js`、`public/index/main.js`、相关测试和文档。

- [x] 增加 `MEOWSTATUS_ENABLED=false` 全局门；新数据库卡片默认关闭，旧
      设置不被静默覆写，但全局门关闭时不发起外部请求。
- [x] 统一 public 数据中的 `state: disabled|unavailable|ok` 和短错误信息；
      保持 `ok: true` 的非阻塞 envelope，核心提交路由不等待状态服务。
- [x] 测试关闭、超时/不可达和成功三种状态，包含响应大小/字段规范化边界。
      `tests/meowstatus.test.js` 已覆盖本地边界；真实上游契约仍需发布环境观察。

### 4.3 备份与恢复证据

**预期文件：** `scripts/backup-db.js`、`scripts/backup-db-rdbms.js`、
可能的新恢复检查脚本/测试、`docs/operations/backup-restore.md`、
`docs/testing/release-checklist.md`。

- [x] 保持现有备份脚本的输出和保留策略；必要时只增加校验和/读取检查辅助
      函数，不把备份内容纳入仓库。
- [x] 在临时 SQLite（以及可用的 RDBMS 测试实例）生成备份、计算 checksum、
      恢复到隔离路径、调用初始化并读取反馈/WorkTask/管理员/设置关键表。
- [x] `finally` 清理临时目录和测试实例；记录 Node/npm、数据库类型、耗时、
      checksum、失败点和回滚动作，不记录数据库 URL 或用户数据。
      自动化 SQLite 证据已覆盖；真实脱敏备份恢复仍是 V-002 发布前门禁。

### 4.4 通知 outbox 或可审计手动重试

**预期文件：** `server/db.js`、`server/app.js`、`server/notify.js`、
`server/webhook.js`、必要的新迁移/worker/管理员路由、通知测试和
`docs/operations/observability.md`。

- [x] 先检查现有设置/表是否能提供有界、可审计的投递记录；不能时增加窄化
      `notification_delivery` 表，并同步 SQLite/MySQL/PostgreSQL schema 与
      幂等兼容迁移。
- [x] 记录事件 ID、provider、目标标识、状态、尝试次数、下次尝试、最后错误
      和时间戳；禁止记录密码、签名、完整联系信息或授权 URL。
- [x] 提交成功后创建待投递记录，worker 进行有界重试，管理员能看到失败并
      触发重试。外部送达失败不能回滚已创建业务记录。
- [x] 若跨驱动原子 outbox 在本任务中无法安全完成，则实现从业务记录到
      provider 的受控手动重试命令，并在发布门禁明确列为降级边界；不得保留
      无持久状态的 fire-and-forget。子任务已增加私有 JSONL handoff、管理员
      查询/重试和不可写时的人工补偿记录。
- [x] 用 stub SMTP/Webhook 测试成功、失败、部分失败、定向重试和敏感信息
      脱敏；至少一条 provider 具有可重复证据。
      真实 provider 和进程重启演练仍归入 V-003/发布前验证。

**检查点 D：** preflight、MeowStatus 三态、恢复演练和通知可观测性通过后，
才进入最终集成检查。

## 5. 最终验证与文档同步

### 5.1 自动验证

- [x] 对所有修改的 `.js` 运行 `node --check`，对新增 node:test 文件同样
      检查。
- [x] 运行聚焦测试：`node --test tests/config.test.js tests/security.test.js tests/validation.test.js` 及新增 DTO、API、备份、通知测试。
- [x] 在 Node 24 clean install 环境运行 `npm test`；若失败，保存退出码、
      首个根因和环境信息，不写“通过”。
- [x] 运行 `npm audit --omit=dev --registry=https://registry.npmjs.org`、
      `git diff --check` 和 `python ./.trellis/scripts/task.py validate .trellis/tasks/08-26-p0-stability-security-hardening`。
- [x] 用 `rg` 做占位符、敏感模式和本地链接审计；研究临时 tarball、audit
      JSON、数据库、日志和备份仍被忽略且未被 Git 跟踪。

### 5.2 文档与证据

- [x] 同步 `docs/api/reference.md`、`docs/architecture/current.md`、
      `docs/architecture/integration-boundaries.md`、配置/部署/安全/观测、
      发布门禁、路线图和缺陷表，区分已实现、验证中、计划和暂缓。
- [ ] 在发布门禁记录实际 Node/npm、数据库类型、Git 提交、测试命令/结果、
      真实恢复 checksum 和通知链路；不写真实主机、凭据、用户数据或完整
      外部响应。自动化恢复测试结果已在 `docs/testing/release-checklist.md`
      中记录，不能替代 V-002 的真实脱敏备份演练。
- [x] 复查 Account 未来边界仍要求 state/nonce、一次性回调、DTO 分离、历史
      匿名不自动认领和凭据隔离；不把未来协议实现混入 P0。

## 6. 回滚点与停止条件

| 回滚点 | 触发条件 | 动作 |
|---|---|---|
| A0 依赖升级前 | Node 24 无法加载原生模块或锁文件不可复现 | 成对恢复 `package.json`/`package-lock.json`，保留日志 |
| B0 Account 清理前 | 备份/字段盘点/匿名提交验证失败 | 停止删除代码，恢复入口并重新设计；不删历史列/表 |
| C0 边界改动前 | DTO、代理或 arrange 回归失败 | 只回滚对应模块和测试，不放宽安全断言 |
| D0 schema/通知前 | 迁移不可逆、恢复失败或投递状态不可观测 | 恢复备份到隔离实例，撤销新 worker/路由；不清理生产证据 |
| R0 发布前 | health/API/日志/磁盘/代理异常 | 停止新进程，恢复上一代码/依赖对并按备份记录回滚 |

任何需要删除生产数据、修改非工作区文件或引入新架构的情况都暂停并重新
取得用户批准；本任务不以“测试变绿”为理由扩大范围。
