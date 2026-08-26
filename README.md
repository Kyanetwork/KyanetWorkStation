# KyanetWorkStation

KyanetWorkStation 是面向个人和小团队的轻量自托管工作中枢：把反馈、WorkTask、处理进展和服务状态放在一个低维护成本的入口中，并逐步增加可控的 AI 辅助。

当前实现仍以反馈和任务收集为核心。Workstation 首页、统一工作收件箱和 AI Copilot 属于已确认的后续路线，不应视为已经完成的功能。

## 当前能力

- 反馈与 WorkTask 提交、状态流转、分页筛选和 CSV 导出
- 管理员后台、主页处理进展、备注与对外回复
- SMTP/Webhook 通知及管理端测试入口
- MeowStatus/Minecraft 状态展示
- SQLite、MySQL、PostgreSQL 数据库驱动
- PM2 运行与 Nginx、IIS、Caddy 反向代理模板
- SQLite 和 RDBMS 备份脚本、结构化日志、基础限流和安全响应头
- 当前代码还保留旧 KyanetAccount 联动；该联动已冻结，计划在 P0 中移除，未来按独立设计重新接入

## 五分钟本地启动

要求 Node.js 20+，并使用与 Node 版本匹配的 npm。项目支持的 Node 版本和 `better-sqlite3` 原生依赖必须匹配；详见[运行时与发布门禁](docs/testing/release-checklist.md)。

```powershell
Copy-Item .env.example .env
npm install
# 编辑 .env，至少设置 ADMIN_USERNAME、ADMIN_PASSWORD、APP_BASE_URL
npm run init-admin
npm run start
```

默认访问地址：

- 入口页：`http://127.0.0.1:3000/`
- 反馈页：`http://127.0.0.1:3000/feedback/`
- WorkTask 页：`http://127.0.0.1:3000/worktask/`
- 管理页：`http://127.0.0.1:3000/admin/`

MeowStatus 是可选外部服务，但当前数据库初始化时默认开启 profile/Minecraft 状态卡片。首次运行前请在管理页配置可达地址，或在未运行 MeowStatus 时关闭对应卡片；不要把 `127.0.0.1:8080` 当作生产服务地址。显式启用/关闭策略仍属于 P0 加固。

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

- 产品目标保留匿名提交，但当前旧 Account 联动仍可能按 fail-closed 策略要求登录；该差异列入 P0 清理。匿名模式不提供历史查询。
- 当前没有原生图片上传，反馈中的图片以文本链接为主。
- 当前管理模型仍以单管理员为主，暂不承诺复杂 RBAC、多租户或组织架构。
- 统一 Workstation 首页、工作收件箱、Kanban、AI 和更多服务聚合均按路线图分阶段推进。
- KyanetAccount 旧联动代码处于维护冻结状态，不应继续增加依赖。

## 开发命令

```powershell
npm test
npm run init-admin
npm run backup-db:core
npm run backup-db:rdbms
npm run backup-db:win
```

`npm test`、备份恢复和真实部署的证据要求见[发布门禁](docs/testing/release-checklist.md)。

## 技术与许可证

- Node.js + Express + 原生静态 HTML/CSS/JavaScript
- SQLite（默认）或 MySQL/PostgreSQL
- MIT License，见 [LICENSE](LICENSE)
