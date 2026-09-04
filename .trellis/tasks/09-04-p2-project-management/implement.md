# P2 项目管理基础能力执行计划

> 本文件是 Trellis 执行入口；完整的测试先行步骤、字段契约和代码示例见 `docs/superpowers/plans/2026-09-04-p2-project-management.md`。实现前必须读取本任务的 `prd.md`、`design.md`、该计划以及 `implement.jsonl` 中列出的规范。

## 执行规则

- 当前任务进入 `in_progress` 前不得修改产品代码；只有用户明确批准本计划后才运行 `python ./.trellis/scripts/task.py start .trellis/tasks/09-04-p2-project-management`。
- 每项按失败测试 → 最小实现 → 聚焦测试 → `node --check` 执行；不得使用 ORM、前端框架、migration runner 或新的外部服务。
- 继续使用 `server/db.js` 单一数据库边界、参数化 SQL、camelCase 映射、`{ok:true,data}`/`sendError`、管理员会话 + 同源 + JSON 中间件和公共 projection allow-list。
- 项目为组织层，Feedback/WorkTask 不合表；单个来源最多一条 `project_item`。归档项目不能新增里程碑/绑定；撤销里程碑解除关联但恢复不重绑。
- 公共 URL 只使用随机不可变 `publicKey`；基础信息、里程碑、更新时间和完成度由独立开关控制，未公开/归档/不存在统一 404。AI、通知、KyanetAccount 不被项目流程驱动。

## 有序任务清单

### 1. 输入契约（TDD）

- [ ] 在 `tests/project-validation.test.js` 先加入项目创建/部分更新、Unicode 长度、ISO 日期、ID、来源类型、milestoneId、0–100 完成度、公开 key 和布尔值的失败断言。
- [ ] 运行 `node --test tests/project-validation.test.js`，确认因 validator 未导出而失败。
- [ ] 在 `server/validation.js` 实现并导出 `validateProjectListPayload`、`validateProjectIdPayload`、`validateProjectCreatePayload`、`validateProjectUpdatePayload`、`validateProjectMilestoneCreatePayload`、`validateProjectMilestoneUpdatePayload`、`validateProjectMilestoneIdPayload`、`validateProjectItemQueryPayload`、`validateProjectItemCandidatesPayload`、`validateProjectItemAssignPayload`、`validateProjectItemUpdatePayload`、`validateProjectItemUnassignPayload`、`validatePublicProjectKey`。长度以 `Array.from(value).length` 计算；日期严格为 `YYYY-MM-DD`；来源只允许 `feedback/worktask`；custom 完成度为 0–100 整数；auto 清空 custom 值。
- [ ] 运行 `node --test tests/project-validation.test.js && node --check server/validation.js`，全部通过后再进入数据层。

### 2. 三驱动 schema 与数据层（TDD）

