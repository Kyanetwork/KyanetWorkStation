const test = require("node:test");
const assert = require("node:assert/strict");

const validation = require("../server/validation");

test("项目创建校验保留 Unicode 长度并规范化公开与完成度设置", () => {
  const result = validation.validateProjectCreatePayload({
    name: "  我的项目  ",
    description: "说明",
    publicBasic: true,
    publicMilestones: false,
    publicUpdatedAt: "1",
    publicCompletion: 0,
    completionMode: "custom",
    customCompletion: 75
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.data, {
    name: "我的项目",
    description: "说明",
    publicBasic: true,
    publicMilestones: false,
    publicUpdatedAt: true,
    publicCompletion: false,
    completionMode: "custom",
    customCompletion: 75
  });
});

test("项目校验拒绝空名称、超长 Unicode 和非法完成度", () => {
  assert.equal(validation.validateProjectCreatePayload({ name: "" }).valid, false);
  assert.equal(validation.validateProjectCreatePayload({ name: "界".repeat(121) }).valid, false);
  assert.equal(validation.validateProjectCreatePayload({ name: "项目", completionMode: "custom", customCompletion: 101 }).valid, false);
  assert.equal(validation.validateProjectCreatePayload({ name: "项目", completionMode: "custom", customCompletion: 1.5 }).valid, false);
});

test("项目更新要求至少一个字段，并且 auto 模式清空自定义完成度", () => {
  assert.equal(validation.validateProjectUpdatePayload({ id: 1 }).valid, false);
  const result = validation.validateProjectUpdatePayload({ id: "2", completionMode: "auto", customCompletion: 90 });
  assert.equal(result.valid, true);
  assert.equal(result.data.id, 2);
  assert.equal(result.data.completionMode, "auto");
  assert.equal(result.data.customCompletion, null);
});

test("里程碑校验严格接受 ISO 日期、排序和完成标记", () => {
  const result = validation.validateProjectMilestoneCreatePayload({
    projectId: "3",
    title: "  第一阶段 ",
    description: "说明",
    targetDate: "2030-02-28",
    isCompleted: "true",
    sortOrder: "10"
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.data, {
    projectId: 3,
    title: "第一阶段",
    description: "说明",
    targetDate: "2030-02-28",
    isCompleted: true,
    sortOrder: 10
  });
  assert.equal(validation.validateProjectMilestoneCreatePayload({ projectId: 1, title: "x", targetDate: "2030-2-1" }).valid, false);
  assert.equal(validation.validateProjectMilestoneCreatePayload({ projectId: 1, title: "x", targetDate: "2030-02-30" }).valid, false);
});

test("项目来源校验只允许 feedback/worktask 和正整数 ID", () => {
  assert.equal(validation.validateProjectItemQueryPayload({ sourceType: "feedback", sourceId: "4" }).valid, true);
  assert.equal(validation.validateProjectItemQueryPayload({ sourceType: "comment", sourceId: 4 }).valid, false);
  assert.equal(validation.validateProjectItemAssignPayload({ projectId: 1, sourceType: "worktask", sourceId: 0 }).valid, false);
  assert.equal(validation.validateProjectItemAssignPayload({ projectId: 1, sourceType: "worktask", sourceId: 2, milestoneId: "" }).valid, true);
});

test("项目公开 key、列表分页和布尔字段安全校验", () => {
  assert.equal(validation.validatePublicProjectKey("550e8400-e29b-41d4-a716-446655440000").valid, true);
  assert.equal(validation.validatePublicProjectKey("../secret").valid, false);
  assert.equal(validation.validateProjectListPayload({ page: "2", pageSize: "50", status: "archived", keyword: "项目" }).valid, true);
  assert.equal(validation.validateProjectListPayload({ status: "all" }).valid, true);
  assert.equal(validation.validateProjectListPayload({ status: "deleted" }).valid, false);
  assert.equal(validation.validateProjectUpdatePayload({ id: 1, publicBasic: "maybe" }).valid, false);
});
