const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const BetterSqlite3 = require("better-sqlite3");

const ROOT = path.resolve(__dirname, "..");
const DB_PATH = path.join(ROOT, "server", "db.js");
const CONFIG_PATH = path.join(ROOT, "server", "config.js");

function loadDb(file) {
  process.env.DB_CLIENT = "sqlite";
  process.env.DB_PATH = file;
  delete require.cache[CONFIG_PATH];
  delete require.cache[DB_PATH];
  return require(DB_PATH);
}

function restoreDb(db) {
  return db.closeDatabase().finally(() => {
    delete require.cache[CONFIG_PATH];
    delete require.cache[DB_PATH];
  });
}

function sourcePayload(title) {
  return {
    type: "Bug",
    title,
    content: `${title} content`,
    contact: "private@example.com",
    images: []
  };
}

test("三驱动 schema 声明包含相同项目表、唯一来源约束和查询索引", () => {
  const db = loadDb(path.join(os.tmpdir(), "kws-project-schema-unused.db"));
  try {
    const statements = [db.sqliteSchemaStatements(), db.mysqlSchemaStatements(), db.postgresSchemaStatements()];
    for (const schema of statements) {
      const sql = schema.join("\n").toLowerCase();
      for (const table of ["project", "project_milestone", "project_item"]) {
        assert.match(sql, new RegExp(`create table if not exists ${table}`));
      }
      assert.match(sql, /public_items/);
      assert.match(sql, /public_visible/);
      assert.match(sql, /source_type[\s\S]{0,200}source_id/);
      assert.match(sql, /idx_project_status_updated/);
      assert.match(sql, /idx_project_milestone_project/);
      assert.match(sql, /idx_project_item_project/);
    }
  } finally {
    fs.rmSync(path.join(os.tmpdir(), "kws-project-schema-unused.db"), { force: true });
  }
});