- [ ] 在 `tests/project-db.test.js` 写临时 SQLite 测试：初始化幂等、三表/索引、创建/更新/归档/恢复、随机 UUID public key、里程碑排序/完成/撤销/恢复、自动/自定义完成度、单来源唯一归属、跨项目 milestone 冲突、公共字段 allow-list、来源删除清理、孤儿过滤；静态读取三套 schema 声明并检查相同表/唯一约束/索引语义。
- [ ] 运行 `node --test tests/project-db.test.js`，确认数据层尚不存在导致失败。
- [ ] 在 `server/db.js` 的 SQLite/MySQL/PostgreSQL schema 数组加入 `project`、`project_milestone`、`project_item` 及唯一/查询索引；`initializeDatabase()` 调用幂等 `ensureProjectSchema()`，不修改旧表、不删表、不引入 migration runner。
- [ ] 实现并导出 `createProject`、`getProjectById`、`listProjects`、`updateProject`、`archiveProject`、`restoreProject`、`getProjectDetail`、`createProjectMilestone`、`updateProjectMilestone`、`revokeProjectMilestone`、`restoreProjectMilestone`、`getProjectItemBySource`、`listProjectItemCandidates`、`assignProjectItem`、`updateProjectItemMilestone`、`unassignProjectItem`、`listPublicProjects`、`getPublicProjectByKey`、`cleanupProjectItemsForSource`。
- [ ] 所有值用 `placeholder()` 绑定；行统一经 `mapProjectRow`/`mapProjectMilestoneRow`/`mapProjectItemRow`；项目创建用 `crypto.randomUUID()`；归档新增和跨项目/撤销 milestone 分别抛出 `PROJECT_STATE_CONFLICT`/`PROJECT_MILESTONE_CONFLICT`；重复来源归属抛出 `PROJECT_ITEM_CONFLICT`；完成度只统计 active milestone。
- [ ] 在 Feedback/WorkTask 成功删除后调用 `cleanupProjectItemsForSource`，清理失败只写有限 warning，不回滚来源删除；详情读取再次过滤/清理孤儿。
- [ ] 运行 `node --test tests/project-db.test.js tests/backup-sqlite.test.js && node --check server/db.js`。

### 3. 审计脱敏

- [ ] 在 `tests/admin-audit.test.js` 先加入项目 ID、来源类型/ID、milestone ID、公开开关和 changedFields 保留，name/description/title/content/publicKey/URL 丢弃的失败断言。
- [ ] 在 `server/admin-audit-metadata.js` 为项目 metadata 增加数字、布尔、枚举和有界数组 allow-list；禁止自由文本和密钥/URL。
- [ ] 运行 `node --test tests/admin-audit.test.js tests/project-db.test.js && node --check server/admin-audit-metadata.js`。

### 4. HTTP API（TDD）

- [ ] 在 `tests/project-api.test.js` 复用临时 SQLite/random port/admin login helper，先写匿名 401、CRUD、里程碑、绑定冲突、归档 409、非法 payload 400、公共开关省略字段和统一 404 的失败流程。
- [ ] 运行 `node --test tests/project-api.test.js`，确认路由不存在而失败。
- [ ] 在 `server/app.js` 导入 validator/db/audit；先注册 `GET /api/public/projects`、`GET /api/public/projects/:publicKey`；管理员路由顺序必须是静态 `/project/item`、`/item-candidates`、create/update/archive/restore、milestone 子路由、item 子路由，最后才是 `GET /api/admin/project/:id`。
- [ ] 所有管理读写使用 `requireAdminSession`；写请求继承同源和 JSON 中间件；错误统一 `sendError`；写成功后 `recordAdminAuditSafely`，metadata 只含脱敏摘要；不返回 SQL/堆栈/敏感字段。
- [ ] 运行 `node --test tests/project-api.test.js tests/security.test.js tests/admin-audit.test.js && node --check server/app.js`。

### 5. 管理员项目页面

- [ ] 在 `tests/project-model.test.js` 和 `tests/project-static-ui.test.js` 先写缺省字段、排序、泳道、hash、按钮 type、脚本路径和必要 DOM ID 的失败断言。
- [ ] 新建 `public/admin/project-model.js`，导出 `normalizeProjectSummary`、`normalizeProjectDetail`、`splitProjectItems`、`projectHash`、`parseProjectHash`；数组/数字/字符串缺省安全，来源仅两个 allow-list，不保存业务数据。
- [ ] 修改 `public/admin/index.html` 增加 `tabProjects/moduleProjects`、列表筛选/分页、详情元数据/公开设置、里程碑表格、Feedback/WorkTask 泳道和候选/绑定控件；每个按钮显式 `type`，状态区保留 `aria-live`。
- [ ] 修改 `public/admin/admin.js` 增加 page-local 项目 state、`#projects`/`#projects/<id>` hash 读取、API fetch、单条写入后重新读详情、409 可执行提示；不做乐观更新、不写 localStorage。
- [ ] 在 `public/workstation.css` 增加复用现有变量的直角项目样式、焦点环、亮暗主题和 620px 窄屏规则，禁止圆角和原生按钮泄漏。
- [ ] 运行 `node --test tests/project-model.test.js tests/project-static-ui.test.js && node --check public/admin/project-model.js && node --check public/admin/admin.js`。

