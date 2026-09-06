# P2 Kanban 基础能力执行计划

本计划执行已批准的 `prd.md` 与 `design.md`。实现前不得修改生产数据库、`.env`、Nginx 或 PM2 配置；不得引入 schema 字段、ORM、前端框架或拖拽依赖。详细代码形状和测试样例见 `docs/superpowers/plans/2026-09-04-p2-kanban-foundation.md`。

## 实际执行记录（2026-09-06）

本任务的实现、文档同步和本地质量门禁已完成；下列证据对应当前工作树，尚未代表云服务器已部署：

- [x] P2 Kanban 双泳道、来源原生状态列、项目范围状态接口、归档只读和项目更新时间语义已实现。
- [x] validator、SQLite 数据层、管理员 API/审计、项目模型、管理员 UI/CSS 和公共隐私边界已覆盖自动回归。
- [x] `npm test`：204/204 通过；变更 JavaScript `node --check`：10 个文件通过；`git diff --check`：通过。
- [x] `npm audit --omit=dev --registry=https://registry.npmjs.org`：0 vulnerabilities；`task.py validate`：通过。
- [x] `.trellis/spec/backend/project-management.md` 已记录 Kanban 的签名、字段、错误矩阵、测试要求及错误/正确示例。
- [ ] 云服务器备份、Git 同步、`npm ci`、PM2 重启、health、管理员 Kanban 和公共隐私冒烟：发布时按 `docs/operations/deployment.md` 执行并记录证据。

细粒度条目保留为实现配方和回滚参考；以本节的实际证据及最终提交前复核结果作为本次执行状态。

## 目标与不变式

- `GET /api/admin/project/:id` 仍是 Kanban 读取数据源；公共 API/页面不返回工作项。
- Feedback 与 WorkTask 是两条独立泳道，分别使用 `new/reviewed/resolved/notplanned` 和 `new/scheduled/in_progress/completed/cancelled`。
- 列内排序为 `updatedAt DESC, sourceId DESC`；保存只改变来源原生状态。
- 关系视图默认显示，继续负责里程碑和绑定/解绑；Kanban 使用 select + 明确保存按钮。
- 新接口为 `POST /api/admin/project/item/status`，状态变化时更新项目 `updated_at`，同值保存不更新时间。
- 项目必须存在且为 `active`，关系必须属于该项目；错误码分别为 `INVALID_PAYLOAD`、`NOT_FOUND`、`PROJECT_ITEM_CONFLICT`、`PROJECT_STATE_CONFLICT`。
- 每个写请求沿用管理员会话、同源、JSON 和限流中间件，并写入 `project.item.status` 脱敏审计。

## Task 1：状态输入校验

文件：`server/validation.js`、`tests/project-validation.test.js`。

- [ ] 在测试中加入 `validateProjectItemStatusPayload` 的合法反馈/WorkTask payload、跨来源状态、非法 ID、非法来源类型用例。
- [ ] 运行 `node --test tests/project-validation.test.js`，确认新用例先因函数未导出而失败。
- [ ] 实现 `validateProjectItemStatusPayload(payload)`：复用 `parseProjectId` 和现有 `ALLOWED_STATUS`/`ALLOWED_WORKTASK_STATUS`；返回 `{ projectId, sourceType, sourceId, status }` 的规范化数据；反馈只接受 `new/reviewed/resolved/notplanned`，WorkTask 只接受 `new/scheduled/in_progress/completed/cancelled`。
- [ ] 从 `server/validation.js` 导出该函数，运行 `node --test tests/project-validation.test.js && node --check server/validation.js`。

回滚点：仅回退新增 validator 和测试，不改变既有来源状态 validator。

## Task 2：项目范围状态数据层

文件：`server/db.js`、`tests/project-db.test.js`。

