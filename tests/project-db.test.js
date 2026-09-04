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
      assert.match(sql, /source_type[\s\S]{0,200}source_id/);
      assert.match(sql, /idx_project_status_updated/);
      assert.match(sql, /idx_project_milestone_project/);
      assert.match(sql, /idx_project_item_project/);
    }
  } finally {
    fs.rmSync(path.join(os.tmpdir(), "kws-project-schema-unused.db"), { force: true });
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
