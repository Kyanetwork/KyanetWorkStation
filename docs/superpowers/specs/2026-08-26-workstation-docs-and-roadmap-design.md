# KyanetWorkStation 文档与路线图重构设计

状态：已完成需求确认，等待书面工件审阅后进入文档落盘。

## 目标

将 KyanetWorkStation 从历史迁移文档和过时 `PLAN.md` 中解耦，建立按受众和职责拆分的公开文档体系，并以 Trellis 任务承载可执行路线图。产品先演进为个人/小团队工作中枢，未来按需聚合更多服务；不为此任务引入新的业务技术栈。

## 已确认的产品决策

- 一级定位：个人/小团队工作中枢，未来可聚合更多个人项目服务。
- 当前用户：本人和约 20 人小团队；当前匿名提交，未来 Account 重构完成后再切换账号绑定。
- AI 路径：管理员 Copilot → 用户侧/运维知识侧，默认关闭、脱敏、人工确认。
- 数据架构：保留反馈和 WorkTask 表，通过统一读取层和安全 DTO 聚合。
- 工作方式：轻量工作收件箱，未来再演进 Kanban/项目管理。
- MeowStatus：作为第一个服务卡片适配器，不提前建设插件平台。
- KyanetAccount：移除旧联动，未来按独立新设计重新接入；历史匿名记录不自动认领。
- P0 优先：先完成隐私、安全、运行时、测试、备份、通知和发布可靠性基线。

## 文档结构

```text
README.md
docs/
├─ product/{vision-scope,feature-status}.md
├─ architecture/{current,integration-boundaries}.md
├─ api/reference.md
├─ operations/{configuration,deployment,backup-restore,security,observability}.md
├─ testing/release-checklist.md
├─ plans/{roadmap,known-defects,ai-assistant,account-refactor}.md
└─ archive/{cloudbase-migration,agent-notes}/
```

README 只做入口；`docs/` 中每类信息只有一个权威文件；`.trellis/tasks/` 记录任务工件和执行状态；历史资料只归档，不作为当前架构依据。真实部署、凭据、生产数据和内部拓扑如需记录，放入不跟踪的 `docs/internal/`。

## 路线图

P0 清理旧 Account 联动并修复数据投影、配置/代理/输入边界、Node/SQLite ABI、依赖审计、启动自检、测试隔离、备份恢复、通知可靠性和发布门禁。P1 建立统一首页、收件箱、我的工作区和服务状态卡片，再实现管理员 AI Copilot。P2 增加 Kanban/项目管理、用户侧 AI、运维/知识 AI 和新的 Account 联动。

## 迁移与验证

本轮只移动/新增 Markdown、归档历史文件、更新 `.gitignore` 和 Trellis 工件，不修改业务代码。归档前检查路径和 Git 状态；文档完成后做占位符、链接、敏感信息、`git diff --check`、Trellis 校验和一次当前 `npm test` 基线记录。若测试仍受 ABI 影响，必须明确记为未通过/环境阻塞。