### 6. 公共首页与详情页

- [ ] 先在 `tests/project-static-ui.test.js` 断言首页项目区块/列表、详情脚本、`encodeURIComponent`、安全文本渲染、404 文案和无敏感字段名。
- [ ] 修改 `public/index.html`/`public/index/main.js`：并行请求公共项目列表；空列表隐藏整块；卡片只渲染 key/name/description 并链接 `/project/?key=...`；失败不影响 highlights/MeowStatus。
- [ ] 新建 `public/project/index.html`/`main.js`：读取 query key，404 显示“项目暂不可用”，其他错误可重试；仅按字段存在渲染基础信息、active milestone、更新时间、completion；全部动态文本用 `textContent`/`escapeHtml`。
- [ ] 运行 `node --test tests/project-static-ui.test.js && node --check public/index/main.js && node --check public/project/main.js`。

### 7. 迁移、文档和发布记录

- [ ] 在 `tests/backup-sqlite.test.js`/`tests/runtime-compatibility.test.js` 增加旧 SQLite schema 两次启动、历史行保留、项目表/索引出现、旧代码忽略新表的回归。
- [ ] 更新 `docs/api/reference.md`、`docs/architecture/current.md`、`docs/product/feature-status.md`、`docs/plans/roadmap.md`、`docs/operations/deployment.md`、`docs/testing/release-checklist.md`，只记录已实现接口、字段 allow-list、备份/回滚保留新表、人工冒烟和延期边界。
- [ ] 运行 `node --test tests/backup-sqlite.test.js tests/runtime-compatibility.test.js && git diff --check`。

### 8. 最终质量门禁

- [ ] 运行所有变更脚本语法检查：`git diff --name-only -- '*.js' | ForEach-Object { node --check $_ }`。
- [ ] 运行 `npm test`、`npm audit --omit=dev`；记录 Node 24/better-sqlite3 环境结果，不伪造通过。
- [ ] 用临时 SQLite 做管理员登录→项目 CRUD→hash 刷新→里程碑→来源泳道→冲突→归档/恢复→公开开关→首页→`/project/` 的 HTTP/浏览器冒烟，检查亮暗主题、620px、Tab 焦点、中文长文本和 404 不可枚举。
- [ ] 运行 `python ./.trellis/scripts/task.py validate .trellis/tasks/09-04-p2-project-management`、`git diff --check`，逐项对照 PRD AC-1～AC-7。
- [ ] 最终提交前加载 `trellis-check` 与相关 backend/frontend spec；确认是否需要 `.trellis/spec/` 更新。向用户展示一次性提交计划，得到“确认提交/ok/行”后再提交，不 push、不 amend。

## 回滚点

1. validator 阶段失败：只回退项目 validator/test。
2. schema/CRUD 阶段失败：保留旧表和备份，删除项目 route 调用；绝不 `DROP TABLE`。
3. API/UI 阶段失败：回退新增 route/tab/page，保留通过的增量 schema（旧版本会忽略）。
4. 发布冒烟失败：停止切换流量，保留新表，按已验证备份恢复数据库；不直接覆盖未验证生产文件。

## 完成条件

- `prd.md`、`design.md`、本文件和两个 JSONL manifest 均存在且 Trellis validate 通过。
- AC-1～AC-7 有自动化或人工证据；公共/管理员投影、认证、审计、迁移兼容和来源清理均有测试。
- `node --check`、`npm test`、`npm audit --omit=dev`、`git diff --check` 结果已记录，用户审阅最终差异并确认提交。
