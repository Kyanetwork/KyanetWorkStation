# P2 Kanban 基础能力 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变 Feedback/WorkTask 原生状态和项目关系模型的前提下，为管理员项目详情增加可读、可控、可回滚的双泳道 Kanban 视图。

**Architecture:** 继续使用 Node.js 24、CommonJS、Express、原生静态 HTML/CSS/JavaScript 与 `server/db.js` 三驱动 facade。Kanban 读取现有 `GET /api/admin/project/:id` 安全 DTO；新增一个项目范围状态写接口，由服务端校验项目、来源关系和来源专属状态后复用现有来源状态更新函数，并在状态确实变化时触碰项目 `updated_at`。

**Tech Stack:** Node.js 24 LTS、Express、`node:test`、better-sqlite3 13、MySQL 8+/mysql2、PostgreSQL/pg、原生 HTML/CSS/JavaScript；不引入 ORM、前端框架、拖拽库、迁移 runner、实时协作基础设施或新的数据库字段。

---

## 执行边界与成功标准

- 只实现 `.trellis/tasks/09-04-p2-kanban-foundation/prd.md` 与已批准设计中的 P2 Kanban 基础能力。
- Feedback 与 WorkTask 保持独立泳道和原生状态列：Feedback 为 `new/reviewed/resolved/notplanned`，WorkTask 为 `new/scheduled/in_progress/completed/cancelled`。
- 关系视图仍是项目详情默认视图，继续负责绑定、解绑和里程碑；Kanban 只负责查看已归属项和保存来源状态。
- 列内按 `updatedAt DESC, id DESC`（`id` 为项目关系记录 ID；`sourceId` 仅作异常数据的最后 fallback）的确定性顺序展示；不新增排序字段、不实现拖拽、批量或跨项目操作。
- 只有管理员能访问 Kanban 和新接口；公共项目 API/页面、AI、通知、MeowStatus、KyanetAccount 均不增加工作项或 Kanban 数据。
- 归档项目可读取 Kanban，但状态控件禁用，服务端仍以 `PROJECT_STATE_CONFLICT` 拒绝写入。
- 状态变化只更新对应 Feedback/WorkTask 和项目 `updated_at`；同值保存成功且不重复更新项目时间，里程碑关联和完成度规则不变。
- 成功和失败均写入现有管理员审计；metadata 只包含项目/来源/状态/稳定错误码等 allow-list 字段。
- 自动化验收包含 validator、SQLite 数据层、HTTP API、管理员模型、静态 UI、安全投影和全量回归；人工冒烟不把未执行的云端操作写成通过。

## 文件地图

### 修改

- `server/validation.js`：新增项目范围状态请求的组合校验和导出。
- `server/db.js`：新增 `updateProjectItemStatus`，复用来源状态更新并按实际变化更新项目时间。
- `server/app.js`：接入 `POST /api/admin/project/item/status`、错误映射和 `project.item.status` 审计。
- `public/admin/project-model.js`：增加两类来源的 Kanban 列定义、排序和安全分组。
- `public/admin/admin.js`：增加关系视图/Kanban 切换、Kanban 渲染和状态保存事件。
- `public/admin/index.html`：增加视图切换控件和 Kanban 容器，保留现有关系视图标识。
- `public/workstation.css`：增加直角冷色 Kanban 网格、卡片、禁用态和窄屏布局。
- `docs/api/reference.md`、`docs/architecture/current.md`、`docs/product/feature-status.md`、`docs/plans/roadmap.md`、`docs/operations/deployment.md`、`docs/testing/release-checklist.md`：同步接口、边界、状态和发布验收事实。

### 测试修改

- `tests/project-validation.test.js`：项目范围状态 payload 的成功、来源专属状态和非法输入。
- `tests/project-db.test.js`：状态更新、项目时间、同值、跨项目、归档、缺失来源和里程碑保持。
- `tests/project-api.test.js`：认证、400/404/409、成功响应、审计和公共边界。
- `tests/project-model.test.js`：两泳道列定义、更新时间排序、空列和未知状态安全 fallback。
- `tests/project-static-ui.test.js`：切换控件、Kanban 入口、状态保存按钮、归档禁用和无公共泄露。

## Task 1: 锁定项目范围状态输入契约

**Files:**

- Test: `tests/project-validation.test.js`
- Modify: `server/validation.js`

- [ ] **Step 1: 写失败测试，覆盖两类来源的状态组合**

在现有项目 validator 测试中加入以下用例；测试要求返回规范化数字 ID，而不是把字符串直接交给路由：

