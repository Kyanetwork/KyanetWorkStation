# KyanetWorkStation

KyanetWorkStation 是面向个人和小团队的轻量自托管工作中枢：把反馈、WorkTask、处理进展和服务状态放在一个低维护成本的入口中，并逐步增加可控的 AI 辅助。

当前实现已包含公开 Workstation 入口、管理员工作收件箱、MeowStatus 服务状态卡片和默认关闭的管理员 AI Copilot；更深的个人工作区、项目管理和账号联动仍按路线图推进。

## 当前能力

- 反馈与 WorkTask 提交、状态流转、分页筛选和 CSV 导出
- 管理员后台、主页处理进展、备注与对外回复
- 统一 Workstation 公开入口、管理员工作收件箱和 MeowStatus 服务状态卡片
- 管理员 AI Copilot：多 Provider profile 单 active 热切换、脱敏建议和人工确认（默认关闭）
- SMTP/Webhook 通知及管理端测试入口；outbox 入队异常可通过私有 handoff 查询和人工补偿
- MeowStatus/Minecraft 状态展示（外部响应、字段和 favicon 有界）
- SQLite、MySQL、PostgreSQL 数据库驱动
- PM2 运行与 Nginx、IIS、Caddy 反向代理模板
- SQLite 和 RDBMS 备份脚本、结构化日志、基础限流和安全响应头
- KyanetAccount 旧联动已从活动请求路径移除；历史 schema/数据暂保留，未来按独立设计重新接入

## 五分钟本地启动

要求 Node.js 24.x LTS，并使用与 Node 版本匹配的 npm。`better-sqlite3` 原生依赖必须与 ABI 匹配；详见[运行时与发布门禁](docs/testing/release-checklist.md)。

```powershell
Copy-Item .env.example .env
npm ci --foreground-scripts
# 编辑 .env，至少设置 ADMIN_USERNAME、ADMIN_PASSWORD、APP_BASE_URL
npm run init-admin
npm run start
```

默认访问地址：

- 入口页：`http://127.0.0.1:3000/`
- 反馈页：`http://127.0.0.1:3000/feedback/`
- WorkTask 页：`http://127.0.0.1:3000/worktask/`
- 管理页：`http://127.0.0.1:3000/admin/`

MeowStatus 是可选外部服务，默认由 `MEOWSTATUS_ENABLED=false` 关闭；需要使用时再配置地址并开启全局门及对应卡片。不要把 `127.0.0.1:8080` 当作生产服务地址。

## 文档导航

### 产品与架构

- [产品定位与范围](docs/product/vision-scope.md)
- [功能状态矩阵](docs/product/feature-status.md)
- [当前架构与数据流](docs/architecture/current.md)
- [集成边界](docs/architecture/integration-boundaries.md)

### 接口与运维

- [API 参考](docs/api/reference.md)
- [配置参考](docs/operations/configuration.md)
- [部署手册](docs/operations/deployment.md)
- [备份与恢复](docs/operations/backup-restore.md)
- [发布验证证据模板](docs/operations/release-evidence-template.md)
- [安全基线](docs/operations/security.md)
- [日志与观测](docs/operations/observability.md)
- [测试与发布门禁](docs/testing/release-checklist.md)

### 规划

- [路线图](docs/plans/roadmap.md)
- [已知缺陷与验证缺口](docs/plans/known-defects.md)
- [AI 辅助计划](docs/plans/ai-assistant.md)
- [KyanetAccount 重构衔接](docs/plans/account-refactor.md)

历史 CloudBase/迁移材料和旧执行笔记位于 [`docs/archive/`](docs/archive/)，仅供追溯，不代表当前架构或计划。

## 当前限制

- 当前反馈和 WorkTask 支持匿名提交；匿名模式不提供历史查询，未来 Account 重构后再评估账号绑定。
- 当前没有原生图片上传，反馈中的图片以文本链接为主。
- 当前管理模型仍以单管理员为主，暂不承诺复杂 RBAC、多租户或组织架构。
- 个人提交/任务历史视图、Kanban、更多服务聚合和用户侧/运维侧 AI 仍按路线图分阶段推进。
- KyanetAccount 旧 schema/会话遗留仅用于迁移保留，不应成为新功能依赖。

## 开发命令

```powershell
npm test
npm run init-admin
npm run backup-db:core
npm run backup-db:rdbms
npm run backup-db:win
npm run verify-backup:sqlite -- --backup <PRIVATE_BACKUP_PATH>
```

`npm test`、备份恢复和真实部署的证据要求见[发布门禁](docs/testing/release-checklist.md)。

## 技术与许可证

- Node.js + Express + 原生静态 HTML/CSS/JavaScript
- SQLite（默认）或 MySQL/PostgreSQL
- MIT License，见 [LICENSE](LICENSE)
