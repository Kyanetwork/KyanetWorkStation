const test = require("node:test");
const assert = require("node:assert/strict");

const model = require("../public/admin/project-model.js");

test("项目模型为缺省字段提供安全默认值并按泳道分离来源", () => {
  const summary = model.normalizeProjectSummary({ id: "4", name: "项目", status: "archived" });
  assert.equal(summary.id, 4);
  assert.equal(summary.name, "项目");
  assert.equal(summary.description, "");
  assert.equal(summary.completion, null);
  assert.equal(summary.publicItems, false);
  const detail = model.normalizeProjectDetail({
    project: summary,
    milestones: [{ id: 2, title: "后", sortOrder: 2 }, { id: 1, title: "前", sortOrder: 1 }],
    items: [
      { sourceType: "worktask", sourceId: 2, title: "任务" },
      { sourceType: "feedback", sourceId: 1, title: "反馈" },
      { sourceType: "comment", sourceId: 3, title: "丢弃" }
    ]
  });
  assert.deepEqual(detail.milestones.map((item) => item.id), [1, 2]);
  const lanes = model.splitProjectItems(detail.items);
  assert.deepEqual(lanes.feedback.map((item) => item.sourceId), [1]);
  assert.deepEqual(lanes.worktask.map((item) => item.sourceId), [2]);
  assert.equal(detail.items[0].publicVisible, false);
});

test("项目 hash 只包含正整数 ID并可安全解析", () => {
  assert.equal(model.projectHash(12), "#projects/12");
  assert.deepEqual(model.parseProjectHash("#projects"), { id: null });
  assert.deepEqual(model.parseProjectHash("#projects/12"), { id: 12 });
  assert.deepEqual(model.parseProjectHash("#projects/nope"), { id: null });
  assert.deepEqual(model.parseProjectHash("#worktask/12"), { id: null });
});

test("Kanban 模型保留两条原生状态泳道并按更新时间及关系 ID 降序", () => {
  const lanes = model.buildKanbanLanes([
    { id: 20, sourceType: "feedback", sourceId: 2, title: "旧", status: "new", updatedAt: "2030-01-01T00:00:00.000Z" },
    { id: 10, sourceType: "feedback", sourceId: 3, title: "新", status: "new", updatedAt: "2030-01-02T00:00:00.000Z" },
    { id: 30, sourceType: "feedback", sourceId: 4, title: "同日", status: "new", updatedAt: "2030-01-01T00:00:00.000Z" },
    { id: 5, sourceType: "feedback", sourceId: 5, title: "关系 ID 较小", status: "new", updatedAt: "2030-01-01T00:00:00.000Z" },
    { id: 7, sourceType: "feedback", sourceId: 7, title: "无效时间", status: "new", updatedAt: "not-a-date" },
    { sourceType: "feedback", sourceId: 8, title: "来源 ID fallback A", status: "new", updatedAt: "not-a-date" },
    { sourceType: "feedback", sourceId: 6, title: "来源 ID fallback B", status: "new", updatedAt: "not-a-date" },
    { sourceType: "worktask", sourceId: 4, title: "任务", status: "in_progress", updatedAt: "2030-01-01T00:00:00.000Z" },
    { sourceType: "feedback", sourceId: 9, title: "未知", status: "unexpected", updatedAt: "2030-01-03T00:00:00.000Z" },
    { sourceType: "comment", sourceId: 10, title: "丢弃", status: "new", updatedAt: "2030-01-04T00:00:00.000Z" }
  ]);

  assert.deepEqual(model.KANBAN_STATUS_COLUMNS.feedback, ["new", "reviewed", "resolved", "notplanned"]);
  assert.deepEqual(model.KANBAN_STATUS_COLUMNS.worktask, ["new", "scheduled", "in_progress", "completed", "cancelled"]);
  assert.deepEqual(lanes.feedback.columns.map((column) => column.status), ["new", "reviewed", "resolved", "notplanned"]);
  assert.deepEqual(lanes.worktask.columns.map((column) => column.status), ["new", "scheduled", "in_progress", "completed", "cancelled"]);
  assert.deepEqual(lanes.feedback.columns[0].items.slice(0, 5).map((item) => item.sourceId), [3, 4, 2, 5, 7]);
  assert.deepEqual(lanes.feedback.columns[0].items.slice(-2).map((item) => item.sourceId), [8, 6]);
  assert.deepEqual(lanes.worktask.columns.find((column) => column.status === "in_progress").items.map((item) => item.sourceId), [4]);
  assert.deepEqual(lanes.feedback.unknown.map((item) => item.sourceId), [9]);
  assert.equal(lanes.worktask.columns.find((column) => column.status === "completed").items.length, 0);
  assert.equal(lanes.worktask.unknown.length, 0);
});
