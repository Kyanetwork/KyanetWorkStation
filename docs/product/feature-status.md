# 功能状态矩阵

状态含义：

- **已实现**：代码中已有路径，仍需按发布门禁持续验证。
- **维护冻结**：当前代码存在，但不再新增能力；后续会移除或重构。
- **P0 加固**：已有能力或边界存在风险，必须先完成修复/验证。
- **P1 计划**：P0 通过后建设的工作台能力。
- **P2 计划**：需要更长周期或新产品决策的扩展。
- **暂缓**：当前明确不进入主线。

| 能力 | 状态 | 当前证据/边界 |
|---|---|---|
| 反馈提交 | 已实现 | `server/app.js:340-353`、`public/feedback/` |
| WorkTask 提交 | 已实现 | `server/app.js:355-367`、`public/worktask/` |
| 管理员登录与会话 | 已实现 | `server/app.js:370-398`、`server/auth.js` |
| 管理列表、筛选、分页、状态、备注、CSV | 已实现 | `server/app.js:527-681`、`public/admin/admin.js` |
| 主页处理进展 | 已实现/P0 加固 | `server/app.js:295-301`、`server/db.js:1640-1663`；公开查询已使用最小投影，仍需发布门禁验证 |
| SMTP/Webhook 通知 | 已实现/P0 加固 | `server/notify.js`、`server/webhook.js`、`server/db.js:1194-1333`、`server/notification-handoff.js`；outbox 有限重试和入队失败 handoff 已覆盖，真实 provider 仍需验证 |
| MeowStatus/Minecraft 状态 | 已实现/P0 加固 | `server/app.js:303-337`、`server/meowstatus.js`；`MEOWSTATUS_ENABLED=false` 默认关闭，响应/MIME/字段/favicon 有界，状态接口区分 disabled/unavailable/ok |
| SQLite/MySQL/PostgreSQL | 已实现/P0 加固 | `server/db.js:1-14,158-429`；需匹配 Node 原生模块 ABI |
| 备份脚本 | 已实现/P0 加固 | `scripts/backup-db*`、`scripts/verify-sqlite-backup.js`；恢复演练仍需真实证据 |
| 旧 KyanetAccount 联动 | 已移除/数据保留 | 活动路由和提交 gating 已移除；历史 schema/数据待独立迁移 |
| 统一 Workstation 首页 | P1 计划 | 统一摘要、收件箱和快捷入口 |
| 我的提交/任务安全视图 | P1 计划 | 只返回安全 DTO，不能包含内部备注 |
| 服务状态卡片与适配器边界 | P1 计划 | 先复用 MeowStatus，不建设通用插件平台 |
| 管理员 AI Copilot | P1 计划 | 摘要、分类、优先级、相似条目、回复草稿 |
| Kanban、子任务、里程碑 | P2 计划 | 依赖 P1 工作收件箱稳定 |
| 用户侧/运维侧 AI | P2 计划 | 依赖 Provider、脱敏和权限边界 |
| 新 KyanetAccount 联动 | P2/独立计划 | 未来按新协议设计，不自动认领历史匿名记录 |
| 原生文件上传、实时聊天、多租户、复杂 RBAC | 暂缓 | 当前不满足规模和维护成本目标 |