- [ ] 使用现有临时 SQLite 辅助写失败行为测试：活跃项目中绑定 Feedback/WorkTask 后分别更新状态；断言来源状态、项目 `updatedAt` 变化、里程碑 ID 保留；再次保存同值时项目 `updatedAt` 不变。
- [ ] 写跨项目、归档项目、未绑定关系和来源缺失的 `assert.rejects`，按 `error.code` 断言 `PROJECT_ITEM_CONFLICT`、`PROJECT_STATE_CONFLICT`、`NOT_FOUND`，并确认来源状态未被错误请求改变。
- [ ] 运行 `node --test tests/project-db.test.js`，确认新 helper 尚不存在时失败。
- [ ] 在项目数据层增加 `touchProjectUpdatedAt(projectId)`，通过 `placeholder()` 参数化更新 `project.updated_at`。
- [ ] 增加并导出 `updateProjectItemStatus({ projectId, sourceType, sourceId, status })`：检查正整数/来源类型、项目存在和 active 状态；读取唯一 `project_item`，拒绝跨项目关系；读取对应来源，缺失时 best-effort 清理孤儿关系并抛 `NOT_FOUND`；仅在来源原状态不同的时候调用 `updateFeedbackStatus` 或 `updateWorktaskStatus`，随后触碰项目时间；同值直接返回原项目时间。
- [ ] helper 返回 `{ projectItemId, projectId, sourceType, sourceId, status, projectUpdatedAt }`，不返回来源正文、联系方式、备注或账号快照。
- [ ] 运行 `node --test tests/project-db.test.js tests/backup-sqlite.test.js && node --check server/db.js`。

回滚点：保留既有三表 schema，移除新 helper 和测试；不执行 `DROP TABLE`，不改普通来源状态接口。

## Task 3：管理员 API 与审计

文件：`server/app.js`、`tests/project-api.test.js`。

- [ ] 在 HTTP 测试中加入匿名 401、跨来源状态 400、成功 Feedback/WorkTask 状态更新、同值时间不变、跨项目 409、归档 409、未绑定 404 用例。
- [ ] 断言成功响应只含项目/来源/状态/项目时间字段；重新读取详情确认来源状态和里程碑不变；查询 `project_item` 审计确认 action 为 `project.item.status` 且 metadata 无正文、联系方式、URL 或 key。
- [ ] 运行 `node --test tests/project-api.test.js`，确认新路由尚不存在时失败。
- [ ] 在 app 的数据库/validation 解构中加入 `updateProjectItemStatus` 和 `validateProjectItemStatusPayload`。
- [ ] 在 `/api/admin/project/item/update` 后新增 `POST /api/admin/project/item/status`；先 validator 400，再调用 helper；成功审计实体 `project_item` 使用 `projectItemId`，响应剥离内部关系 ID；失败用 `auditResultForError` 记录稳定错误码后调用 `sendProjectError`。
- [ ] 为 `PROJECT_STATE_CONFLICT` 保留归档项目统一提示，不模拟调用普通 Feedback/WorkTask HTTP 路由。
- [ ] 运行 `node --test tests/project-api.test.js tests/admin-audit.test.js && node --check server/app.js`。

回滚点：移除新路由和导入即可恢复旧 API；不改变 `/api/admin/feedback/status` 与 `/api/admin/worktask/status`。

## Task 4：Kanban 管理模型

文件：`public/admin/project-model.js`、`tests/project-model.test.js`。

- [ ] 写测试断言 `feedback` 列顺序为 `new/reviewed/resolved/notplanned`，`worktask` 列顺序为 `new/scheduled/in_progress/completed/cancelled`；同一状态按 `updatedAt`、再按项目关系 `id` 降序（`sourceId` 仅作 fallback）；空列存在；未知状态进入安全 `unknown` 列。
- [ ] 运行 `node --test tests/project-model.test.js`，确认 `buildKanbanLanes` 未导出时失败。
- [ ] 增加冻结常量 `KANBAN_STATUS_COLUMNS` 和 `buildKanbanLanes(items)`；先 `normalizeItem`，按来源分离，未知状态放入 `unknown`，用 `Date.parse` 无效时按 0，再按关系 `id`/`sourceId` 降序排序。
- [ ] 保持原有 `splitProjectItems` 不变，避免关系视图行为改变；导出新常量和函数。
- [ ] 运行 `node --test tests/project-model.test.js && node --check public/admin/project-model.js`。

回滚点：只移除 Kanban 常量/分组，不改变关系泳道模型。

## Task 5：管理员 UI、切换和状态保存

文件：`public/admin/index.html`、`public/admin/admin.js`、`public/workstation.css`、`tests/project-static-ui.test.js`。