```js
const {
  validateProjectItemStatusPayload
} = require("../server/validation");

test("项目范围状态校验按来源类型接受原生状态", () => {
  assert.deepEqual(
    validateProjectItemStatusPayload({
      projectId: "3", sourceType: "feedback", sourceId: "8", status: "reviewed"
    }),
    { valid: true, data: { projectId: 3, sourceType: "feedback", sourceId: 8, status: "reviewed" } }
  );
  assert.deepEqual(
    validateProjectItemStatusPayload({
      projectId: 3, sourceType: "worktask", sourceId: 9, status: "in_progress"
    }),
    { valid: true, data: { projectId: 3, sourceType: "worktask", sourceId: 9, status: "in_progress" } }
  );
});

test("项目范围状态校验拒绝跨来源状态和非法 ID", () => {
  assert.equal(validateProjectItemStatusPayload({
    projectId: 3, sourceType: "feedback", sourceId: 8, status: "in_progress"
  }).valid, false);
  assert.equal(validateProjectItemStatusPayload({
    projectId: 3, sourceType: "worktask", sourceId: 9, status: "resolved"
  }).valid, false);
  assert.equal(validateProjectItemStatusPayload({
    projectId: 0, sourceType: "feedback", sourceId: 8, status: "new"
  }).valid, false);
  assert.equal(validateProjectItemStatusPayload({
    projectId: 3, sourceType: "other", sourceId: 8, status: "new"
  }).valid, false);
});
```

- [ ] **Step 2: 运行聚焦测试确认新导出尚不存在**

运行：`node --test tests/project-validation.test.js`

预期：新增用例失败，原因是 `validateProjectItemStatusPayload` 尚未定义或导出；已有项目校验用例保持原结果。

- [ ] **Step 3: 实现最小组合校验并导出**

在 `server/validation.js` 项目校验区域增加以下函数，复用已有 `parseProjectId`、`normalizeString`、`ALLOWED_PROJECT_SOURCE_TYPES`、`ALLOWED_STATUS` 和 `ALLOWED_WORKTASK_STATUS`，不在 `app.js` 重复状态规则：

```js
function validateProjectItemStatusPayload(payload) {
  const body = payload && typeof payload === "object" ? payload : {};
  const projectId = parseProjectId(body.projectId, "projectId");
  if (!projectId.valid) return projectId;
  const sourceType = normalizeString(body.sourceType);
  if (!ALLOWED_PROJECT_SOURCE_TYPES.has(sourceType)) {
    return { valid: false, message: "sourceType 不合法" };
  }
  const sourceId = parseProjectId(body.sourceId, "sourceId");
  if (!sourceId.valid) return sourceId;
  const status = normalizeString(body.status);
  const allowed = sourceType === "feedback" ? ALLOWED_STATUS : ALLOWED_WORKTASK_STATUS;
  if (!allowed.has(status)) {
    return { valid: false, message: sourceType === "feedback" ? "feedback status 不合法" : "worktask status 不合法" };
  }
  return {
    valid: true,
    data: { projectId: projectId.value, sourceType, sourceId: sourceId.value, status }
  };
}
```

在 `module.exports` 项目校验导出区加入 `validateProjectItemStatusPayload`。

- [ ] **Step 4: 运行测试和语法检查**

运行：`node --test tests/project-validation.test.js && node --check server/validation.js`

预期：项目 validator 全部 PASS，语法检查退出码为 0。

回滚点：若状态组合规则与设计不一致，只回退本任务新增函数和测试；不改动已有 Feedback/WorkTask validator。

## Task 2: 实现项目范围状态数据层

**Files:**

- Test: `tests/project-db.test.js`
- Modify: `server/db.js`

- [ ] **Step 1: 写失败的 SQLite 行为测试**

沿用 `tests/project-db.test.js` 的临时目录和 `loadDb`/`restoreDb` 辅助，加入以下行为断言。测试通过 `getProjectDetail` 观察项目时间和里程碑关系，通过来源 getter 观察原生状态：

