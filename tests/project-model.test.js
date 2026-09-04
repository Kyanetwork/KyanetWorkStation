const test = require("node:test");
const assert = require("node:assert/strict");

const model = require("../public/admin/project-model.js");

test("项目模型为缺省字段提供安全默认值并按泳道分离来源", () => {
  const summary = model.normalizeProjectSummary({ id: "4", name: "项目", status: "archived" });
  assert.equal(summary.id, 4);
  assert.equal(summary.name, "项目");
  assert.equal(summary.description, "");
  assert.equal(summary.completion, null);
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
});

test("项目 hash 只包含正整数 ID并可安全解析", () => {
  assert.equal(model.projectHash(12), "#projects/12");
  assert.deepEqual(model.parseProjectHash("#projects"), { id: null });
  assert.deepEqual(model.parseProjectHash("#projects/12"), { id: 12 });
  assert.deepEqual(model.parseProjectHash("#projects/nope"), { id: null });
  assert.deepEqual(model.parseProjectHash("#worktask/12"), { id: null });
});
