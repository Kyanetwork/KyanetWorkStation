# Workstation Documentation And Roadmap

## Goal

建立一套可公开维护、可持续执行的 KyanetWorkStation 文档与路线图基线，使项目从“反馈/任务收集系统”清晰演进为个人和小团队的轻量工作中枢，同时把确认的安全、隐私、运行时和运维缺陷纳入可验收的 P0 计划。

## Background and confirmed facts

- 当前实现是纯静态前端 + Node.js/Express + SQLite/MySQL/PostgreSQL，可通过 PM2 和 Nginx/IIS/Caddy 部署；证据：`server/app.js:92-112,355-529,841-883`、`server/db.js:1-14,158-429`、`deploy/`。
- 当前已实现反馈、WorkTask、管理员后台、状态/分页/筛选、CSV、主页进展、SMTP/Webhook、MeowStatus 状态卡片和备份脚本；证据：`server/app.js:355-839`、`public/admin/admin.js:187-814`、`scripts/`。
- 最近提交集中在 KyanetAccount 接入（`e8ad8e6`、`894eabf`、`609132f`、`5aac4a7`，2026-06-07），但用户已决定当前移除旧联动，未来按新设计重新接入。
- `PLAN.md` 仍写“当前状态（截至 2026-04）”，`Feedback_CloudbaseVer.md` 和 `migration2localweb_reference_guide.md` 仍按 CloudBase/迁移阶段叙述；这些内容不再是当前产品真相。
- `.gitignore` 当前忽略 `PLAN.md`、两个历史 Markdown 文件；规划文档因此无法进入 Git 基线。
- 当前 Node 运行时为 24，而 `better-sqlite3` 原生模块 ABI 与运行时不匹配，导致现有集成测试和服务启动可能失败；旧 `memory/verify.md` 中的 40 tests passed 不能作为当前环境证据。
- `npm audit --omit=dev` 当前报告 4 个漏洞，其中 Nodemailer 为 high；审计结果须记录为发布风险，不能直接宣称已修复。

## Product intent and scope

### In scope

1. 将 Workstation 定义为个人/小团队工作中枢：统一入口、反馈、WorkTask、处理进展、服务状态、快捷入口和分阶段 AI 辅助。
2. 当前用户边界为本人和约 20 人小团队；当前允许匿名提交但不开放匿名历史查询，未来 Account 重构完成后再切换到账号绑定。
3. 保留反馈和 WorkTask 两张业务表，通过统一读取层/安全 DTO 支撑工作台，不强行合并数据表、不拆微服务。
4. MeowStatus 作为第一个服务卡片适配器，未来按需增加其他个人项目或服务，不提前建设通用插件平台。
5. AI 先做管理员 Copilot，再逐步扩展到用户侧和运维/知识侧；AI 默认关闭、输入脱敏、密钥只读进程环境、结果须人工确认。
6. 重构公开文档、当前状态、架构/API/运维/测试文档、缺陷清单、路线图、AI 计划和 Account 重构衔接说明。
7. 归档 CloudBase 历史文档和旧代理笔记，明确标注“历史资料，不代表当前架构或计划”。

### Out of scope

- 当前不继续扩展或保留旧 KyanetAccount 联动实现；移除后只保留未来重构的边界说明。
- 当前不做统一 `work_items` 表、微服务拆分、完整 Kanban/甘特图、实时聊天、文件协作、计费、多租户、复杂 RBAC 或通用插件市场。
- 本任务不修改业务代码、不修复 P0 缺陷本身；缺陷进入路线图和独立后续 Trellis 任务。
- 不提交真实 `.env`、生产域名/IP、账号、Webhook URL、备份、日志、内部拓扑、联系人或生产数据。

## Documentation requirements

- `README.md` 只承担项目入口、快速启动和文档导航；完整 API、部署、安全、备份和历史材料拆分到 `docs/`。
- `docs/product/`、`docs/architecture/`、`docs/api/`、`docs/operations/`、`docs/testing/`、`docs/plans/` 各自有唯一权威文档，避免 README、PLAN 和历史文档重复叙述。
- `docs/plans/roadmap.md` 必须包含 P0/P1/P2 阶段、依赖、退出条件和未来任务映射。
- `docs/plans/known-defects.md` 必须区分确认缺陷、高概率风险、文档欠账/验证缺口，并保留证据路径和行号。
- `docs/plans/ai-assistant.md` 必须写明管理员 Copilot 的 MVP、数据脱敏、人工确认、Provider Adapter 和关闭开关。
- `docs/plans/account-refactor.md` 必须说明旧联动清理、未来新联动隔离、历史匿名记录不自动认领。
- 需要真实环境或内部信息的材料放入 `docs/internal/` 并在必要时加入 `.gitignore`；公开文档只保留模板和抽象规则。

## Acceptance criteria

- [x] 根目录 README 能在 5 分钟内说明项目定位、当前能力、启动命令和文档入口，且不再承载完整运维手册。
- [x] `docs/` 目录按已确认的信息架构建立，所有新文档不含真实秘密、生产数据或未授权内部信息。
- [x] 产品定位、功能状态、当前架构、集成边界、API、配置、部署、备份、安全、观测、测试、路线图、AI 和 Account 重构均有唯一权威文件。
- [x] 历史 CloudBase/迁移/代理笔记已归档并加历史声明；旧 `PLAN.md` 不再作为当前计划来源。
- [x] `.gitignore` 不再忽略当前规划文档；仍忽略 `.env`、运行时数据库、备份、日志、临时文件及必要的内部文档。
- [x] 路线图包含已确认的 P0 缺陷：公开 highlights 数据最小化、Account 私有 DTO、旧 Account 清理、Node/SQLite ABI、代理头信任、图片/外部响应边界、通知可靠性、WorkTask 清空语义、配置启动自检、集成验证和依赖审计。
- [x] 路线图功能顺序为：P0 基线 → P1 工作台首页/收件箱/我的工作区/服务卡片 → P1 管理员 AI → P2 项目管理与 AI/Account 扩展。
- [x] 文档链接、路径、标题、状态和现有代码路由相互一致；当前测试环境失败或未覆盖项必须明确记录，不得虚报通过。

## Open questions

无阻塞性产品决策。具体实现任务的文件级范围、测试命令和迁移步骤在后续 Trellis 子任务中分别确认。
