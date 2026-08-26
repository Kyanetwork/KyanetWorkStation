# Workstation Documentation And Roadmap Design

## Objective

把当前项目知识拆成稳定的公开文档层、历史归档层和 Trellis 执行层。文档只描述已验证的当前行为与已确认的产品决策；路线图明确未来工作，不把计划伪装成已实现能力。

## Information architecture

```text
README.md
docs/
├─ product/
│  ├─ vision-scope.md
│  └─ feature-status.md
├─ architecture/
│  ├─ current.md
│  └─ integration-boundaries.md
├─ api/
│  └─ reference.md
├─ operations/
│  ├─ configuration.md
│  ├─ deployment.md
│  ├─ backup-restore.md
│  ├─ security.md
│  └─ observability.md
├─ testing/
│  └─ release-checklist.md
├─ plans/
│  ├─ roadmap.md
│  ├─ known-defects.md
│  ├─ ai-assistant.md
│  └─ account-refactor.md
└─ archive/
   ├─ cloudbase-migration/
   └─ agent-notes/
```

`docs/internal/` 不是本次公开文档树的必需目录；只有出现真实部署或内部运行材料时才创建，并加入 `.gitignore`。

## Source-of-truth rules

`README.md` 只做入口；产品范围以 `docs/product/vision-scope.md` 为准；功能完成度以 `feature-status.md` 为准；当前架构/API/运维分别由对应目录负责；缺陷和路线图只在 `docs/plans/` 维护；`.trellis/tasks/` 记录可执行任务及其证据。历史归档不得覆盖当前结论。

## Current product model

Workstation 是个人和小团队的轻量工作中枢。反馈和 WorkTask 保持独立业务表，通过统一读取层和安全 DTO 进入工作台；MeowStatus 是第一个服务卡片适配器；匿名提交在 Account 重构前保留，但不提供匿名历史查询；未来账号接入不自动认领历史匿名记录。

## Roadmap model

### P0: reliability and boundaries

先完成旧 Account 联动清理、公开/私有数据最小化、代理和输入边界、Node/SQLite ABI、依赖审计、启动自检、测试隔离、备份恢复、通知可靠性和发布门禁。

### P1: usable workstation

在 P0 门槛通过后，增加统一首页和工作收件箱、我的工作区、MeowStatus 服务卡片与快捷入口，再做管理员 AI Copilot。

### P2: expansion

增加 Kanban/子任务/里程碑等项目管理能力，随后再做用户侧 AI、运维/知识 AI 和新的 Account 联动。

## AI boundary

AI 采用轻量 Provider Adapter，默认关闭，密钥只从进程环境读取。输入在发送前脱敏，输出只作为建议；状态更新、删除、通知发送和其他外部副作用必须由人工确认。首个可验收单元是管理员对摘要、分类、优先级、相似条目和回复草稿的建议。

## Migration and rollback

本任务只移动/新增文档和归档历史资料，不改业务 schema。归档前先确认文件路径和 Git 状态；旧 `PLAN.md` 的内容先由新 `docs/plans/roadmap.md` 和相关文档覆盖，再删除或移出根目录。任何内部资料保持未跟踪。未来 P0 代码任务必须先备份数据库，旧 Account 字段清理要有迁移前后检查和回滚路径。

## Public-safety rules

文档不得包含真实密钥、生产域名/IP、用户数据、备份、日志、Webhook URL、联系人或未公开 Account 设计细节。配置示例使用 `example.com`、回环地址和占位值；审计只保留路径、行号和抽象结论。