```js
test("项目范围状态更新保留里程碑并同步项目更新时间", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kws-project-item-status-"));
  const db = loadDb(path.join(tempDir, "workstation.db"));
  try {
    await db.initializeDatabase();
    const projectId = await db.createProject({ name: "状态看板" });
    const milestoneId = await db.createProjectMilestone({ projectId, title: "阶段" });
    const feedbackId = await db.createFeedback(sourcePayload("反馈状态"));
    const worktaskId = await db.createWorktask({
      ...sourcePayload("任务状态"), type: "WorkTask提交", priority: "medium", expectedAt: "", tags: ""
    });
    await db.assignProjectItem({ projectId, sourceType: "feedback", sourceId: feedbackId, milestoneId });
    await db.assignProjectItem({ projectId, sourceType: "worktask", sourceId: worktaskId });
    const before = await db.getProjectDetail(projectId);

    const feedbackResult = await db.updateProjectItemStatus({
      projectId, sourceType: "feedback", sourceId: feedbackId, status: "reviewed"
    });
    assert.equal(feedbackResult.status, "reviewed");
    assert.equal((await db.getFeedbackById(feedbackId)).status, "reviewed");
    const afterChange = await db.getProjectDetail(projectId);
    assert.notEqual(afterChange.project.updatedAt, before.project.updatedAt);
    assert.equal(afterChange.items.find((item) => item.sourceId === feedbackId).milestoneId, milestoneId);

    const beforeSame = afterChange.project.updatedAt;
    const sameResult = await db.updateProjectItemStatus({
      projectId, sourceType: "feedback", sourceId: feedbackId, status: "reviewed"
    });
    assert.equal(sameResult.status, "reviewed");
    assert.equal((await db.getProjectDetail(projectId)).project.updatedAt, beforeSame);

    await db.updateProjectItemStatus({
      projectId, sourceType: "worktask", sourceId: worktaskId, status: "in_progress"
    });
    assert.equal((await db.getWorktaskById(worktaskId)).status, "in_progress");
  } finally {
    await restoreDb(db);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("项目范围状态更新拒绝跨项目、归档项目和缺失关系", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kws-project-item-status-errors-"));
  const db = loadDb(path.join(tempDir, "workstation.db"));
  try {
    await db.initializeDatabase();
    const first = await db.createProject({ name: "项目一" });
    const second = await db.createProject({ name: "项目二" });
    const archived = await db.createProject({ name: "归档项目" });
    await db.archiveProject(archived);
    const feedbackId = await db.createFeedback(sourcePayload("跨项目来源"));
    await db.assignProjectItem({ projectId: first, sourceType: "feedback", sourceId: feedbackId });

    await assert.rejects(
      () => db.updateProjectItemStatus({ projectId: second, sourceType: "feedback", sourceId: feedbackId, status: "reviewed" }),
      (error) => error && error.code === "PROJECT_ITEM_CONFLICT"
    );
    assert.equal((await db.getFeedbackById(feedbackId)).status, "new");
    await assert.rejects(
      () => db.updateProjectItemStatus({ projectId: archived, sourceType: "feedback", sourceId: feedbackId, status: "reviewed" }),
      (error) => error && error.code === "PROJECT_STATE_CONFLICT"
    );
    await assert.rejects(
      () => db.updateProjectItemStatus({ projectId: first, sourceType: "feedback", sourceId: feedbackId + 999, status: "reviewed" }),
      (error) => error && error.code === "NOT_FOUND"
    );
  } finally {
    await restoreDb(db);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
```

第二个用例须使用现有 `assert.rejects` predicate 检查 `error.code`，不得只匹配面向用户的中文 message；归档项目仍可读取但不可写，未绑定来源的状态请求为 `NOT_FOUND`。

- [ ] **Step 2: 运行聚焦测试确认 helper 尚不存在**

运行：`node --test tests/project-db.test.js`

预期：新增测试失败，原因是 `db.updateProjectItemStatus` 尚未导出；既有项目 CRUD 测试保持可运行。

- [ ] **Step 3: 在 db.js 增加安全项目状态 helper**

在 `server/db.js` 项目领域函数区域增加内部时间更新函数和公开 helper。实现要点如下：先确认项目存在且为 `active`，再读取全局唯一的 `project_item` 关系；关系存在但项目 ID 不同返回 `PROJECT_ITEM_CONFLICT`。来源缺失时沿用 `cleanupProjectItemsForSource` 的 best-effort 清理并返回 `NOT_FOUND`。只有读到的原状态与目标状态不同时才调用 `updateFeedbackStatus`/`updateWorktaskStatus` 并更新项目时间；同值路径不触碰项目时间。项目返回值只含安全摘要，不返回来源正文。

```js
async function touchProjectUpdatedAt(projectId) {
  const updatedAt = nowIso();
  const p1 = placeholder(1);
  const p2 = placeholder(2);
  await execute(
    `UPDATE project SET updated_at = ${p1} WHERE id = ${p2}`,
    [updatedAt, projectId]
  );
  return updatedAt;
}

async function updateProjectItemStatus({ projectId, sourceType, sourceId, status } = {}) {
  const normalizedProjectId = projectIdValue(projectId);
  const normalizedSourceId = projectIdValue(sourceId);
  if (!normalizedProjectId || !PROJECT_SOURCE_TYPES.has(sourceType) || !normalizedSourceId) {
    throw projectError("INVALID_PAYLOAD", "项目来源状态参数不合法");
  }
  const project = await getProjectById(normalizedProjectId);
  if (!project) throw projectError("NOT_FOUND", "项目不存在");
  if (project.status !== "active") throw projectError("PROJECT_STATE_CONFLICT", "归档项目不能更新工作项状态");

  const relation = await getProjectItemBySource({ sourceType, sourceId: normalizedSourceId });
  if (!relation) throw projectError("NOT_FOUND", "项目关联不存在");
  if (relation.projectId !== normalizedProjectId) {
    throw projectError("PROJECT_ITEM_CONFLICT", "该来源不属于当前项目");
  }

  const source = sourceType === "feedback"
    ? await getFeedbackById(normalizedSourceId)
    : await getWorktaskById(normalizedSourceId);
  if (!source) {
    await cleanupProjectItemsForSource({ sourceType, sourceId: normalizedSourceId });
    throw projectError("NOT_FOUND", "来源记录不存在");
  }

  const changed = source.status !== status;
  if (changed) {
    const changes = sourceType === "feedback"
      ? await updateFeedbackStatus(normalizedSourceId, status)
      : await updateWorktaskStatus(normalizedSourceId, status);
    if (changes === 0) throw projectError("NOT_FOUND", "来源记录不存在");
  }
  const projectUpdatedAt = changed
    ? await touchProjectUpdatedAt(normalizedProjectId)
    : project.updatedAt;
  return {
    projectItemId: relation.id,
    projectId: normalizedProjectId,
    sourceType,
    sourceId: normalizedSourceId,
    status,
    projectUpdatedAt
  };
}
```

