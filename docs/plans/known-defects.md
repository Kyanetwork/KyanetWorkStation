# 已知缺陷与验证缺口

状态：已修复表示本次 P0 已有代码/回归覆盖；P1/P2 和验证缺口仍需后续任务或部署环境证据。

## 确认缺陷

| ID | 严重性 | 现象与影响 | 证据 | 计划验证 |
|---|---|---|---|---|
| D-001 | 已修复 | 公开主页 highlights 不再选择或返回 content 等内部字段 | `server/db.js:1640-1663`、`server/app.js:295-301` | 公共响应断言不含 content/contact/adminNote/账号快照 |
| D-002 | 已修复/历史路由移除 | 旧 Account 列表已从活动路由移除；历史 mapper 仅作迁移保留，不再作为活动响应 | `server/app.js:322-355`、`server/db.js:1422-1550` | 路由 404 与匿名 API 冒烟 |
| D-003 | 已缓解 | 旧 Account 回调和会话入口已移除；未来新协议仍需 state/nonce | `server/app.js:322-355` | 路由缺失回归；未来新协议做 state 重放测试 |
| D-004 | P0 未完成 | `TRUST_PROXY>0` 时仍直接采纳首个转发头；若应用端口被直连暴露，客户端可伪造 Host/Proto 参与同源判断 | `server/security.js:14-67` | 增加实际代理边界（受信地址/CIDR 或受控回环约束），并覆盖直连伪造、正确代理和直连正常来源 |
| D-005 | 已修复 | Node 24 与 better-sqlite3 ABI 已匹配 | `package.json:18-24`、`package-lock.json` | ABI 137 加载、干净安装和 npm test |
| D-006 | 已修复 | Express/body-parser/qs/Nodemailer 已升级，canonical audit 为 0 | `package.json:25-31`、`package-lock.json` | `npm audit --omit=dev --registry=https://registry.npmjs.org` |
| D-007 | 已修复/待实链路验证 | MeowStatus Dashboard 现在限制 JSON MIME/响应体/字段/挂件数量，favicon 仅接受有界 raster data URL；异常仍只影响状态卡片 | `server/meowstatus.js`、`public/index/main.js`、`tests/meowstatus.test.js` | 本地边界回归已覆盖；发布环境继续观察上游契约 |
| D-008 | 已实现/待实链路验证 | 通知改为数据库 outbox、有限重试和管理员重试；真实 provider 仍需部署验证 | `server/app.js:161-255,508-524`、`server/db.js:1194-1333` | 持久化投递、失败状态和重启后重试测试 |
| D-009 | 已修复 | WorkTask arrange 支持显式清空负责人/计划时间 | `server/validation.js:293-338`、`server/db.js:1584-1626` | clear/unassign 语义测试 |

## 高概率风险

| ID | 严重性 | 风险 | 证据/原因 | 计划 |
|---|---|---|---|---|
| R-001 | 已修复 | 配置 URL、端口和外部服务组合在启动前校验 | `server/config.js:73-188`、`server/app.js:709-717` | preflight 失败不监听/不初始化数据库 |
| R-002 | P1 | 管理端浏览器分页导出大数据会增加内存和等待时间，且缺少操作审计 | `public/admin/admin.js:385-410,674-700` | 服务端流式导出、上限和审计 |
| R-003 | P1 | 单管理员模型限制协作和追责 | `server/auth.js`、管理员路由 | 未来按规模评估 RBAC，不在当前 P0 扩张 |
| R-004 | 已修复/待实链路验证 | outbox 入队异常写入私有 JSONL handoff，可由管理员查询并有限次人工重试；journal 不可写时仍需人工补偿 | `server/notification-handoff.js`、`server/app.js`、`tests/notification-handoff.test.js` | 入队异常、重启读取、脱敏和重试回归；发布环境验证文件权限与备份 |
| R-005 | 已修复 | 人工重试接口只允许 `failed/retrying` 状态，避免重置已 `delivered` 记录造成重复通知 | `server/db.js:1325-1333`、`tests/notification-outbox.test.js` | 已有 delivered 重试返回 0 的回归断言 |

## 验证缺口与文档欠账

| ID | 状态/优先级 | 缺口 | 处理方式 |
|---|---|---|---|
| V-001 | 已解决 | 没有稳定的 health → 提交 → 登录 → 列表 API 冒烟 | `tests/account-submission.test.js` 已提供临时 DB/端口/子进程清理的可重复冒烟 |
| V-002 | P0 发布前 | 已有可重复的隔离 SQLite 备份、checksum、解压和关键表读取测试；尚无真实生产备份演练记录 | `tests/backup-sqlite.test.js` 自动覆盖；发布前仍需使用脱敏备份在独立路径演练并保存证据 |
| V-003 | P0 发布前 | 已有 Webhook stub 的成功/失败/部分失败与 outbox 重试覆盖；尚无真实 SMTP/Webhook 网络链路证据 | `tests/webhook.test.js`、`tests/notification-outbox.test.js`；部署环境至少验证一条并记录失败和重试 |
| V-004 | P1 | 没有真实浏览器 UI 回归 | P1 首页/收件箱实现时加入浏览器验收 |
| V-005 | P1 | MySQL/PostgreSQL 只有脚本参数测试，缺少真实集成 | 选择性加入 CI/预发布矩阵 |
| V-006 | 已解决 | README/旧文档遗漏 MeowStatus 路由和配置 | 已补齐 README、API、配置和状态说明；后续改动继续以对应权威文档同步 |
