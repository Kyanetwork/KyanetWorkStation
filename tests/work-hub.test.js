const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const BetterSqlite3 = require("better-sqlite3");

const ROOT = path.resolve(__dirname, "..");
const DB_MODULE = path.join(ROOT, "server", "db.js");
const CONFIG_MODULE = path.join(ROOT, "server", "config.js");

function loadDb(file) {
  process.env.DB_CLIENT = "sqlite";
  process.env.DB_PATH = file;
  delete require.cache[CONFIG_MODULE];
  delete require.cache[DB_MODULE];
  return require(DB_MODULE);
}

async function closeDb(db) {
  await db.closeDatabase();
  delete require.cache[CONFIG_MODULE];
  delete require.cache[DB_MODULE];
}

function feedbackPayload(title) {
  return {
    type: "Bug",
    title,
    content: `${title} confidential content`,
    contact: "private@example.com",
    images: []
  };
}

function worktaskPayload(title) {
  return {
    type: "任务安排",
    title,
    content: `${title} confidential content`,
    contact: "private@example.com",
    priority: "high",
    expectedAt: "",
    tags: "work-hub"
  };
}

function patchSourceTimes(file, changes) {
  const sqlite = new BetterSqlite3(file);
  try {
    for (const change of changes) {
      if (change.sourceType === "feedback") {
        sqlite.prepare("UPDATE feedback SET updated_at = ? WHERE id = ?").run(change.updatedAt, change.id);
      } else {
        sqlite.prepare("UPDATE worktask SET updated_at = ?, scheduled_at = ?, assignee = ? WHERE id = ?")
          .run(change.updatedAt, change.scheduledAt ?? null, change.assignee ?? null, change.id);
      }
    }
  } finally {
    sqlite.close();
  }
}

function dropTables(file, tableNames) {
  const sqlite = new BetterSqlite3(file);
  try {
    sqlite.exec(tableNames.map((tableName) => `DROP TABLE ${tableName}`).join(";"));
  } finally {
    sqlite.close();
  }
}