在 `module.exports` 中导出 `updateProjectItemStatus`。状态合法性由 Task 1 的组合 validator 负责；helper 仍拒绝非法项目/来源类型和 ID，避免被未来内部调用绕过项目边界。

- [ ] **Step 4: 运行数据层回归和语法检查**

运行：`node --test tests/project-db.test.js tests/backup-sqlite.test.js && node --check server/db.js`

预期：项目状态 helper、旧项目 schema/孤儿清理和 SQLite 备份测试 PASS；没有外部数据库连接时仍通过三驱动静态 schema 断言。

回滚点：若单实例双写顺序需要调整，只回退 helper 和新增测试；不删除三张项目表、不增加迁移、不改变普通状态接口。

## Task 3: 接入管理员 API 与审计

**Files:**

- Test: `tests/project-api.test.js`
- Modify: `server/app.js`

- [ ] **Step 1: 先补 HTTP 失败用例**

在现有项目 API 流程中，创建并绑定一个 Feedback 和一个 WorkTask 后加入以下断言：

```js
const invalidStatus = await jsonRequest(server.baseUrl, "/api/admin/project/item/status", {
  method: "POST", headers, body: { projectId, sourceType: "feedback", sourceId: feedbackId, status: "in_progress" }
});
assert.equal(invalidStatus.response.status, 400);
assert.equal(invalidStatus.data.error.code, "INVALID_PAYLOAD");

const before = await jsonRequest(server.baseUrl, `/api/admin/project/${projectId}`, { headers });
const changed = await jsonRequest(server.baseUrl, "/api/admin/project/item/status", {
  method: "POST", headers, body: { projectId, sourceType: "feedback", sourceId: feedbackId, status: "reviewed" }
});
assert.equal(changed.response.status, 200);
assert.deepEqual(Object.keys(changed.data.data).sort(), [
  "projectId", "projectUpdatedAt", "sourceId", "sourceType", "status"
].sort());
assert.deepEqual(
  { projectId: changed.data.data.projectId, sourceType: changed.data.data.sourceType, sourceId: changed.data.data.sourceId, status: changed.data.data.status },
  { projectId, sourceType: "feedback", sourceId: feedbackId, status: "reviewed" }
);
const after = await jsonRequest(server.baseUrl, `/api/admin/project/${projectId}`, { headers });
assert.equal(after.data.data.items.find((item) => item.sourceId === feedbackId).status, "reviewed");
assert.notEqual(after.data.data.project.updatedAt, before.data.data.project.updatedAt);

const beforeSame = after.data.data.project.updatedAt;
const same = await jsonRequest(server.baseUrl, "/api/admin/project/item/status", {
  method: "POST", headers, body: { projectId, sourceType: "feedback", sourceId: feedbackId, status: "reviewed" }
});
assert.equal(same.response.status, 200);
const afterSame = await jsonRequest(server.baseUrl, `/api/admin/project/${projectId}`, { headers });
assert.equal(afterSame.data.data.project.updatedAt, beforeSame);
```

同时断言匿名请求为 401、来源属于另一个项目为 409 `PROJECT_ITEM_CONFLICT`、归档项目为 409 `PROJECT_STATE_CONFLICT`、未绑定关系为 404 `NOT_FOUND`，并在 `project_item` 审计查询中找到 `project.item.status`。审计 metadata 只允许 `projectId/sourceType/sourceId/status/errorCode`，不得出现正文、联系方式、URL 或 API key。

- [ ] **Step 2: 运行 API 测试确认路由尚不存在**

运行：`node --test tests/project-api.test.js`

预期：新接口请求返回现有 404，或 app import 尚未提供 helper；原有项目 API 流程仍保持通过。

- [ ] **Step 3: 接入校验、数据库 helper 和审计**

