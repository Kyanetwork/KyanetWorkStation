const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateFeedbackPayload,
  validateAdminLoginPayload,
  validateHomeDisplayPayload,
  validateSmtpTestPayload,
  validateWorktaskArrangePayload
} = require("../server/validation");

test("validateFeedbackPayload accepts valid payload", () => {
  const result = validateFeedbackPayload({
    type: "Bug",
    title: "登录按钮样式错位",
    content: "在窄屏下按钮会换行，建议调整",
    contact: "tester@example.com",
    images: ["https://example.com/a.png"]
  });

  assert.equal(result.valid, true);
  assert.equal(result.data.type, "Bug");
  assert.equal(result.data.images.length, 1);
});

test("validateFeedbackPayload rejects invalid type", () => {
  const result = validateFeedbackPayload({
    type: "Unknown",
    title: "x",
    content: "y",
    contact: "z"
  });

  assert.equal(result.valid, false);
});

test("validateAdminLoginPayload validates required fields", () => {
  const result = validateAdminLoginPayload({
    username: "admin",
    password: "a-strong-password"
  });
  assert.equal(result.valid, true);
});

test("validateHomeDisplayPayload parses numeric boolean", () => {
  const result = validateHomeDisplayPayload({
    id: 12,
    showOnHome: 1
  });
  assert.equal(result.valid, true);
  assert.equal(result.data.showOnHome, true);
});

test("validateSmtpTestPayload supports comma and semicolon split", () => {
  const result = validateSmtpTestPayload({
    to: "a@example.com; b@example.com, c@example.com"
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.data.to, ["a@example.com", "b@example.com", "c@example.com"]);
});

test("validateWorktaskArrangePayload preserves explicit clear operations", () => {
  const assignee = validateWorktaskArrangePayload({ id: 12, assignee: null });
  const schedule = validateWorktaskArrangePayload({ id: 12, scheduledAt: "" });
  assert.equal(assignee.valid, true);
  assert.equal(assignee.data.assigneeProvided, true);
  assert.equal(assignee.data.assignee, "");
  assert.equal(schedule.valid, true);
  assert.equal(schedule.data.scheduledAtProvided, true);
  assert.equal(schedule.data.scheduledAt, "");
});

test("validateWorktaskArrangePayload rejects an empty update object", () => {
  const result = validateWorktaskArrangePayload({ id: 12 });
  assert.equal(result.valid, false);
});
