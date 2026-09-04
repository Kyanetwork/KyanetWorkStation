# P2 项目管理基础能力 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变 Feedback/WorkTask 原生模型的前提下，为 WorkStation 增加项目容器、里程碑、单条工作项归属、可控公开投影和管理员/公共页面。

**Architecture:** 继续使用 Node.js 24、CommonJS、Express、原生静态 HTML/CSS/JavaScript 与 `server/db.js` 三驱动数据库 facade。项目关系存放在 `project`、`project_milestone`、`project_item` 三张增量表；HTTP 层只编排验证、数据库调用、审计和 DTO，不在路由中拼接 SQL。公共端只调用独立 allow-list 查询并使用随机 `publicKey`。

**Tech Stack:** Node.js 24 LTS、Express 4、`node:test`、better-sqlite3 13、MySQL 8+/mysql2、PostgreSQL/pg、原生 CSS/JavaScript；不引入 ORM、前端框架、构建器、migration runner 或新的外部服务。

---

## 执行边界与成功标准

- 只实现 `.trellis/tasks/09-04-p2-project-management/prd.md` 与 `design.md` 已批准的首版；不恢复 KyanetAccount 联动，不让 AI 自动改项目/工作项，不新增通知副作用。
- Feedback 与 WorkTask 仍是两个独立来源；一个来源最多有一条 `project_item`，可不归类；项目详情保持两个泳道。
- 归档项目可整理已有数据，但不能新增里程碑或绑定新来源；撤销里程碑必须解除其关联，恢复不自动重绑。
- 公共端只返回显式允许字段；基础信息、里程碑、更新时间、完成度分别由项目开关控制，未公开/归档/不存在统一 404。
- 每个任务按“先写失败测试、再做最小实现、再跑聚焦测试”的顺序执行；每个任务结束保留一个可回滚的逻辑提交点。只有全部检查通过并获得用户提交确认后才提交，不自动 push。

## 文件地图

### 新建

- `tests/project-validation.test.js`：项目、里程碑、归属和公开 key 的输入契约。
- `tests/project-db.test.js`：SQLite 增量 schema、CRUD、完成度、冲突、孤儿清理和静态三驱动 schema 等价性。
- `tests/project-api.test.js`：管理员/公共 HTTP 流程、会话、同源/JSON、防枚举和错误 envelope。
- `public/admin/project-model.js`：管理员项目 DTO 的一次性归一化、排序、泳道拆分和 hash 辅助。
- `tests/project-model.test.js`：管理员模型缺省值、排序、泳道和转义边界。
- `public/project/index.html`、`public/project/main.js`：独立公共项目详情页。
- `tests/project-static-ui.test.js`：新增静态页面、按钮 `type`、脚本路径、公开字段渲染契约。

### 修改

- `server/validation.js`：项目列表/创建/更新、里程碑、来源查询/候选/绑定/解绑和 `publicKey` 校验及导出。
- `server/db.js`：SQLite/MySQL/PostgreSQL 三套 schema/index、项目 CRUD、里程碑/多态关联、完成度、公共查询、来源删除后的 best-effort 清理和详情孤儿修复。
- `server/admin-audit-metadata.js`：项目动作的数字/枚举/布尔/数量 metadata allow-list。
- `server/app.js`：公共项目路由、管理员项目路由、静态路由先于 `/:id`、会话/同源/JSON 中间件和脱敏审计。
- `public/admin/index.html`、`public/admin/admin.js`：项目一级标签、列表、hash 详情、公开设置、里程碑表格、Feedback/WorkTask 泳道和单条绑定操作。
- `public/index.html`、`public/index/main.js`：首页公开项目区块和卡片链接。
- `public/workstation.css`：项目列表、详情、泳道、状态/完成度、窄屏与亮暗主题直角样式。
- `docs/api/reference.md`、`docs/architecture/current.md`、`docs/product/feature-status.md`、`docs/plans/roadmap.md`、`docs/operations/deployment.md`、`docs/testing/release-checklist.md`：接口、架构、状态、路线图、发布回滚和验收证据同步。

## Task 1: 先锁定输入与投影契约

**Files:**

- Test: `tests/project-validation.test.js`
- Modify: `server/validation.js`
- Modify: `docs/api/reference.md`（只在契约测试通过后补接口表）

- [ ] **Step 1: 写失败测试，覆盖 Unicode 长度和跨字段组合**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateProjectCreatePayload,
  validateProjectUpdatePayload,
  validateProjectListPayload,
  validateProjectMilestoneCreatePayload,
  validateProjectMilestoneUpdatePayload,
  validateProjectItemAssignPayload,
  validateProjectItemUpdatePayload,
  validateProjectItemQueryPayload,
  validatePublicProjectKey
} = require("../server/validation");