在 `server/app.js` 顶部数据库解构中加入 `updateProjectItemStatus`，validation 解构中加入 `validateProjectItemStatusPayload`。在 `/api/admin/project/item/update` 与 `/api/admin/project/item/unassign` 之间新增路由，保持 `/api/admin` 已有会话、同源、JSON 和限流中间件：

```js
app.post("/api/admin/project/item/status", requireAdminSession, asyncHandler(async (req, res) => {
  const validation = validateProjectItemStatusPayload(req.body || {});
  if (!validation.valid) return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  const input = validation.data;
  try {
    const result = await updateProjectItemStatus(input);
    const { projectItemId, ...safeData } = result;
    await recordAdminAction(req, "project.item.status", "project_item", projectItemId, "success", input);
    return res.json({ ok: true, data: safeData });
  } catch (error) {
    await recordAdminAction(req, "project.item.status", "project_item", null, auditResultForError(error), {
      ...input,
      errorCode: error && error.code ? error.code : "PROJECT_ITEM_STATUS_FAILED"
    });
    return sendProjectError(res, error);
  }
}));
```

`sendProjectError` 增加“归档项目不能更新工作项状态”的统一用户提示，但继续使用 `PROJECT_STATE_CONFLICT`；不要在路由中模拟调用普通 Feedback/WorkTask HTTP 接口。

- [ ] **Step 4: 运行 API、审计和语法检查**

运行：`node --test tests/project-api.test.js tests/admin-audit.test.js && node --check server/app.js`

预期：所有项目 HTTP 错误码、同值时间、审计脱敏和既有管理路由 PASS。

回滚点：若新路由错误映射不正确，只移除新增路由/导入和测试；普通 `/api/admin/feedback/status`、`/api/admin/worktask/status` 保持原语义。

## Task 4: 建立 Kanban 前端模型

**Files:**

- Test: `tests/project-model.test.js`
- Modify: `public/admin/project-model.js`

- [ ] **Step 1: 写模型失败测试**

加入以下测试，覆盖固定列、空列、同时间 ID 排序和异常状态：

```js
test("Kanban 模型保留两条原生状态泳道并按更新时间降序", () => {
  const lanes = model.buildKanbanLanes([
    { id: 20, sourceType: "feedback", sourceId: 2, title: "旧", status: "new", updatedAt: "2030-01-01T00:00:00.000Z" },
    { id: 10, sourceType: "feedback", sourceId: 3, title: "新", status: "new", updatedAt: "2030-01-02T00:00:00.000Z" },
    { id: 30, sourceType: "feedback", sourceId: 4, title: "同日", status: "new", updatedAt: "2030-01-01T00:00:00.000Z" },
    { sourceType: "worktask", sourceId: 4, title: "任务", status: "in_progress", updatedAt: "2030-01-01T00:00:00.000Z" },
    { sourceType: "feedback", sourceId: 9, title: "未知", status: "unexpected", updatedAt: "2030-01-03T00:00:00.000Z" }
  ]);
  assert.deepEqual(lanes.feedback.columns.map((column) => column.status), ["new", "reviewed", "resolved", "notplanned"]);
  assert.deepEqual(lanes.worktask.columns.map((column) => column.status), ["new", "scheduled", "in_progress", "completed", "cancelled"]);
  assert.deepEqual(lanes.feedback.columns[0].items.map((item) => item.sourceId), [3, 4, 2]);
  assert.deepEqual(lanes.worktask.columns.find((column) => column.status === "in_progress").items.map((item) => item.sourceId), [4]);
  assert.deepEqual(lanes.feedback.unknown.map((item) => item.sourceId), [9]);
  assert.equal(lanes.worktask.columns.find((column) => column.status === "completed").items.length, 0);
});
```

- [ ] **Step 2: 运行模型测试确认新函数不存在**

运行：`node --test tests/project-model.test.js`

预期：新增用例因 `buildKanbanLanes` 尚未导出而失败。

- [ ] **Step 3: 增加单一列定义和安全分组函数**

在 `public/admin/project-model.js` 中以一个常量作为两类来源的列定义，并导出 `KANBAN_STATUS_COLUMNS`、`buildKanbanLanes`。函数先复用 `normalizeItem`，以 `Date.parse(updatedAt)` 比较时间，无法解析时按 0 处理，再用关系 `id` 降序打破平局（`sourceId` 作为最后 fallback）；未知状态放入 `unknown`，不阻塞正常列渲染：