test("旧 SQLite 项目表初始化时幂等补充公开字段并保持默认关闭", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kws-project-migration-"));
  const file = path.join(tempDir, "legacy.db");
  const legacy = new BetterSqlite3(file);
  legacy.exec(`
    CREATE TABLE project (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      public_basic INTEGER NOT NULL DEFAULT 0,
      public_milestones INTEGER NOT NULL DEFAULT 0,
      public_updated_at INTEGER NOT NULL DEFAULT 0,
      public_completion INTEGER NOT NULL DEFAULT 0,
      completion_mode TEXT NOT NULL DEFAULT 'auto',
      custom_completion INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE project_item (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      source_type TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      milestone_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(source_type, source_id)
    );
    INSERT INTO project (public_key, name, description, created_at, updated_at)
      VALUES ('legacy-project-key', '旧项目', '', '2030-01-01T00:00:00.000Z', '2030-01-01T00:00:00.000Z');
    INSERT INTO project_item (project_id, source_type, source_id, created_at, updated_at)
      VALUES (1, 'feedback', 99, '2030-01-01T00:00:00.000Z', '2030-01-01T00:00:00.000Z');
  `);
  legacy.close();
  const db = loadDb(file);
  try {
    await db.initializeDatabase();
    await db.initializeDatabase();
    const sqlite = new BetterSqlite3(file, { readonly: true });
    const projectColumns = sqlite.prepare("PRAGMA table_info(project)").all().map((row) => row.name);
    const itemColumns = sqlite.prepare("PRAGMA table_info(project_item)").all().map((row) => row.name);
    assert.ok(projectColumns.includes("public_items"));
    assert.ok(itemColumns.includes("public_visible"));
    assert.equal(sqlite.prepare("SELECT public_items FROM project WHERE public_key = 'legacy-project-key'").get().public_items, 0);
    assert.equal(sqlite.prepare("SELECT public_visible FROM project_item WHERE project_id = 1 AND source_id = 99").get().public_visible, 0);
    sqlite.close();
  } finally {
    await restoreDb(db);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("项目公开工作项按总开关和逐条状态返回脱敏更新时间投影", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kws-public-project-items-"));
  const file = path.join(tempDir, "workstation.db");
  const db = loadDb(file);
  try {
    await db.initializeDatabase();
    const projectId = await db.createProject({
      name: "公开工作项项目",
      description: "公开说明",
      publicBasic: true,
      publicItems: false
    });
    const project = await db.getProjectById(projectId);
    const feedbackId = await db.createFeedback(sourcePayload("公开反馈"));
    const worktaskId = await db.createWorktask({
      ...sourcePayload("公开任务"),
      type: "WorkTask提交",
      priority: "high",
      expectedAt: "",
      tags: ""
    });
    await db.assignProjectItem({ projectId, sourceType: "feedback", sourceId: feedbackId });
    await db.assignProjectItem({ projectId, sourceType: "worktask", sourceId: worktaskId });

    const hiddenByProject = await db.getPublicProjectByKey(project.publicKey);
    assert.equal(hiddenByProject.items, undefined);

    const visibleAt = (await db.getProjectById(projectId)).updatedAt;
    const hiddenRelation = await db.updateProjectItemVisibility({
      projectId, sourceType: "feedback", sourceId: feedbackId, publicVisible: false
    });
    assert.equal(hiddenRelation.publicVisible, false);
    assert.equal(hiddenRelation.projectUpdatedAt, visibleAt);

    await db.updateFeedbackNoteReply(feedbackId, "管理员备注", "已公开回复");
    await db.updateWorktaskNoteReply(worktaskId, "任务备注", "任务公开回复");
    await db.updateProject({ id: projectId, publicItems: true });
    const feedbackVisible = await db.updateProjectItemVisibility({
      projectId, sourceType: "feedback", sourceId: feedbackId, publicVisible: true
    });
    assert.equal(feedbackVisible.publicVisible, true);
    assert.notEqual(feedbackVisible.projectUpdatedAt, visibleAt);

    const publicDetail = await db.getPublicProjectByKey(project.publicKey);
    assert.deepEqual(publicDetail.items.worktask, []);
    assert.equal(publicDetail.items.feedback.length, 1);
    assert.deepEqual(publicDetail.items.feedback[0], {
      sourceType: "feedback",
      title: "公开反馈",
      status: "new",
      publicReply: "已公开回复",
      updatedAt: publicDetail.items.feedback[0].updatedAt
    });
    assert.equal(publicDetail.items.feedback[0].id, undefined);
    assert.equal(publicDetail.items.feedback[0].content, undefined);
    assert.equal(publicDetail.items.feedback[0].contact, undefined);
    assert.equal(publicDetail.items.feedback[0].adminNote, undefined);

    const worktaskVisible = await db.updateProjectItemVisibility({
      projectId, sourceType: "worktask", sourceId: worktaskId, publicVisible: true
    });
    assert.equal(worktaskVisible.publicVisible, true);
    const bothVisible = await db.getPublicProjectByKey(project.publicKey);
    assert.equal(bothVisible.items.worktask[0].sourceType, "worktask");
    assert.equal(bothVisible.items.worktask[0].title, "公开任务");
    assert.equal(bothVisible.items.worktask[0].publicReply, "任务公开回复");
    assert.equal(bothVisible.items.worktask[0].priority, undefined);

    await db.updateProject({ id: projectId, publicItems: false });
    assert.equal((await db.getPublicProjectByKey(project.publicKey)).items, undefined);
  } finally {
    await restoreDb(db);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("项目 CRUD、里程碑排序/完成度和公开 projection 可重复初始化", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kws-project-db-"));
  const file = path.join(tempDir, "workstation.db");
  const db = loadDb(file);
  try {
    await db.initializeDatabase();
    await db.initializeDatabase();
    const sqlite = new BetterSqlite3(file, { readonly: true });
    for (const table of ["project", "project_milestone", "project_item"]) {
      assert.ok(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
    }
    sqlite.close();

    const projectId = await db.createProject({
      name: "个人工作站",
      description: "公开说明",
      publicBasic: true,
      publicMilestones: true,
      publicUpdatedAt: true,
      publicCompletion: true
    });
    assert.ok(projectId > 0);
    const project = await db.getProjectById(projectId);
    assert.equal(project.name, "个人工作站");
    assert.equal(project.status, "active");
    assert.match(project.publicKey, /^[0-9a-f-]{36}$/i);

    const archivedProjectId = await db.createProject({ name: "已归档项目" });
    await db.archiveProject(archivedProjectId);
    const allProjects = await db.listProjects({ status: "all", page: 1, pageSize: 20 });
    assert.equal(allProjects.total, 2);
    assert.deepEqual(new Set(allProjects.items.map((item) => item.status)), new Set(["active", "archived"]));
    const activeProjects = await db.listProjects({ status: "active", page: 1, pageSize: 20 });
    assert.equal(activeProjects.total, 1);

    const milestoneA = await db.createProjectMilestone({
      projectId,
      title: "第二阶段",
      targetDate: "2030-02-01",
      sortOrder: 20
    });
    const milestoneB = await db.createProjectMilestone({
      projectId,
      title: "第一阶段",
      isCompleted: true,
      sortOrder: 10
    });
    const detail = await db.getProjectDetail(projectId);
    assert.deepEqual(detail.milestones.map((item) => item.id), [milestoneB, milestoneA]);
    assert.equal(detail.project.completion, 50);

    const publicList = await db.listPublicProjects();
    assert.equal(publicList.items.length, 1);
    assert.equal(publicList.items[0].id, undefined);
    const publicDetail = await db.getPublicProjectByKey(project.publicKey);
    assert.equal(publicDetail.name, "个人工作站");
    assert.equal(publicDetail.milestones.length, 2);
    assert.deepEqual(publicDetail.completion, { value: 50 });
    assert.equal(publicDetail.id, undefined);

    await db.updateProject({ id: projectId, completionMode: "custom", customCompletion: 88 });
    assert.equal((await db.getProjectById(projectId)).completion, 88);
    await db.updateProject({ id: projectId, completionMode: "auto", customCompletion: null });
    assert.equal((await db.getProjectById(projectId)).completion, 50);

    const feedbackId = await db.createFeedback(sourcePayload("反馈一"));
    const worktaskId = await db.createWorktask({
      ...sourcePayload("任务一"),
      type: "WorkTask提交",
      priority: "medium",
      expectedAt: "",
      tags: ""
    });
    const feedbackItem = await db.assignProjectItem({ projectId, sourceType: "feedback", sourceId: feedbackId, milestoneId: milestoneB });
    const worktaskItem = await db.assignProjectItem({ projectId, sourceType: "worktask", sourceId: worktaskId });
    assert.equal(feedbackItem.milestoneId, milestoneB);
    assert.equal(worktaskItem.sourceType, "worktask");
    await assert.rejects(
      () => db.assignProjectItem({ projectId, sourceType: "feedback", sourceId: feedbackId }),
      (error) => error && error.code === "PROJECT_ITEM_CONFLICT"
    );
    await db.revokeProjectMilestone(milestoneB);
    const afterRevoke = await db.getProjectDetail(projectId);
    assert.equal(afterRevoke.items.find((item) => item.sourceId === feedbackId).milestoneId, null);
    assert.equal(afterRevoke.project.completion, 0);
    await db.restoreProjectMilestone(milestoneB);
    assert.equal((await db.getProjectDetail(projectId)).items.find((item) => item.sourceId === feedbackId).milestoneId, null);

    await db.archiveProject(projectId);
    assert.equal(await db.archiveProject(projectId), 1);
    assert.equal((await db.listProjects({ status: "all" })).total, 2);
    await assert.rejects(
      () => db.createProjectMilestone({ projectId, title: "禁止新增" }),
      (error) => error && error.code === "PROJECT_STATE_CONFLICT"
    );
    await db.restoreProject(projectId);
    assert.equal(await db.restoreProject(projectId), 1);
    await db.unassignProjectItem({ projectId, sourceType: "worktask", sourceId: worktaskId });
    assert.equal(await db.getProjectItemBySource({ sourceType: "worktask", sourceId: worktaskId }), null);
    await db.deleteFeedback(feedbackId);
    assert.equal(await db.getProjectItemBySource({ sourceType: "feedback", sourceId: feedbackId }), null);
  } finally {
    await restoreDb(db);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("里程碑撤销在状态更新无变化时仍会清理遗留关联", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kws-project-milestone-idempotent-"));
  const file = path.join(tempDir, "workstation.db");
  const db = loadDb(file);
  let raw;
  try {
    await db.initializeDatabase();
    const projectId = await db.createProject({ name: "幂等撤销" });
    const milestoneId = await db.createProjectMilestone({ projectId, title: "阶段" });
    const feedbackId = await db.createFeedback(sourcePayload("遗留关联"));
    await db.assignProjectItem({ projectId, sourceType: "feedback", sourceId: feedbackId, milestoneId });

    raw = new BetterSqlite3(file);
    // Simulate a driver that reports no affected row for an idempotent status
    // update while the status itself has already reached the requested value.
    raw.exec(`CREATE TRIGGER project_milestone_idempotent_update
      BEFORE UPDATE OF status ON project_milestone
      WHEN OLD.id = ${milestoneId}
      BEGIN
        UPDATE project_milestone SET status = NEW.status, updated_at = NEW.updated_at WHERE id = OLD.id;
        SELECT RAISE(IGNORE);
      END`);

    assert.equal(await db.revokeProjectMilestone(milestoneId), 1);
    const row = raw.prepare("SELECT status FROM project_milestone WHERE id = ?").get(milestoneId);
    const item = raw.prepare("SELECT milestone_id FROM project_item WHERE source_id = ?").get(feedbackId);
    assert.equal(row.status, "revoked");
    assert.equal(item.milestone_id, null);
  } finally {
    if (raw) raw.close();
    await restoreDb(db);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("项目范围状态更新同步来源和项目时间并保留里程碑", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kws-project-item-status-"));
  const file = path.join(tempDir, "workstation.db");
  const db = loadDb(file);
  let raw;
  try {
    await db.initializeDatabase();
    const projectId = await db.createProject({ name: "状态看板项目" });
    const milestoneId = await db.createProjectMilestone({ projectId, title: "保留阶段" });
    const feedbackId = await db.createFeedback(sourcePayload("待处理反馈"));
    const worktaskId = await db.createWorktask({
      ...sourcePayload("待处理任务"),
      type: "WorkTask提交",
      priority: "high",
      expectedAt: "",
      tags: ""
    });
    const feedbackItem = await db.assignProjectItem({ projectId, sourceType: "feedback", sourceId: feedbackId, milestoneId });
    const worktaskItem = await db.assignProjectItem({ projectId, sourceType: "worktask", sourceId: worktaskId, milestoneId });

    raw = new BetterSqlite3(file);
    const projectBeforeUpdate = "2000-01-01T00:00:00.000Z";
    raw.prepare("UPDATE project SET updated_at = ? WHERE id = ?").run(projectBeforeUpdate, projectId);

    const feedbackResult = await db.updateProjectItemStatus({
      projectId,
      sourceType: "feedback",
      sourceId: feedbackId,
      status: "reviewed"
    });
    assert.deepEqual(Object.keys(feedbackResult).sort(), [
      "projectItemId", "projectId", "sourceType", "sourceId", "status", "projectUpdatedAt"
    ].sort());
    assert.equal(feedbackResult.projectItemId, feedbackItem.id);
    assert.equal(feedbackResult.projectId, projectId);
    assert.equal(feedbackResult.sourceType, "feedback");
    assert.equal(feedbackResult.sourceId, feedbackId);
    assert.equal(feedbackResult.status, "reviewed");
    assert.notEqual(feedbackResult.projectUpdatedAt, projectBeforeUpdate);
    assert.equal((await db.getFeedbackById(feedbackId)).status, "reviewed");
    assert.equal((await db.getProjectDetail(projectId)).items.find((item) => item.sourceId === feedbackId).milestoneId, milestoneId);
    assert.equal((await db.getProjectById(projectId)).updatedAt, feedbackResult.projectUpdatedAt);

    const feedbackUpdatedAt = (await db.getFeedbackById(feedbackId)).updatedAt;
    const sameFeedbackResult = await db.updateProjectItemStatus({
      projectId,
      sourceType: "feedback",
      sourceId: feedbackId,
      status: "reviewed"
    });
    assert.equal(sameFeedbackResult.projectUpdatedAt, feedbackResult.projectUpdatedAt);
    assert.equal((await db.getProjectById(projectId)).updatedAt, feedbackResult.projectUpdatedAt);
    assert.equal((await db.getFeedbackById(feedbackId)).updatedAt, feedbackUpdatedAt);

    const projectBeforeWorktaskUpdate = "2001-01-01T00:00:00.000Z";
    raw.prepare("UPDATE project SET updated_at = ? WHERE id = ?").run(projectBeforeWorktaskUpdate, projectId);
    const worktaskResult = await db.updateProjectItemStatus({
      projectId,
      sourceType: "worktask",
      sourceId: worktaskId,
      status: "in_progress"
    });
    assert.equal(worktaskResult.projectItemId, worktaskItem.id);
    assert.equal(worktaskResult.sourceType, "worktask");
    assert.equal(worktaskResult.status, "in_progress");
    assert.notEqual(worktaskResult.projectUpdatedAt, projectBeforeWorktaskUpdate);
    assert.equal((await db.getWorktaskById(worktaskId)).status, "in_progress");
    assert.equal((await db.getProjectDetail(projectId)).items.find((item) => item.sourceId === worktaskId).milestoneId, milestoneId);
    assert.equal((await db.getProjectById(projectId)).updatedAt, worktaskResult.projectUpdatedAt);

    const worktaskUpdatedAt = (await db.getWorktaskById(worktaskId)).updatedAt;
    const sameWorktaskResult = await db.updateProjectItemStatus({
      projectId,
      sourceType: "worktask",
      sourceId: worktaskId,
      status: "in_progress"
    });
    assert.equal(sameWorktaskResult.projectUpdatedAt, worktaskResult.projectUpdatedAt);
    assert.equal((await db.getProjectById(projectId)).updatedAt, worktaskResult.projectUpdatedAt);
    assert.equal((await db.getWorktaskById(worktaskId)).updatedAt, worktaskUpdatedAt);
  } finally {
    if (raw) raw.close();
    await restoreDb(db);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("项目范围状态更新拒绝跨项目、归档、未绑定和缺失来源", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kws-project-item-status-errors-"));
  const file = path.join(tempDir, "workstation.db");
  const db = loadDb(file);
  let raw;
  try {
    await db.initializeDatabase();
    const projectId = await db.createProject({ name: "当前项目" });
    const otherProjectId = await db.createProject({ name: "其他项目" });
    const feedbackId = await db.createFeedback(sourcePayload("错误场景反馈"));
    const unboundWorktaskId = await db.createWorktask({
      ...sourcePayload("未绑定任务"),
      type: "WorkTask提交",
      priority: "low",
      expectedAt: "",
      tags: ""
    });
    await db.assignProjectItem({ projectId, sourceType: "feedback", sourceId: feedbackId });

    const originalFeedback = await db.getFeedbackById(feedbackId);
    await assert.rejects(
      () => db.updateProjectItemStatus({ projectId: otherProjectId, sourceType: "feedback", sourceId: feedbackId, status: "resolved" }),
      (error) => error && error.code === "PROJECT_ITEM_CONFLICT"
    );
    assert.equal((await db.getFeedbackById(feedbackId)).status, originalFeedback.status);

    await assert.rejects(
      () => db.updateProjectItemStatus({ projectId, sourceType: "worktask", sourceId: unboundWorktaskId, status: "scheduled" }),
      (error) => error && error.code === "NOT_FOUND"
    );
    assert.equal((await db.getWorktaskById(unboundWorktaskId)).status, "new");

    await db.archiveProject(projectId);
    await assert.rejects(
      () => db.updateProjectItemStatus({ projectId, sourceType: "feedback", sourceId: feedbackId, status: "resolved" }),
      (error) => error && error.code === "PROJECT_STATE_CONFLICT"
    );
    assert.equal((await db.getFeedbackById(feedbackId)).status, originalFeedback.status);

    raw = new BetterSqlite3(file);
    const missingSourceId = 999999;
    raw.prepare(`INSERT INTO project_item (project_id, source_type, source_id, milestone_id, created_at, updated_at)
      VALUES (?, ?, ?, NULL, ?, ?)`).run(otherProjectId, "feedback", missingSourceId, "2000-01-01T00:00:00.000Z", "2000-01-01T00:00:00.000Z");
    await assert.rejects(
      () => db.updateProjectItemStatus({ projectId: otherProjectId, sourceType: "feedback", sourceId: missingSourceId, status: "reviewed" }),
      (error) => error && error.code === "NOT_FOUND"
    );
    assert.equal(raw.prepare("SELECT id FROM project_item WHERE project_id = ? AND source_type = ? AND source_id = ?").get(otherProjectId, "feedback", missingSourceId), undefined);
  } finally {
    if (raw) raw.close();
    await restoreDb(db);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
