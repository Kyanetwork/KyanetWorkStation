# 发布环境验证与剩余 P0 加固实施计划

> 本计划只在用户批准本子任务最终规划摘要并执行 `task.py start` 后进入实现。
> 真实部署步骤需要操作者提供实际参数；没有参数时只完善模板和自动化检查，
> 不猜测或修改生产环境。

## 完成定义

- D-007 的 dashboard 响应体、MIME、字段、widget 数量、favicon 格式/大小和
  超时边界有实现与回归测试；关闭/不可达/成功三态继续不阻塞核心页面。
- R-004 的 outbox 入队异常写入私有 JSONL handoff，管理员可查询并对未解决事件
  触发一次幂等人工重试；journal 不含业务正文、联系方式或凭据。
- SQLite 真实/脱敏备份可用显式脚本在隔离临时目录完成 SHA-256、integrity/schema/
  关键表读取和清理，RDBMS 仍有不含秘密的人工命令模板。
- 发布证据模板完整覆盖 D-004、V-002、V-003、观测和回滚，并把无法执行的门禁
  记录为责任人/前置条件/阻塞原因。
- 自动检查、任务校验和文档链接通过；真实环境证据未完成前不归档父任务。

## 0. 启动前检查（进入 `in_progress` 后）

- [x] 运行 `python ./.trellis/scripts/task.py start .trellis/tasks/08-27-release-environment-validation`。
- [x] 加载 `trellis-before-dev`，读取本任务 PRD/设计和 backend/frontend 规范。
- [x] 保存当前分支、Git 状态、Node/npm/ABI 和父任务提交；确认没有未授权的部署参数或敏感文件。
- [x] 复核 `docs/internal/`、`data/`、`backups/`、日志和 handoff journal 的忽略/权限边界。

## 1. 工作包 A：MeowStatus D-007

**预期文件：** `server/meowstatus.js`、`server/validation.js`、`public/index/main.js`、
`tests/meowstatus.test.js`、必要的 API 冒烟和 `docs/operations/observability.md`。

- [x] 提取 bounded response reader：先检查 Content-Length，再按字节读取并在
      512 KiB 上限处失败；确保 AbortController/reader 在 `finally` 清理。
- [x] 校验成功响应的 JSON MIME，拒绝 HTML/二进制/解析失败；错误仅保留短消息。
- [x] 为 profile/widget/payload 建立字符串、数组、数值和 config allow-list，
      限制 widget 数量和所有公共输出长度。
- [x] 只接受受限 raster base64 favicon，拒绝 SVG/外部 URL/非法或超限数据；
      前端保留转义并增加轻量格式/长度二次防护。
- [x] 测试有效 JSON、错误 MIME、Content-Length 超限、流式超限、非法 JSON、
      favicon 各类边界和不可达/超时错误；确认页面仍返回 unavailable 而非 500。

**检查点 A：** `node --test tests/meowstatus.test.js tests/config.test.js` 通过，
且原有 API 冒烟仍能在 `MEOWSTATUS_ENABLED=false` 下完成。

## 2. 工作包 B：R-004 handoff

**预期文件：** `server/notification-handoff.js`、`server/app.js`、
`server/validation.js`、`tests/notification-handoff.test.js`、`tests/notification-outbox.test.js`、
`.gitignore`、`docs/operations/observability.md`、`docs/operations/backup-restore.md`。

- [x] 实现安全 journal 路径、固定字段 schema、单行/记录上限、串行 append、
      状态折叠和临时/损坏行处理；创建目录/文件时使用最小权限。
- [x] 在 `queueNotifications` catch 中生成不含敏感信息的 handoff 记录；正常
      enqueue 和 provider 投递路径保持现有行为，业务响应不等待外部网络。
- [x] 增加管理员 GET/POST 路由，沿用管理员 session、同源和 JSON Content-Type；
      只允许 pending/retrying/failed 重试，resolved 不可重复重放。
- [x] 测试 enqueue 异常、journal 持久化/重启读取、状态折叠、脱敏、重试成功/失败、
      幂等和文件不可写降级日志；验证不把密码、URL、正文写入文件或响应。
- [x] 将 handoff journal 纳入私有数据备份/恢复说明，增加 `data/*.jsonl` 等忽略
      规则，明确文件不可写时的停止发布和人工补偿边界。

**检查点 B：** `node --test tests/notification-handoff.test.js tests/notification-outbox.test.js`
通过，管理员查询/重试错误码和 envelope 稳定。

## 3. 工作包 C：SQLite V-002 工具

**预期文件：** `scripts/verify-sqlite-backup.js`、`package.json`、
`tests/backup-sqlite.test.js`、`docs/operations/backup-restore.md`、
`docs/testing/release-checklist.md`。

- [x] 脚本只接受显式 `.db`/`.db.gz` 文件，计算 SHA-256，复制/解压到 OS 临时目录，
      只读打开并执行 `PRAGMA integrity_check`、表存在和行数检查。