```js
const KANBAN_STATUS_COLUMNS = Object.freeze({
  feedback: Object.freeze(["new", "reviewed", "resolved", "notplanned"]),
  worktask: Object.freeze(["new", "scheduled", "in_progress", "completed", "cancelled"])
});

function compareKanbanItems(left, right) {
  const leftTime = Date.parse(left.updatedAt);
  const rightTime = Date.parse(right.updatedAt);
  const safeLeft = Number.isFinite(leftTime) ? leftTime : 0;
  const safeRight = Number.isFinite(rightTime) ? rightTime : 0;
  return safeRight - safeLeft || right.id - left.id || right.sourceId - left.sourceId;
}

function buildKanbanLanes(items) {
  const result = {};
  for (const sourceType of ["feedback", "worktask"]) {
    const columns = KANBAN_STATUS_COLUMNS[sourceType].map((status) => ({ status, items: [] }));
    const byStatus = new Map(columns.map((column) => [column.status, column]));
    const unknown = [];
    for (const raw of Array.isArray(items) ? items : []) {
      const item = normalizeItem(raw);
      if (!item || item.sourceType !== sourceType) continue;
      const target = byStatus.get(item.status);
      (target ? target.items : unknown).push(item);
    }
    for (const column of columns) column.items.sort(compareKanbanItems);
    unknown.sort(compareKanbanItems);
    result[sourceType] = { sourceType, columns, unknown };
  }
  return result;
}
```

保持已有 `splitProjectItems` 给关系视图使用，不让 Kanban 模型改变绑定/里程碑排序。

- [ ] **Step 4: 运行模型测试和语法检查**

运行：`node --test tests/project-model.test.js && node --check public/admin/project-model.js`

预期：模型默认值、hash、关系泳道和 Kanban 分组测试全部 PASS。

回滚点：模型异常时只回退新增常量/函数；关系视图继续调用原有 `splitProjectItems`。

## Task 5: 管理员视图切换、Kanban 渲染和状态保存

**Files:**

- Test: `tests/project-static-ui.test.js`
- Modify: `public/admin/index.html`
- Modify: `public/admin/admin.js`
- Modify: `public/workstation.css`

- [ ] **Step 1: 先补静态失败断言**

在 `tests/project-static-ui.test.js` 增加断言：管理员 HTML 有 `projectRelationsView`、`projectKanbanView`、`projectRelationsViewBtn`、`projectKanbanViewBtn`、`projectKanbanBoard`；两个切换按钮都是 `type="button"` 并含 `aria-pressed`；管理员脚本包含 `buildKanbanLanes`、`project-kanban-status-save` 和 `/api/admin/project/item/status`；公共页面脚本不出现这些管理员 Kanban 标识。

- [ ] **Step 2: 运行静态测试确认入口不存在**

运行：`node --test tests/project-static-ui.test.js`

预期：新增 ID/endpoint 断言失败，既有项目页面断言保持通过。

- [ ] **Step 3: 增加 HTML 视图容器并保留关系视图**

在 `public/admin/index.html` 项目详情中，里程碑和两条关系泳道外包一层：

```html
<div class="project-view-switch" role="group" aria-label="项目详情视图">
  <button id="projectRelationsViewBtn" class="tab active" type="button" aria-pressed="true">关系视图</button>
  <button id="projectKanbanViewBtn" class="tab" type="button" aria-pressed="false">Kanban</button>
</div>
<div id="projectRelationsView">
  <!-- 现有 project-subsection：里程碑、Feedback 泳道、WorkTask 泳道原样保留 -->
</div>
<section id="projectKanbanView" class="project-kanban hidden" aria-labelledby="projectKanbanTitle">
  <div class="subsection-head">
    <h4 id="projectKanbanTitle">Kanban</h4>
    <span class="meta">按来源原生状态分列；保存状态后会刷新项目更新时间</span>
  </div>
  <div id="projectKanbanBoard" aria-live="polite"></div>
</section>
```

不要移动或重命名 `projectMilestoneList`、`projectFeedbackLane`、`projectWorktaskLane` 和候选面板，确保关系视图已有事件委托不受影响。

- [ ] **Step 4: 在 admin.js 增加短生命周期视图状态和渲染**

在 `state.projects` 增加 `projectView: "relations"`，退出登录、关闭详情或打开新项目时恢复 `relations`。新增 `setProjectView(view)` 只接受 `relations/kanban`，同步两个按钮的 `aria-pressed`、active class 和容器 `hidden`；`renderProjectDetail` 末尾调用它而不是改变默认值。

新增渲染函数时只使用模型归一化字段；动态标题、负责人、时间和优先级都经过 `escapeHtml`，正文/联系方式/备注/账号快照不进入模板。每张卡片使用固定状态选项、明确保存按钮和内部 data attributes：