- [ ] 静态测试先断言 `projectRelationsView`、`projectKanbanView`、两个 view button、`projectKanbanBoard`、按钮 `type="button"`/`aria-pressed`、`buildKanbanLanes`、`project-kanban-status-save` 和新 API 路径；确认公共页面不出现管理员 Kanban 标识。
- [ ] 运行 `node --test tests/project-static-ui.test.js`，确认新入口尚不存在时失败。
- [ ] 在项目详情中加入关系视图/Kanban 两个按钮和对应容器；将现有里程碑、关系泳道、候选面板原样置于 `projectRelationsView`，不改变既有 ID 和事件委托。
- [ ] 在 `state.projects` 增加 `projectView: "relations"`；项目切换、关闭详情、退出登录时恢复默认；`setProjectView` 同步 hidden、active 和 `aria-pressed`。
- [ ] 实现 `renderProjectKanban(detail)`：使用模型列定义渲染两条泳道、列标题/数量、空列、unknown fallback；卡片只显示来源类型、标题、更新时间和 WorkTask 的优先级/负责人/计划/期望时间；动态字段全部 `escapeHtml`。
- [ ] 每张卡片使用固定状态 option、`data-source-type`/`data-source-id` 和 `project-kanban-status-save` 按钮；归档项目 select/按钮禁用。
- [ ] 在 `handleProjectAction` 处理状态保存，读取卡片 select，调用 `/api/admin/project/item/status`，复用 `withButtonBusy`/`projectWrite`；成功重读详情并保留 Kanban，失败不刷新且保留选择。
- [ ] 在 `workstation.css` 加入直角冷色 Kanban 网格/卡片/禁用态/焦点样式；760px 以下保证列可读滚动，620px 以下纵向堆叠；不添加圆角覆盖。
- [ ] 运行 `node --test tests/project-static-ui.test.js tests/project-model.test.js; node --check public/admin/admin.js; node --check public/admin/project-model.js; git diff --check`。

回滚点：将 `projectView` 固定为 `relations` 并隐藏 Kanban 容器即可回退 UI，不需要数据库回滚。

## Task 6：文档同步

文件：`docs/api/reference.md`、`docs/architecture/current.md`、`docs/product/feature-status.md`、`docs/plans/roadmap.md`、`docs/operations/deployment.md`、`docs/testing/release-checklist.md`。

- [ ] API reference 写明新接口请求/响应、来源专属状态、错误码和公共投影不含 Kanban。
- [ ] 架构文档记录 DTO → 模型分组 → validator/helper → 来源更新时间/项目时间 → 审计 → 详情重读的数据流，明确无 schema 变化、无跨驱动强事务声明和同值时间语义。
- [ ] 产品状态和路线图将 Kanban 基础标记为 P2 已实现，把子任务、依赖、拖拽、批量、公共 Kanban、新 Account 联动保留为后续/暂缓。
- [ ] 部署与发布清单记录备份、Git 同步、依赖探针、PM2 重启、health、管理员 Kanban 冒烟、公共隐私和主题/窄屏/键盘检查；未执行的云端动作保持待执行描述。
- [ ] 运行 `git diff --check`，并用 `rg -n "project/item/status|Kanban|PROJECT_STATE_CONFLICT" docs` 核对路径和错误码一致。

## Task 7：全量门禁与完成前检查

- [ ] 运行 `git diff --name-only -- '*.js' | ForEach-Object { node --check $_ }`。
- [ ] 运行 `npm test`、`npm audit --omit=dev`、`git diff --check`；better-sqlite3 ABI 问题按项目规范记录，不伪造通过。
- [ ] 用临时 SQLite 实际执行管理员登录、项目/来源绑定、Kanban 状态保存、同值、归档拒绝和公共投影检查；亮暗主题、620px 窄屏、Tab 焦点、空列和 busy 恢复各验证一次。
- [ ] 运行 `python ./.trellis/scripts/task.py validate .trellis/tasks/09-04-p2-kanban-foundation`，确认 PRD/design/implement 和两个 manifest 均存在且无 seed-only 条目。
- [ ] 全量审阅 `git status --short`，只保留本任务变更；质量通过后向用户展示一次性提交分组，收到“确认提交/ok/行”才提交，不 push。

## 回滚总则

本任务不新增数据库字段，因此失败时只回滚应用代码、测试和文档；保留已有 `project`、`project_milestone`、`project_item` 表。生产回滚遵循备份 → 停止/回退应用代码 → PM2 重启 → health；不得删除项目表或覆盖生产 `.env`。