test("Work Hub 聚合按时间窗口、终止状态、未分配和项目上下文返回安全摘要", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kws-work-hub-"));
  const file = path.join(tempDir, "workstation.db");
  const db = loadDb(file);
  const now = "2030-01-10T00:00:00.000Z";
  try {
    await db.initializeDatabase();
    const projectId = await db.createProject({ name: "聚合项目", description: "internal description" });
    const feedbackId = await db.createFeedback(feedbackPayload("最近反馈"));
    const overdueId = await db.createWorktask(worktaskPayload("逾期任务"));
    const exactNowId = await db.createWorktask(worktaskPayload("当前时刻任务"));
    const boundaryId = await db.createWorktask(worktaskPayload("边界近期任务"));
    const upcomingId = await db.createWorktask(worktaskPayload("近期任务"));
    const invalidScheduleId = await db.createWorktask(worktaskPayload("无效计划任务"));
    const unassignedId = await db.createWorktask(worktaskPayload("未分配任务"));
    const completedUnassignedId = await db.createWorktask(worktaskPayload("已完成未分配"));
    await db.assignProjectItem({ projectId, sourceType: "worktask", sourceId: upcomingId });

    patchSourceTimes(file, [
      { sourceType: "feedback", id: feedbackId, updatedAt: "2030-01-09T12:00:00.000Z" },
      { sourceType: "worktask", id: overdueId, updatedAt: "2030-01-09T11:00:00.000Z", scheduledAt: "2030-01-09T00:00:00.000Z", assignee: "Kyan" },
      { sourceType: "worktask", id: exactNowId, updatedAt: "2030-01-09T10:30:00.000Z", scheduledAt: now, assignee: "Kyan" },
      { sourceType: "worktask", id: boundaryId, updatedAt: "2030-01-09T10:00:00.000Z", scheduledAt: "2030-01-17T00:00:00.000Z", assignee: "Kyan" },
      { sourceType: "worktask", id: upcomingId, updatedAt: "2030-01-09T09:00:00.000Z", scheduledAt: "2030-01-12T00:00:00.000Z", assignee: "Kyan" },
      { sourceType: "worktask", id: invalidScheduleId, updatedAt: "2030-01-09T08:30:00.000Z", scheduledAt: "not-a-date", assignee: "Kyan" },
      { sourceType: "worktask", id: unassignedId, updatedAt: "2030-01-09T08:00:00.000Z", scheduledAt: null, assignee: "   " },
      { sourceType: "worktask", id: completedUnassignedId, updatedAt: "2030-01-09T12:00:00.000Z", scheduledAt: null, assignee: null }
    ]);
    await db.updateWorktaskStatus(completedUnassignedId, "completed");
    patchSourceTimes(file, [{ sourceType: "worktask", id: completedUnassignedId, updatedAt: "2030-01-09T07:00:00.000Z", scheduledAt: null, assignee: null }]);

    const overview = await db.getWorkHubOverview({ now });
    assert.equal(overview.windowDays, 7);
    assert.equal(overview.limit, 10);
    assert.equal(overview.sections.overdue.items.some((item) => item.sourceId === overdueId), true);
    assert.equal(overview.sections.overdue.items.some((item) => item.sourceId === boundaryId), false);
    assert.equal(overview.sections.overdue.items.some((item) => item.sourceId === exactNowId), false);
    assert.equal(overview.sections.upcoming.items.some((item) => item.sourceId === upcomingId), true);
    assert.equal(overview.sections.upcoming.items.some((item) => item.sourceId === exactNowId), true);
    assert.equal(overview.sections.upcoming.items.some((item) => item.sourceId === boundaryId), false);
    assert.equal(overview.sections.upcoming.items.some((item) => item.sourceId === invalidScheduleId), false);
    assert.equal(overview.sections.unassigned.items.some((item) => item.sourceId === unassignedId), true);
    assert.equal(overview.sections.unassigned.items.some((item) => item.sourceId === completedUnassignedId), false);
    assert.deepEqual(overview.sections.recent.items.map((item) => item.sourceId), [feedbackId, overdueId, exactNowId, boundaryId, upcomingId, invalidScheduleId, unassignedId]);
    const projectItem = overview.sections.upcoming.items.find((item) => item.sourceId === upcomingId);
    assert.deepEqual(projectItem.project, { id: projectId, name: "聚合项目" });

    const serialized = JSON.stringify(overview);
    for (const forbidden of ["confidential content", "private@example.com", "adminNote", "accountUserId", "accountEmailSnapshot", "contact"]) {
      assert.equal(serialized.includes(forbidden), false, `forbidden field leaked: ${forbidden}`);
    }
  } finally {
    await closeDb(db);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Work Hub 每个分区最多返回 10 条并稳定按时间排序", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kws-work-hub-limit-"));
  const file = path.join(tempDir, "workstation.db");
  const db = loadDb(file);
  const now = "2030-02-01T00:00:00.000Z";
  try {
    await db.initializeDatabase();
    const changes = [];
    for (let index = 0; index < 12; index += 1) {
      const id = await db.createWorktask(worktaskPayload(`逾期 ${index}`));
      changes.push({ sourceType: "worktask", id, updatedAt: `2030-01-${String(20 + index).padStart(2, "0")}T00:00:00.000Z`, scheduledAt: `2030-01-${String(20 + index).padStart(2, "0")}T00:00:00.000Z`, assignee: "Kyan" });
    }
    patchSourceTimes(file, changes);
    const overview = await db.getWorkHubOverview({ now });
    const items = overview.sections.overdue.items;
    assert.equal(items.length, 10);
    assert.deepEqual(items.map((item) => item.scheduledAt), [...items].sort((left, right) => right.scheduledAt.localeCompare(left.scheduledAt)).map((item) => item.scheduledAt));
  } finally {
    await closeDb(db);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Work Hub 相同时间按来源类型和 ID 保持稳定顺序", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kws-work-hub-tie-"));
  const file = path.join(tempDir, "workstation.db");
  const db = loadDb(file);
  const now = "2030-03-01T00:00:00.000Z";
  try {
    await db.initializeDatabase();
    const firstId = await db.createWorktask(worktaskPayload("同一计划 1"));
    const secondId = await db.createWorktask(worktaskPayload("同一计划 2"));
    patchSourceTimes(file, [
      { sourceType: "worktask", id: firstId, updatedAt: "2030-02-28T00:00:00.000Z", scheduledAt: "2030-02-28T00:00:00.000Z", assignee: "Kyan" },
      { sourceType: "worktask", id: secondId, updatedAt: "2030-02-28T00:00:00.000Z", scheduledAt: "2030-02-28T00:00:00.000Z", assignee: "Kyan" }
    ]);
    const overview = await db.getWorkHubOverview({ now });
    assert.deepEqual(
      overview.sections.overdue.items.slice(0, 2).map((item) => item.sourceId),
      [firstId, secondId]
    );
  } finally {
    await closeDb(db);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Work Hub 单来源失败时保留另一来源并返回安全降级状态", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kws-work-hub-partial-"));
  const file = path.join(tempDir, "workstation.db");
  const initialDb = loadDb(file);
  try {
    await initialDb.initializeDatabase();
    await initialDb.createWorktask(worktaskPayload("降级任务"));
    await initialDb.closeDatabase();
    dropTables(file, ["feedback"]);

    const db = loadDb(file);
    try {
      const overview = await db.getWorkHubOverview({ now: new Date().toISOString() });
      assert.equal(overview.sources.feedback.status, "error");
      assert.equal(overview.sources.worktask.status, "ok");
      assert.equal(overview.sections.overdue.status, "ok");
      assert.equal(overview.sections.recent.status, "partial");
      assert.equal(overview.sections.recent.items[0].title, "降级任务");
      assert.equal(JSON.stringify(overview).includes("no such table"), false);
    } finally {
      await closeDb(db);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Work Hub 全部来源失败时返回可重试的安全错误分区", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kws-work-hub-error-"));
  const file = path.join(tempDir, "workstation.db");
  const initialDb = loadDb(file);
  try {
    await initialDb.initializeDatabase();
    await initialDb.closeDatabase();
    dropTables(file, ["feedback", "worktask"]);

    const db = loadDb(file);
    try {
      const overview = await db.getWorkHubOverview({ now: new Date().toISOString() });
      assert.equal(overview.sources.feedback.status, "error");
      assert.equal(overview.sources.worktask.status, "error");
      for (const section of Object.values(overview.sections)) {
        assert.equal(section.status, "error");
        assert.deepEqual(section.items, []);
        assert.equal(section.errorCode, "WORK_HUB_SOURCE_UNAVAILABLE");
      }
      assert.equal(JSON.stringify(overview).includes("no such table"), false);
    } finally {
      await closeDb(db);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Work Hub 管理入口预留独立 tab/module 和安全渲染契约", () => {
  const html = fs.readFileSync(path.join(ROOT, "public/admin/index.html"), "utf8");
  const script = fs.readFileSync(path.join(ROOT, "public/admin/admin.js"), "utf8");
  assert.match(html, /id="tabWorkHub"/u);
  assert.match(html, /id="moduleWorkHub"/u);
  for (const id of ["workHubOverdue", "workHubUpcoming", "workHubUnassigned", "workHubRecent"]) {
    assert.match(html, new RegExp(`id="${id}"`, "u"));
  }
  assert.match(script, /api\("\/api\/admin\/work-hub\/overview"/u);
  assert.match(script, /escapeHtml\(/u);
  assert.match(script, /data-action="work-hub-open-item"/u);
});