- [x] 输出 JSON 摘要（basename、hash、elapsed、table booleans/counts），不输出完整
      路径、行内容、数据库 URL 或凭据；`finally` 关闭连接并清理临时目录。
- [x] 为正常、损坏 gzip、缺失表、integrity 失败和未知扩展名编写测试；
      不覆盖生产数据库。
- [x] RDBMS 只更新人工恢复模板，列出 `mysqldump`/`pg_dump` 和供应商隔离恢复
      的证据字段，不在 CI 中连接真实数据库。

**检查点 C：** 本地测试可用合成备份通过；模板明确这不能替代 V-002 真实脱敏演练。

## 4. 工作包 D：发布证据与运维文档

**预期文件：** `docs/operations/release-evidence-template.md`、
`docs/operations/deployment.md`、`docs/operations/security.md`、
`docs/operations/observability.md`、`docs/operations/backup-restore.md`、
`docs/testing/release-checklist.md`、`docs/plans/known-defects.md`、
`docs/plans/roadmap.md`。

- [x] 编写占位符模板：版本/运行时、配置键摘要、代理 hop/来源、TLS、API smoke、
      备份 hash/恢复、通知成功/失败/重启、观测和回滚。
- [x] 为 Nginx/IIS/Caddy 分别列出 `nginx -t`、HTTP→HTTPS、证书链、Host/Proto、
      监听端口和直连伪造验证命令；不提交示例域名替换后的真实值。
- [x] 明确真实证据存放在忽略的 `docs/internal/` 或部署系统；缺失门禁记录责任人、
      前置条件和阻塞原因。
- [x] 更新缺陷/路线图状态：D-007、R-004 在本地实现完成后标记对应验证状态；
      D-004/V-002/V-003 只有真实证据后才能标记完成。

## 5. 最终质量检查

- [x] `node --check` 覆盖所有修改/新增 JavaScript。
- [x] `npm test` 全部通过。
- [x] `npm audit --omit=dev --registry=https://registry.npmjs.org` 通过。
- [x] `git diff --check` 通过。
- [x] `python ./.trellis/scripts/task.py validate .trellis/tasks/08-27-release-environment-validation` 通过。
- [x] 运行安全审计：`rg` 检查真实域名、凭据、token、Webhook URL、用户数据、
      `.db`/`.gz`/`.jsonl` 临时文件未进入提交；审阅跨层 DTO、错误和日志字段。
- [x] 使用真实部署参数前再次取得用户确认；未提供参数时将 D-004 及目标特定的
      V-002/V-003 保留为阻塞/待执行，不宣称发布完成。

## 6. 本轮验证补充

- [x] 发现并修复旧版 SQLite 缺少 `account_*` 列时的索引创建顺序缺陷，在
  `tests/backup-sqlite.test.js` 增加回归，并同步三套数据库 schema 的索引责任。
- [x] 兼容 DDL 在并发重复对象错误后会复查列/索引再决定是否抛出；旧 schema 回归
  验证既有数据、空默认值、索引目标列和重复初始化幂等性。
- [x] 使用 `.env` 指向的本机 SQLite 生成脱敏 `.db.gz`，完成 checksum、完整性、
  关键表、隔离应用启动和临时目录清理证据；发布目标不同仍需重演 V-002。
- [x] 使用 `.env` 中真实 SMTP/Feishu provider 完成成功消息；使用本地不可达
  Webhook 目标完成失败、3 次有限重试、重启恢复和管理员人工 retry 证据。
- [x] 云服务器已提供 Node 24 依赖安装、`better-sqlite3` 加载、回环监听、宝塔 Nginx
  配置检查、HTTP→HTTPS 跳转和 HTTPS health 结果；证据摘要写入被忽略的
  `docs/internal/release-2026-08-27.md`。
- [ ] D-004 仍需 PM2 托管/开机恢复、证书链与 Host/Proto 观察、公网 IP:3000 阻断及
  直连伪造转发头结果；本机回环或 header stub 不计入证据。

## 回滚点与停止条件

| 回滚点 | 触发条件 | 动作 |
|---|---|---|
| A0 MeowStatus | 上游合法响应被误判或核心页面受阻 | 恢复 adapter/前端边界改动，保留失败 fixture |
| B0 Handoff | journal 泄露、并发损坏或重试重复发送 | 停止路由/worker，保留 journal，回滚新增模块和路由 |
| C0 Restore tool | 工具写入生产或清理失败 | 立即停止，删除仅位于临时目录的副本并核对备份 |
| D0 Deployment | 代理/TLS/API/通知门禁失败 | 停止切换，恢复上一版本代码/配置/数据库，不改 DNS/证书 |

任何需要删除生产数据、修改工作区外文件、读取未授权凭据或引入新基础设施
的情况都暂停并重新取得用户批准。