```js
function renderProjectKanban(detail) {
  const board = document.getElementById("projectKanbanBoard");
  if (!board) return;
  const lanes = projectModel.buildKanbanLanes(detail.items);
  const readonly = detail.project.status === "archived";
  const renderCard = (item, statuses) => `<article class="project-kanban-card">
    <div class="project-kanban-card-head"><strong>${escapeHtml(item.title || "未命名工作项")}</strong><span class="meta">${escapeHtml(item.sourceType === "feedback" ? "Feedback" : "WorkTask")}</span></div>
    <p class="meta">更新于 ${escapeHtml(formatDateTimeDisplay(item.updatedAt))}</p>
    ${item.sourceType === "worktask" && (item.priority || item.assignee || item.scheduledAt || item.expectedAt)
      ? `<p class="meta">${escapeHtml([item.priority && `优先级：${item.priority}`, item.assignee && `负责人：${item.assignee}`, item.scheduledAt && `计划：${formatDateTimeDisplay(item.scheduledAt)}`, item.expectedAt && `期望：${formatDateTimeDisplay(item.expectedAt)}`].filter(Boolean).join(" · "))}</p>`
      : ""}
    <div class="project-kanban-card-ops">
      <label>状态<select data-action-field="kanban-status" ${readonly ? "disabled" : ""}>${statuses.map((status) => `<option value="${status}"${status === item.status ? " selected" : ""}>${escapeHtml(projectKanbanStatusLabel(item.sourceType, status))}</option>`).join("")}</select></label>
      <button class="primary" type="button" data-action="project-kanban-status-save" data-source-type="${escapeHtml(item.sourceType)}" data-source-id="${item.sourceId}" ${readonly ? "disabled" : ""}>保存状态</button>
    </div>
  </article>`;
  board.innerHTML = ["feedback", "worktask"].map((sourceType) => {
    const lane = lanes[sourceType];
    const columns = lane.columns.map((column) => `<section class="project-kanban-column"><h5>${escapeHtml(projectKanbanStatusLabel(sourceType, column.status))}<span>${column.items.length}</span></h5>${column.items.length ? column.items.map((item) => renderCard(item, projectModel.KANBAN_STATUS_COLUMNS[sourceType])).join("") : `<p class="meta">暂无工作项</p>`}</section>`).join("");
    const unknown = lane.unknown.length ? `<section class="project-kanban-column is-unknown"><h5>未知状态<span>${lane.unknown.length}</span></h5>${lane.unknown.map((item) => renderCard(item, projectModel.KANBAN_STATUS_COLUMNS[sourceType])).join("")}</section>` : "";
    return `<section class="project-kanban-lane"><div class="subsection-head"><h4>${escapeHtml(sourceType === "feedback" ? "Feedback" : "WorkTask")}</h4><span class="meta">${lane.columns.reduce((count, column) => count + column.items.length, 0)} 个工作项</span></div><div class="project-kanban-grid">${columns}${unknown}</div></section>`;
  }).join("");
}
```

`projectKanbanStatusLabel` 只从固定对象读取中英文标签；未知状态显示“未知状态”而不把未验证值写入 option。卡片按钮事件放进现有 `handleProjectAction`：从最近卡片读取 `data-source-type/source-id` 和 select 值，调用 `/api/admin/project/item/status`，通过既有 `projectWrite`/`withButtonBusy` 刷新详情；失败时不调用刷新，因此保留 select 当前选择并显示 API 错误。成功后 `renderProjectDetail` 保留 Kanban 视图。

- [ ] **Step 5: 增加直角冷色响应式样式**

在 `public/workstation.css` 项目样式区域加入 `.project-view-switch`、`.project-kanban-board`、`.project-kanban-lane`、`.project-kanban-grid`、`.project-kanban-column`、`.project-kanban-card` 和 `.project-kanban-card-ops`。使用现有 `--ws-*` 变量、`border-radius: 0`、可见 `:focus-visible`，桌面多列、760px 以下横向可读滚动、620px 以下纵向堆叠；归档卡片使用 disabled/opacity 而不是仅颜色表达。不要在页面 style 中引入圆角或新调色板。

- [ ] **Step 6: 运行静态检查**

运行：

```powershell
node --test tests/project-static-ui.test.js tests/project-model.test.js
node --check public/admin/admin.js
node --check public/admin/project-model.js
git diff --check
```

预期：管理员入口、模型、按钮 type、转义和空列测试 PASS；两个页面脚本语法正确，无空白错误。

回滚点：若 Kanban UI 破坏关系视图，隐藏 `projectKanbanView` 并保留 `projectView="relations"` 即可回滚前端，不需要数据库操作。

## Task 6: 同步接口、架构、产品和发布文档

**Files:**

- Modify: `docs/api/reference.md`
- Modify: `docs/architecture/current.md`
- Modify: `docs/product/feature-status.md`
- Modify: `docs/plans/roadmap.md`
- Modify: `docs/operations/deployment.md`
- Modify: `docs/testing/release-checklist.md`

- [ ] **Step 1: 更新 API reference**

在“管理员项目管理”表中加入 `POST /api/admin/project/item/status`，写明请求 `{projectId, sourceType, sourceId, status}`、来源专属状态集合、成功响应省略关系内部 ID、项目时间字段和四类错误（400 `INVALID_PAYLOAD`、404 `NOT_FOUND`、409 `PROJECT_ITEM_CONFLICT`/`PROJECT_STATE_CONFLICT`）。注明公共项目接口和页面不返回 Kanban/工作项。

