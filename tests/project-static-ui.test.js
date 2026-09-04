const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("管理员页面包含项目标签、详情容器、公开设置和直角操作按钮", () => {
  const html = read("public/admin/index.html");
  const adminJs = read("public/admin/admin.js");
  for (const id of ["tabProjects", "moduleProjects", "projectList", "projectDetail", "projectMilestoneList", "projectFeedbackLane", "projectWorktaskLane", "projectMsg"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /id=["']projectCreateBtn["'][^>]*type=["']button["']/);
  assert.match(html, /id=["']projectPublicBasic["']/);
  assert.match(html, /id=["']projectPublicMilestones["']/);
  assert.match(html, /id=["']projectPublicUpdatedAt["']/);
  assert.match(html, /id=["']projectPublicCompletion["']/);
  assert.match(html, /id=["']projectMilestoneDescription["']/);
  assert.match(html, /<option value=["']active["'][^>]*selected/);
  assert.match(html, /project-model\.js/);
  assert.match(adminJs, /project-source-load/);
  assert.match(adminJs, /api\/admin\/project\/item/);
});

test("首页和公共项目页有独立脚本、编码链接和不可用状态", () => {
  const home = read("public/index.html");
  const homeJs = read("public/index/main.js");
  const projectHtml = read("public/project/index.html");
  const projectJs = read("public/project/main.js");
  assert.match(home, /id=["']projectsShowcase["']/);
  assert.match(homeJs, /api\/public\/projects/);
  assert.match(homeJs, /encodeURIComponent/);
  assert.match(projectHtml, /id=["']projectUnavailable["']/);
  assert.match(projectHtml, /\/project\/main\.js/);
  assert.match(projectJs, /项目暂不可用/);
  assert.match(projectJs, /api\/public\/config/);
  assert.match(projectJs, /displayTimezone/);
  assert.match(projectJs, /formatDateTime/);
  assert.match(projectJs, /textContent/);
  assert.match(projectJs, /keepHeaderWithContent/);
  assert.doesNotMatch(projectJs, /innerHTML\s*=\s*[^;]*(?:name|description|title)/);
});