test("项目输入按 Unicode 长度和默认值归一化", () => {
  const result = validateProjectCreatePayload({
    name: "  我的 WorkStation 项目  ",
    description: "  冷色直角工作台  ",
    publicBasic: true,
    publicMilestones: false,
    publicUpdatedAt: true,
    publicCompletion: false,
    completionMode: "auto"
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.data, {
    name: "我的 WorkStation 项目",
    description: "冷色直角工作台",
    publicBasic: true,
    publicMilestones: false,
    publicUpdatedAt: true,
    publicCompletion: false,
    completionMode: "auto",
    customCompletion: null
  });
});

test("项目更新拒绝空更新、非法完成度和错误布尔值", () => {
  assert.equal(validateProjectUpdatePayload({ id: 1 }).valid, false);
  assert.equal(validateProjectUpdatePayload({ id: 1, customCompletion: 101, completionMode: "custom" }).valid, false);
  assert.equal(validateProjectUpdatePayload({ id: 1, publicBasic: "true" }).valid, false);
});

test("里程碑日期、来源类型和同项目关系字段有界", () => {
  assert.equal(validateProjectMilestoneCreatePayload({ projectId: 1, title: "上线", targetDate: "2026-09-30", sortOrder: 2 }).valid, true);
  assert.equal(validateProjectMilestoneCreatePayload({ projectId: 1, title: "上线", targetDate: "2026-9-30" }).valid, false);
  assert.equal(validateProjectItemAssignPayload({ projectId: 1, sourceType: "feedback", sourceId: 2, milestoneId: 3 }).valid, true);
  assert.equal(validateProjectItemAssignPayload({ projectId: 1, sourceType: "account", sourceId: 2 }).valid, false);
  assert.equal(validateProjectItemUpdatePayload({ projectId: 1, sourceType: "worktask", sourceId: 2, milestoneId: null }).valid, true);
  assert.equal(validateProjectItemQueryPayload({ sourceType: "feedback", sourceId: "7" }).valid, true);
});

test("公开 key 只接受随机 UUID 文本", () => {
  assert.equal(validatePublicProjectKey("550e8400-e29b-41d4-a716-446655440000").valid, true);
  assert.equal(validatePublicProjectKey("1").valid, false);
  assert.equal(validatePublicProjectKey("550e8400-e29b-41d4-a716-446655440000/extra").valid, false);
});
```

- [ ] **Step 2: 运行聚焦测试确认当前失败**

运行：`node --test tests/project-validation.test.js`

预期：FAIL，原因是项目校验函数尚未导出。

- [ ] **Step 3: 实现最小校验函数并导出**

在 `server/validation.js` 复用 `normalizeString`、`truncateUnicode`、`parseStrictPositiveInteger`、`parseBooleanLike`、`hasOwn`，增加以下固定规则：项目名 1–120、说明 0–2000、里程碑标题 1–160、说明 0–2000、日期匹配 `/^\\d{4}-\\d{2}-\\d{2}$/u` 且 `new Date(`${value}T00:00:00Z`)` 有效、排序 0–100000、ID 为安全正整数、来源类型仅 `feedback/worktask`、完成度为 0–100 安全整数。部分更新必须至少出现一个允许字段；`completionMode=auto` 将 `customCompletion` 归一化为 `null`，`custom` 必须同时出现有效值。所有布尔字段只接受实际 boolean 或现有约定的明确数字/字符串形式，不接受任意 truthy 字符串。

导出名称固定为：

```js
validateProjectListPayload
validateProjectIdPayload
validateProjectCreatePayload
validateProjectUpdatePayload
validateProjectMilestoneCreatePayload
validateProjectMilestoneUpdatePayload
validateProjectMilestoneIdPayload
validateProjectItemQueryPayload
validateProjectItemCandidatesPayload
validateProjectItemAssignPayload
validateProjectItemUpdatePayload
validateProjectItemUnassignPayload
validatePublicProjectKey
```

- [ ] **Step 4: 运行测试确认通过并检查语法**

运行：`node --test tests/project-validation.test.js && node --check server/validation.js`

预期：全部项目校验测试 PASS，语法检查退出码为 0。

- [ ] **Step 5: 更新 API 参考中的请求/错误表**

把设计中的 14 个管理路由和 2 个公共 GET 路由加入 `docs/api/reference.md`，明确 `{ok:true,data}`、`INVALID_PAYLOAD`、`NOT_FOUND`、`PROJECT_ITEM_CONFLICT`、`PROJECT_MILESTONE_CONFLICT`、`PROJECT_STATE_CONFLICT`，并注明公共 DTO 省略字段而非返回 `null`。

回滚点：若校验规则与已批准 PRD 不一致，只回退本任务新增测试/函数，不修改已有反馈、WorkTask 或 AI validator。

## Task 2: 增量数据库 schema 与项目领域数据层

**Files:**

- Test: `tests/project-db.test.js`
- Modify: `server/db.js`

- [ ] **Step 1: 写 SQLite 行为测试和三驱动静态 schema 测试**

测试使用现有 `DB_CLIENT=sqlite`、临时 `DB_PATH`、`initializeDatabase()`/`closeDatabase()` 模式，不复用生产数据库。至少包含以下断言：

```js
test("初始化项目三表并保持幂等", async () => {
  await db.initializeDatabase();
  await db.initializeDatabase();
  const project = await db.createProject({ name: "P2", description: "首版" });
  assert.equal(project.status, "active");
  assert.match(project.publicKey, /^[0-9a-f-]{36}$/u);
  const detail = await db.getProjectDetail(project.id);
  assert.deepEqual(detail.items, []);
});

test("同一来源不能归属两个项目，里程碑只能属于同项目", async () => {
  const first = await db.createProject({ name: "A", description: "" });
  const second = await db.createProject({ name: "B", description: "" });
  const milestone = await db.createProjectMilestone({ projectId: first.id, title: "M1", description: "", targetDate: "", sortOrder: 0 });
  const feedbackId = await db.createFeedback({ type: "Bug", title: "来源", content: "正文", contact: "private", images: [] });
  await db.assignProjectItem({ projectId: first.id, sourceType: "feedback", sourceId: feedbackId, milestoneId: milestone.id });
  await assert.rejects(() => db.assignProjectItem({ projectId: second.id, sourceType: "feedback", sourceId: feedbackId }), /PROJECT_ITEM_CONFLICT/);
  await assert.rejects(() => db.assignProjectItem({ projectId: second.id, sourceType: "feedback", sourceId: feedbackId, milestoneId: milestone.id }), /PROJECT_MILESTONE_CONFLICT/);
});

test("自动/自定义完成度、撤销和恢复遵循产品规则", async () => {
  const project = await db.createProject({ name: "完成度", description: "" });
  const first = await db.createProjectMilestone({ projectId: project.id, title: "完成", description: "", targetDate: "", sortOrder: 0 });
  const second = await db.createProjectMilestone({ projectId: project.id, title: "未完成", description: "", targetDate: "", sortOrder: 1 });
  await db.updateProjectMilestone({ id: first.id, isCompleted: true });
  assert.equal((await db.getProjectDetail(project.id)).project.completion.value, 50);
  await db.revokeProjectMilestone(second.id);
  assert.equal((await db.getProjectDetail(project.id)).project.completion.value, 100);
  await db.updateProject({ id: project.id, completionMode: "custom", customCompletion: 37 });
  assert.equal((await db.getProjectDetail(project.id)).project.completion.value, 37);
  await db.updateProject({ id: project.id, completionMode: "auto" });
  assert.equal((await db.getProjectDetail(project.id)).project.completion.value, 100);
  await db.restoreProjectMilestone(second.id);
  assert.equal((await db.getProjectDetail(project.id)).project.completion.value, 50);
});

test("来源删除后的关系可幂等清理，公共查询不泄露管理字段", async () => {
  const project = await db.createProject({ name: "公开", description: "说明", publicBasic: true, publicMilestones: true });
  const publicView = await db.getPublicProjectByKey(project.publicKey);
  assert.deepEqual(Object.keys(publicView.project).sort(), ["description", "name", "publicKey"].sort());
  assert.equal("id" in publicView.project, false);
  assert.equal("items" in publicView, false);
});
```

静态测试读取 `sqliteSchemaStatements()`、`mysqlSchemaStatements()`、`postgresSchemaStatements()`，分别断言 `project`、`project_milestone`、`project_item`、唯一 `(source_type,source_id)` 和 `(status,updated_at)`/详情索引均存在；不连接外部 MySQL/PostgreSQL。

- [ ] **Step 2: 运行数据库测试确认失败**

运行：`node --test tests/project-db.test.js`

预期：FAIL，原因是 schema 和领域函数尚未存在。

- [ ] **Step 3: 加入三套等价增量 schema**

在三套 schema 数组中加入以下逻辑列；保持现有 snake_case、ISO 字符串时间和驱动布尔转换约定：

```sql
project(
  id, public_key UNIQUE, name, description, status DEFAULT 'active',
  public_basic DEFAULT false, public_milestones DEFAULT false,
  public_updated_at DEFAULT false, public_completion DEFAULT false,
  completion_mode DEFAULT 'auto', custom_completion NULL,
  created_at, updated_at
)
project_milestone(
  id, project_id, title, description, target_date NULL,
  is_completed DEFAULT false, sort_order DEFAULT 0,
  status DEFAULT 'active', created_at, updated_at,
  FOREIGN KEY(project_id) REFERENCES project(id) ON DELETE CASCADE
)
project_item(
  id, project_id, source_type, source_id, milestone_id NULL,
  created_at, updated_at,
  UNIQUE(source_type, source_id),
  FOREIGN KEY(project_id) REFERENCES project(id) ON DELETE CASCADE,
  FOREIGN KEY(milestone_id) REFERENCES project_milestone(id) ON DELETE SET NULL
)
```

SQLite 使用 `INTEGER/REAL?` 不引入浮点：`INTEGER`、`TEXT`、`NOT NULL` 和 0/1；MySQL 使用 `BIGINT`、`VARCHAR`/`TEXT`、`TINYINT(1)`；PostgreSQL 使用 `BIGSERIAL`、`TEXT`、`BOOLEAN`。三驱动索引语义固定为 `public_key` 唯一、`project(status,updated_at)`、`project_milestone(project_id,status,sort_order,id)`、`project_item(project_id,source_type)`、`project_item(project_id,milestone_id)`。

`initializeDatabase()` 在既有 `ensureHomeDisplayColumns()`、`ensureSubmissionAccountColumns()` 后调用一个幂等 `ensureProjectSchema()`；本次是纯新表，不对旧表加列、不删除数据、不引入 migration runner。旧版本启动只会忽略新表。

- [ ] **Step 4: 实现映射、CRUD、完成度和冲突保护**

在 `server/db.js` 集中实现以下函数并导出：

```js
createProject, getProjectById, listProjects, updateProject,
archiveProject, restoreProject, getProjectDetail,
createProjectMilestone, updateProjectMilestone,
revokeProjectMilestone, restoreProjectMilestone,
getProjectItemBySource, listProjectItemCandidates,
assignProjectItem, updateProjectItemMilestone, unassignProjectItem,
listPublicProjects, getPublicProjectByKey,
cleanupProjectItemsForSource
```

实现要求：

1. 所有 SQL 值使用 `placeholder()` 绑定；动态筛选只由固定片段组成；数据库行只能通过 `mapProjectRow`、`mapProjectMilestoneRow`、`mapProjectItemRow` 转为 camelCase。
2. `createProject` 使用 `crypto.randomUUID()` 生成不可变 `publicKey`；插入后返回完整摘要。`updateProject` 是白名单部分更新，`completionMode=auto` 写入 `custom_completion=NULL`。
3. `getProjectDetail` 读取全部 active/revoked 里程碑和两个来源泳道，验证来源存在；对不存在来源执行受限 best-effort `cleanupProjectItemsForSource`，对 revoked milestone 的关联返回 `milestoneId:null`。
4. `assignProjectItem` 先检查项目存在且 active、来源存在、milestone 属于同一项目且 active、`project_item` 不已归属其他项目；冲突抛出带 `code` 的错误对象 `PROJECT_ITEM_CONFLICT`/`PROJECT_MILESTONE_CONFLICT`/`PROJECT_STATE_CONFLICT`，不隐式抢占。
5. `updateProjectItemMilestone` 只允许同一项目的 active milestone 或 `null`；`unassignProjectItem` 要求项目 ID 匹配，影响行数为 0 时返回 0 供路由转 404。
6. 完成度只统计 active milestone；无有效 milestone 返回 `value:null`、`mode` 和计数；custom 模式使用 0–100 值，否则 `Math.round(completed/total*100)`。
7. `revokeProjectMilestone` 先更新 status，再按 milestone ID 清空 `project_item.milestone_id`；第二步失败记录有限日志但不伪造原子性；重复撤销/恢复保持幂等。
8. 公共查询只选取安全列：列表只返回 `publicKey/name/description`；详情基础公开后按四个开关加入 milestones、updatedAt、completion，不返回内部 ID、来源、正文、联系方式、图片、管理员字段或 URL。

- [ ] **Step 5: 接入来源删除清理**

在 `deleteFeedback(id)` 和 `deleteWorktask(id)` 成功（`changes===1`）后调用 `cleanupProjectItemsForSource(sourceType,id)`；清理失败只记录 `{event:"project.item.cleanup.error",sourceType,sourceId,errorCode}`，不回滚原来源删除。重复调用必须安全。

- [ ] **Step 6: 运行聚焦数据库测试和语法检查**

运行：`node --test tests/project-db.test.js tests/backup-sqlite.test.js && node --check server/db.js`

预期：项目数据层和既有 SQLite 备份/迁移测试 PASS；若外部驱动未配置，静态 schema 测试仍 PASS。

回滚点：数据库实现失败时保留三表 schema 但不接入路由，或整批回退本任务新增函数；禁止 `DROP TABLE`、`git reset --hard` 和改写用户生产数据库。

## Task 3: 项目审计 metadata 与错误映射

**Files:**

- Test: `tests/admin-audit.test.js`（增加项目 metadata 用例）
- Modify: `server/admin-audit-metadata.js`
- Modify: `server/admin-audit.js`（仅在需要公共辅助时）

- [ ] **Step 1: 写失败测试，证明项目审计只保留脱敏摘要**

```js
test("项目审计 metadata 丢弃名称、说明、正文和 URL", () => {
  const result = sanitizeAuditMetadata({
    projectId: 7,
    milestoneId: 9,
    sourceType: "feedback",
    sourceId: 11,
    publicBasic: true,
    changedFields: ["name", "description", "publicBasic"],
    name: "不应落库的名称",
    description: "不应落库的正文",
    url: "https://secret.example"
  });
  assert.equal(result.projectId, 7);
  assert.equal(result.milestoneId, 9);
  assert.equal(result.publicBasic, true);
  assert.equal("name" in result, false);
  assert.equal("description" in result, false);
  assert.equal("url" in result, false);
});
```

- [ ] **Step 2: 运行测试确认失败**

运行：`node --test tests/admin-audit.test.js`

预期：新增用例 FAIL，因为项目字段尚未加入 metadata 规则。

- [ ] **Step 3: 加入固定 allow-list 和长度规则**

在 `METADATA_RULES` 增加 `projectId`、`milestoneId`、`sourceType`、`sourceId`、`publicBasic`、`publicMilestones`、`publicUpdatedAt`、`publicCompletion`、`completionMode`、`active`、`itemCount`、`milestoneCount`、`changedFields`；`sourceType` 只接受 `feedback/worktask`，`completionMode` 只接受 `auto/custom`，数字必须为非负安全整数，字段数组只保留固定字段名且最多 32 项。不得把 `name`、`description`、`title`、`content`、`publicKey`、URL 或完整请求体纳入规则。

- [ ] **Step 4: 运行审计/语法测试**

运行：`node --test tests/admin-audit.test.js tests/project-db.test.js && node --check server/admin-audit-metadata.js`

预期：现有审计测试和新增项目 metadata 测试 PASS。

回滚点：只回退项目 metadata 规则；不改变既有 AI、导出和通知审计字段。

## Task 4: 管理员与公共 HTTP API

**Files:**

- Test: `tests/project-api.test.js`
- Modify: `server/app.js`
- Modify: `docs/api/reference.md`

- [ ] **Step 1: 写端到端失败测试**

复用 `tests/admin-export-api.test.js` 的临时 SQLite、随机端口、管理员登录和 `request()` helper，加入以下流程测试：匿名管理请求 401；登录后创建项目；列表/详情读回真实状态；创建/完成/撤销/恢复里程碑；Feedback 与 WorkTask 单条绑定、换里程碑、解绑；第二项目重复绑定返回 409 且原归属不变；归档项目新增里程碑/绑定返回 409；非法日期/来源/ID 返回 400 envelope；公共列表只显示 active+`publicBasic=true`；公共详情按开关省略字段；归档、未公开、随机 key 均返回相同 404。

断言示例：

```js
assert.deepEqual(Object.keys(publicDetail.data.data).sort(), ["project"].sort());
assert.equal(publicDetail.data.data.project.id, undefined);
assert.equal(publicDetail.data.data.items, undefined);
assert.equal(conflict.response.status, 409);
assert.equal(conflict.data.error.code, "PROJECT_ITEM_CONFLICT");
```

- [ ] **Step 2: 运行 API 测试确认失败**

运行：`node --test tests/project-api.test.js`

预期：FAIL，因为项目路由尚未注册。

- [ ] **Step 3: 在 `server/app.js` 注册公共路由**

在 `/api/public/highlights` 附近加入：

```js
app.get("/api/public/projects", asyncHandler(async (_req, res) => {
  res.json({ ok: true, data: await listPublicProjects() });
}));

app.get("/api/public/projects/:publicKey", asyncHandler(async (req, res) => {
  const validation = validatePublicProjectKey(req.params.publicKey);
  if (!validation.valid) return sendError(res, 404, "NOT_FOUND", "项目暂不可用");
  const data = await getPublicProjectByKey(validation.value);
  if (!data) return sendError(res, 404, "NOT_FOUND", "项目暂不可用");
  res.json({ ok: true, data });
}));
```

公共路由只调用公共查询函数，不复用管理员详情。

- [ ] **Step 4: 注册管理员静态子路径后再注册动态详情**

所有管理项目路由都放在现有 `app.use("/api/admin", ...)` 中间件之后，顺序固定为：

1. `POST /api/admin/project/list`
2. `GET /api/admin/project/item`
3. `POST /api/admin/project/item-candidates`
4. `POST /api/admin/project/create`
5. `POST /api/admin/project/update`
6. `POST /api/admin/project/archive`
7. `POST /api/admin/project/restore`
8. `POST /api/admin/project/milestone/create|update|revoke|restore`
9. `POST /api/admin/project/item/assign|update|unassign`
10. 最后 `GET /api/admin/project/:id`

每个写路由依次执行对应 `validate*`、领域函数、`sendError` 错误映射和 `recordAdminAuditSafely`。写成功统一返回 `{ok:true,data:...}`；影响行数为 0 返回 404；领域冲突码映射为 409；未预期错误交给 `asyncHandler`/最终 `INTERNAL_ERROR`。

- [ ] **Step 5: 处理项目审计动作**

动作名固定为 `project.create/update/archive/restore`、`project.milestone.create/update/revoke/restore`、`project.item.assign/update/unassign`；entity type 为 `project`、`project_milestone`、`project_item`。metadata 只传内部 ID、来源类型/ID、变更字段、状态、数量、公开开关和结果。

- [ ] **Step 6: 运行聚焦 API、安全和语法测试**

运行：`node --test tests/project-api.test.js tests/security.test.js tests/admin-audit.test.js && node --check server/app.js`

预期：管理员会话、同源/JSON、防枚举、错误 envelope 和既有安全回归全部 PASS。

回滚点：若路由顺序或中间件回归，删除新增 route block，保留已通过的数据层测试；不得绕过 `requireAdminSession`、`requireSameOriginForAdminMutation` 或 `requireJsonForAdminMutation`。

## Task 5: 管理员项目模型与页面

**Files:**

- Test: `tests/project-model.test.js`、`tests/project-static-ui.test.js`
- Create: `public/admin/project-model.js`
- Modify: `public/admin/index.html`、`public/admin/admin.js`、`public/workstation.css`

- [ ] **Step 1: 写模型和静态 DOM 失败测试**

```js
const { normalizeProjectDetail, splitProjectItems, projectHash } = require("../public/admin/project-model");

test("管理员模型排序、泳道和缺省字段稳定", () => {
  const normalized = normalizeProjectDetail({
    project: { id: 3, name: "P", status: "active", completion: { value: null } },
    milestones: [{ id: 2, sortOrder: 2, status: "active" }, { id: 1, sortOrder: 1, status: "revoked" }],
    items: [{ sourceType: "worktask", sourceId: 8 }, { sourceType: "feedback", sourceId: 7 }]
  });
  assert.deepEqual(normalized.milestones.map((item) => item.id), [1, 2]);
  assert.deepEqual(splitProjectItems(normalized.items).feedback.map((item) => item.sourceId), [7]);
  assert.deepEqual(splitProjectItems(normalized.items).worktask.map((item) => item.sourceId), [8]);
  assert.equal(projectHash(3), "#projects/3");
});
```

静态测试断言 `tabProjects`、`moduleProjects`、`projectList`、`projectDetail`、`projectPublicBasic`、`projectPublicMilestones`、`projectPublicUpdatedAt`、`projectPublicCompletion`、`projectMilestoneForm`、`projectFeedbackLane`、`projectWorktaskLane` 存在；新增按钮全部显式 `type="button"` 或表单主按钮 `type="submit"`，页面仍加载 `/workstation.css` 和 `/theme.js`。

- [ ] **Step 2: 运行测试确认失败**

运行：`node --test tests/project-model.test.js tests/project-static-ui.test.js`

预期：FAIL，因为模型、标签和 DOM 尚未存在。

- [ ] **Step 3: 实现 `public/admin/project-model.js`**

导出 `normalizeProjectSummary`、`normalizeProjectDetail`、`splitProjectItems`、`projectHash`、`parseProjectHash`。输入来自 API 的 `data`，所有数组先 `Array.isArray`，ID/计数显式 `Number`，缺省字符串为 `""`，completion 缺省为 `{value:null, mode:"auto"}`；里程碑按 `sortOrder`、`id` 稳定排序；来源只允许 `feedback/worktask`。模型不保存正文、联系方式或浏览器持久化数据。

- [ ] **Step 4: 加入管理员 HTML 区块和事件契约**

在 tabs 增加 `tabProjects`；新增 `moduleProjects`，包含：状态筛选（all/active/archived）、关键词、分页、列表；详情的元数据/归档按钮、四个公开开关、completion mode/custom 数值、里程碑表格和表单、Feedback/WorkTask 两个泳道、候选来源选择和单条绑定/换里程碑/解绑按钮。每个状态/错误节点保留 `role="status" aria-live="polite"`。

- [ ] **Step 5: 在 `admin.js` 接入页面状态和 hash**

扩展现有 page-local `state`：`projects:{page,pageSize,status,keyword,totalPages,items,loaded}` 与 `projectDetail:{id,data,loaded}`；`switchModule("projects")` 加载列表；`hashchange`/初始化解析 `#projects` 或 `#projects/<positive-id>`，详情刷新请求 `GET /api/admin/project/:id`。写操作通过现有 `api()`、`withButtonBusy()`，成功后重新读取详情，失败保留输入并根据 409 文案提示“先恢复项目/先解绑原项目/选择同项目里程碑”。不新增 localStorage 或乐观更新。

- [ ] **Step 6: 加入直角冷色样式并运行模型/静态测试**

在 `workstation.css` 只新增项目作用域规则；显式 `border-radius:0`、复用现有变量、焦点环、暗色变量和窄屏断点。禁止页面局部圆角、原生未样式按钮和未转义 `innerHTML`。动态名称/说明/标题使用 `escapeHtml` 或 `textContent`。

运行：`node --test tests/project-model.test.js tests/project-static-ui.test.js && node --check public/admin/project-model.js && node --check public/admin/admin.js`

预期：模型/静态契约 PASS，两个脚本语法检查退出码 0。

回滚点：UI 失败时保留 API 与数据库能力；删除新增 tab/module 和 project-model 引用即可恢复现有收件箱、Feedback、WorkTask、AI 页面。

## Task 6: 公共首页、详情页与安全渲染

**Files:**

- Test: `tests/project-static-ui.test.js`（补充首页/详情断言）
- Create: `public/project/index.html`、`public/project/main.js`
- Modify: `public/index.html`、`public/index/main.js`、`public/workstation.css`

- [ ] **Step 1: 先补静态失败断言**

断言首页包含 `publicProjectsSection`、`publicProjectsList`，详情页加载 `/workstation.css`、`/theme.js`、`/project/main.js`，脚本包含 `encodeURIComponent`、`textContent`/`escapeHtml` 和 404 状态文案 `项目暂不可用`，不包含 `innerHTML =` 与数据库字段名 `admin_note/content/contact` 的公共渲染。

- [ ] **Step 2: 实现首页项目列表**

在 `public/index/main.js` 的 `loadHomeShowcase()` 中并行请求 `/api/public/projects`；空数组隐藏整个 `publicProjectsSection`，非空只渲染 `publicKey/name/description`，链接为 `/project/?key=${encodeURIComponent(publicKey)}`。请求失败时隐藏区块并保留既有 highlights/MeowStatus 行为，避免项目 API 影响首页其他区块。

- [ ] **Step 3: 实现 `/project/` 详情页**

`main.js` 读取 `URLSearchParams(location.search).get("key")`，缺 key 或 404 显示统一不可用状态；其他错误显示可重试按钮。成功后只在字段存在时渲染基础信息、里程碑、更新时间和完成度；目标日期使用 `YYYY-MM-DD` 原文，时间使用现有公共 formatter；所有外部值经 `textContent` 或 `escapeHtml`，不创建来源链接、不显示内部 ID。

- [ ] **Step 4: 补充公共样式并运行静态/语法检查**

运行：`node --test tests/project-static-ui.test.js && node --check public/index/main.js && node --check public/project/main.js`

预期：静态安全断言和三个页面脚本语法检查 PASS。

回滚点：公共项目区块可以整体隐藏而不影响旧首页 highlights；删除 `/project/` 静态目录不会改变管理 API。

## Task 7: 文档、迁移兼容和发布操作

**Files:**

- Modify: `tests/backup-sqlite.test.js`、`tests/runtime-compatibility.test.js`
- Modify: `docs/api/reference.md`
- Modify: `docs/architecture/current.md`
- Modify: `docs/product/feature-status.md`
- Modify: `docs/plans/roadmap.md`
- Modify: `docs/operations/deployment.md`
- Modify: `docs/testing/release-checklist.md`

- [ ] **Step 1: 增加旧 SQLite 增量启动回归**

构造只含现有旧表的临时数据库，运行 `initializeDatabase()` 两次，断言历史 Feedback/WorkTask 行保留、三张项目表和全部项目索引出现；不调用 `DROP TABLE`。同时断言旧代码在保留新表时仍能启动（新表被忽略）。

- [ ] **Step 2: 更新文档事实**

API 文档加入管理/公共接口、请求字段、错误码和公共 DTO allow-list；架构文档记录多态 `project_item`、无事务 facade 的撤销双写边界和 `publicKey`；产品状态与路线图标记 P2 项目管理为实现中/完成条件，明确子任务、依赖、Kanban、逐里程碑公开和 KyanetAccount 仍延期；部署文档加入备份→同步→首次启动建表→管理员/公共冒烟→回滚保留新表顺序；发布清单加入 SQLite/三驱动静态 schema、归档 404、公开开关字段缺省、暗亮主题/窄屏/键盘和来源删除孤儿验证。

- [ ] **Step 3: 运行文档链接与兼容测试**

运行：`node --test tests/backup-sqlite.test.js tests/runtime-compatibility.test.js && git diff --check`

预期：旧数据库/备份回归 PASS，Markdown/空白检查通过。

回滚点：文档只描述已实现行为；若实现尚未完成，不把路线图标成完成，也不记录未执行的云端验证为已通过。

## Task 8: 全量质量门禁与人工浏览器冒烟

**Files:**

- Test: all `tests/*.test.js`
- Verify: all changed `server/*.js` and `public/**/*.js`
- Verify: `.trellis/tasks/09-04-p2-project-management/*`

- [ ] **Step 1: 运行所有 JavaScript 语法检查**

运行：

```powershell
git diff --name-only -- '*.js' | ForEach-Object { node --check $_ }
```

预期：所有变更脚本退出码 0。

- [ ] **Step 2: 运行全量测试和依赖审计**

运行：`npm test`、`npm audit --omit=dev`。

预期：全量 `node:test` PASS、审计无漏洞；若环境出现 better-sqlite3 ABI 问题，按现有规范在同一 Node 24 运行时重建并记录，不把阻塞伪报为通过。

- [ ] **Step 3: 执行本地 HTTP/浏览器冒烟**

用临时 SQLite、随机端口和测试管理员启动 `node server/app.js`，验证：登录→项目列表→创建→详情 hash 刷新→里程碑完成/撤销/恢复→Feedback/WorkTask 绑定冲突→归档/恢复→四个公开开关→公共首页卡片→`/project/?key=` 详情→错误 404。分别检查亮色/暗色、620px 窄屏、Tab 键焦点、按钮 busy/恢复、中文长名称/说明无溢出；确认 `GET /api/public/projects/:publicKey` 不含内部 ID、正文、联系方式和管理员字段。

- [ ] **Step 4: 运行 Trellis 校验并做最终差异审阅**

运行：`python ./.trellis/scripts/task.py validate .trellis/tasks/09-04-p2-project-management`、`git diff --check`、`git status --short`。逐项对照 PRD AC-1～AC-7；确认只存在本任务文件和预期代码/测试/文档变更。

- [ ] **Step 5: 准备提交但先向用户展示一次性提交计划**

按仓库近期 `feat:`/`docs:`/`test:` 风格分组，建议提交顺序：

1. `feat: add project management data and APIs`：schema、validator、db、audit、app、后端测试。
2. `feat: add project management pages`：管理员/公共 HTML、JS、CSS、前端模型和静态测试。
3. `docs: document project management rollout`：API、架构、产品、路线图、部署、测试文档及 Trellis 计划。

在用户回复“确认提交/ok/行”后才执行 `git add` + `git commit`，不 amend、不 push；未识别的用户改动单列并排除。

## 实施完成判定

只有以下条件全部成立才可运行 `task.py finish/archive`：

1. PRD、design、implement 与 manifests 已提交且 Trellis validate 通过。
2. AC-1～AC-7 有对应自动化或人工证据，三驱动 schema 声明等价，旧库增量启动不丢数据。
3. `node --check`、`npm test`、`npm audit --omit=dev`、`git diff --check` 结果已记录；没有把未执行的云服务器操作写成完成。
4. 公共投影 allow-list、管理员会话/同源/JSON、防枚举、审计脱敏和来源删除清理均有测试。
5. 用户审阅最终差异并明确允许提交；之后再按 Trellis 3.3 检查是否需要更新 `.trellis/spec/`，最后归档任务并记录工作日志。