- [ ] **Step 2: 更新架构与产品路线**

在 `docs/architecture/current.md` 增加数据流：管理员项目详情 DTO → `project-model.js` 双泳道分组；状态保存 → validator → `updateProjectItemStatus` → 来源更新/项目时间 → 审计 → 详情重读。明确无 schema 变化、无跨驱动事务声明、同值不触碰项目时间。将 `docs/product/feature-status.md` 的 Kanban 从计划改为“基础能力实现/P2”，并把子任务、依赖、拖拽、批量、公共 Kanban 和新 Account 联动保留在延期项。

- [ ] **Step 3: 更新 roadmap、部署和 release checklist**

将 `docs/plans/roadmap.md` 的 P2-1 拆分为“项目基础 + Kanban 基础已实现”，保留后续复杂协作能力为独立任务；在 `docs/operations/deployment.md` 加入备份 → Git 同步 → `npm ci --omit=dev`/better-sqlite3 探针 → PM2 重启 → health → 管理员 Kanban 冒烟的顺序，说明 `.env`、数据库和 PM2 cwd 保留规则；在 `docs/testing/release-checklist.md` 加入两泳道、原生状态列、同值时间、归档禁写、审计脱敏、公共投影无工作项和亮暗主题/窄屏/键盘验收项。文档只记录实际执行的证据，未执行云端步骤使用待执行描述而不是通过结论。

- [ ] **Step 4: 运行文档/空白检查**

运行：`git diff --check`，并用 `rg -n "project/item/status|Kanban|PROJECT_STATE_CONFLICT" docs` 确认 API、架构、发布和测试文档的路径/错误码一致。

回滚点：文档描述落后于代码时先修正事实，不通过删除历史记录掩盖差异；不改动用户生产 `.env`、数据库或代理配置。

## Task 7: 全量质量门禁、Trellis 校验和人工冒烟

**Files:**

- Verify: all changed `server/*.js`, `public/admin/*.js`, `tests/*.test.js`
- Verify: `.trellis/tasks/09-04-p2-kanban-foundation/*`

- [ ] **Step 1: 运行变更脚本语法检查**

运行：

```powershell
git diff --name-only -- '*.js' | ForEach-Object { node --check $_ }
```

预期：所有变更 JavaScript 退出码为 0。

- [ ] **Step 2: 运行全量测试和依赖审计**

运行：`npm test`、`npm audit --omit=dev`、`git diff --check`。

预期：Node 24 全量测试通过；若 better-sqlite3 ABI 与当前运行时不匹配，按现有发布规范在同一 Node 24 运行时重建并记录，不将阻塞伪报为通过。

- [ ] **Step 3: 执行管理员/公共页面人工冒烟**

使用临时 SQLite 和测试管理员验证：登录 → 活跃项目详情默认关系视图 → 绑定 Feedback/WorkTask → 切换 Kanban → 两条泳道和所有原生列 → 状态保存后卡片移动、项目更新时间变化、里程碑不变 → 同值保存时间不变 → 归档项目可读但控件禁用且接口 409 → 错误项目/状态不改变来源 → 公共项目列表/详情无 Kanban、工作项、正文、联系方式或内部 ID。检查亮/暗主题、620px 窄屏、Tab 焦点、空列、按钮 busy/恢复和中文长标题。

- [ ] **Step 4: 运行 Trellis validate 并逐项审阅**

运行：`python ./.trellis/scripts/task.py validate .trellis/tasks/09-04-p2-kanban-foundation`、`git status --short`。逐项对照 PRD 的权限、来源独立、状态列、排序、错误、审计、公共边界和不新增 schema 要求；确认工作区没有不属于本任务的修改。

- [ ] **Step 5: 准备一次性提交计划**

质量门禁通过后，按仓库近期 `feat:`/`test:`/`docs:` 风格向用户展示分组提交计划；在用户回复“确认提交/ok/行”前不执行 `git commit`，不自动 `git push`。若实现失败，优先回滚应用代码，保留无 schema 变化的数据库状态。

## 完成判定

只有以下条件同时满足，才可进入 Trellis Phase 3：

1. `prd.md`、`design.md`、本计划、`implement.md` 和两个 context manifest 均已保存并通过 `task.py validate`。
2. 自动化测试覆盖两类来源、状态集合、项目时间、同值、归档、跨项目、缺失关系、审计和前端模型/静态入口。
3. `node --check`、`npm test`、`npm audit --omit=dev`、`git diff --check` 结果真实记录；云端人工冒烟未执行时明确标注。
4. 公共 API/页面仍只返回原有 allow-list，未引入 AI、通知、Account、ORM、前端框架或 schema 迁移。
5. 用户审阅差异并确认提交后，才按 Trellis 3.3 检查是否需要更新 `.trellis/spec/`，再提交、归档任务和记录工作日志。
