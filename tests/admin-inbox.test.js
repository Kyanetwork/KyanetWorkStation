const test = require("node:test");
const assert = require("node:assert/strict");

const {
  mapFeedback,
  mapWorktask,
  mergeInboxItems,
  filterInboxItems,
  hasMoreInboxItems
} = require("../public/admin/inbox-model");

test("inbox model maps safe fields and orders feedback/worktasks by update time", () => {
  const feedback = mapFeedback({
    id: 1,
    title: "反馈标题",
    content: "反馈内容",
    status: "reviewed",
    type: "Bug",
    updatedAt: "2026-08-28T10:00:00.000Z",
    createdAt: "2026-08-28T09:00:00.000Z",
    contact: "private@example.com",
    adminNote: "private note"
  });
  const worktask = mapWorktask({
    id: 2,
    title: "工单标题",
    content: "工单内容",
    status: "new",
    priority: "urgent",
    updatedAt: "2026-08-28T11:00:00.000Z",
    createdAt: "2026-08-28T08:00:00.000Z",
    contact: "private@example.com",
    adminNote: "private note"
  });

  assert.deepEqual(mergeInboxItems([feedback], [worktask]).map((item) => item.id), [2, 1]);
  assert.equal(feedback.source, "feedback");
  assert.equal(feedback.summary, "反馈内容");
  assert.equal(feedback.contact, undefined);
  assert.equal(feedback.adminNote, undefined);
  assert.equal(worktask.priority, "urgent");
  assert.equal(worktask.detailFields.content, "工单内容");
});

test("inbox model filters by source, status, priority, and keyword", () => {
  const items = [
    mapFeedback({ id: 1, title: "登录反馈", content: "页面异常", status: "new", type: "Bug", updatedAt: "2026-08-28T10:00:00.000Z" }),
    mapWorktask({ id: 2, title: "部署任务", content: "上线工作站", status: "in_progress", priority: "high", updatedAt: "2026-08-28T11:00:00.000Z" })
  ];

  assert.deepEqual(filterInboxItems(items, { source: "feedback" }).map((item) => item.id), [1]);
  assert.deepEqual(filterInboxItems(items, { status: "in_progress" }).map((item) => item.id), [2]);
  assert.deepEqual(filterInboxItems(items, { priority: "high" }).map((item) => item.id), [2]);
  assert.deepEqual(filterInboxItems(items, { keyword: "工作站" }).map((item) => item.id), [2]);
});

test("inbox model reports a source boundary when either list has more than one page", () => {
  assert.equal(hasMoreInboxItems({ totalPages: 1 }, { totalPages: 1 }), false);
  assert.equal(hasMoreInboxItems({ totalPages: 2 }, { totalPages: 1 }), true);
  assert.equal(hasMoreInboxItems({ totalPages: 1 }, { totalPages: 3 }), true);
});

test("inbox model keeps deterministic order when update times are missing", () => {
  const feedback = mapFeedback({ id: 2, title: "反馈" });
  const worktask = mapWorktask({ id: 1, title: "任务" });

  assert.deepEqual(
    mergeInboxItems([worktask], [feedback]).map((item) => [item.source, item.id]),
    [["feedback", 2], ["worktask", 1]]
  );
});

test("inbox model treats serialized boolean flags explicitly", () => {
  const feedback = mapFeedback({ id: 3, showOnHome: "0" });
  const worktask = mapWorktask({ id: 4, showOnHome: "false", createdByAdmin: "0" });

  assert.equal(feedback.detailFields.showOnHome, false);
  assert.equal(worktask.detailFields.showOnHome, false);
  assert.equal(worktask.detailFields.createdByAdmin, false);
});
