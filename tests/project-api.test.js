const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const APP = path.join(ROOT, "server", "app.js");

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
    server.on("error", reject);
  });
}

async function startServer() {
  const port = await freePort();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kws-project-api-"));
  const dbPath = path.join(tempDir, "workstation.db");
  const baseUrl = `http://127.0.0.1:${port}`;
  const output = [];
  const child = spawn(process.execPath, [APP], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: "test",
      DB_CLIENT: "sqlite",
      DB_PATH: dbPath,
      PORT: String(port),
      LISTEN_HOST: "127.0.0.1",
      APP_BASE_URL: baseUrl,
      ADMIN_ALLOW_HEADERLESS_MUTATION: "true",
      ADMIN_USERNAME: "admin",
      ADMIN_PASSWORD: "admin-password",
      BCRYPT_ROUNDS: "4",
      MEOWSTATUS_ENABLED: "false",
      LOG_LEVEL: "fatal",
      ACCESS_LOG_ENABLED: "false",
      RATE_LIMIT_ADMIN_MAX: "1000",
      RATE_LIMIT_LOGIN_MAX: "1000",
      RATE_LIMIT_SUBMIT_MAX: "1000",
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited: ${output.join("")}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) break;
    } catch (_) {
      // Retry until startup deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return {
    baseUrl,
    async stop() {
      if (child.exitCode === null) {
        child.kill();
        await new Promise((resolve) => child.once("exit", resolve));
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

async function jsonRequest(baseUrl, route, options = {}) {
  const headers = { ...(options.headers || {}) };
  let body = options.body;
  if (body && typeof body !== "string") {
    body = JSON.stringify(body);
    headers["content-type"] = headers["content-type"] || "application/json";
  }
  const response = await fetch(`${baseUrl}${route}`, { method: options.method || "GET", headers, body });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function cookie(response) {
  const value = response.headers.get("set-cookie") || "";
  const match = value.match(/kws_sid=[^;]+/);
  assert.ok(match, `missing admin cookie: ${value}`);
  return match[0];
}

test("项目管理 API 保护会话并完成项目/里程碑/来源/公开流程", async () => {
  const server = await startServer();
  try {
    const anonymous = await jsonRequest(server.baseUrl, "/api/admin/project/list", { method: "POST", body: {} });
    assert.equal(anonymous.response.status, 401);
    assert.equal(anonymous.data.error.code, "UNAUTHORIZED");

    const login = await jsonRequest(server.baseUrl, "/api/admin/login", {
      method: "POST",
      body: { username: "admin", password: "admin-password" }
    });
    assert.equal(login.response.status, 200);
    const headers = { cookie: cookie(login.response) };

    const created = await jsonRequest(server.baseUrl, "/api/admin/project/create", {
      method: "POST",
      headers,
      body: { name: "公开项目", description: "公开说明", publicBasic: true, publicMilestones: true, publicCompletion: true }
    });
    assert.equal(created.response.status, 201);
    const projectId = created.data.data.id;
    const publicKey = created.data.data.publicKey;
    assert.ok(projectId > 0);
    assert.match(publicKey, /^[0-9a-f-]{36}$/i);

    const milestone = await jsonRequest(server.baseUrl, "/api/admin/project/milestone/create", {
      method: "POST",
      headers,
      body: { projectId, title: "第一阶段", isCompleted: true, sortOrder: 1 }
    });
    assert.equal(milestone.response.status, 201);
    const milestoneId = milestone.data.data.id;

    const feedback = await jsonRequest(server.baseUrl, "/api/feedback", {
      method: "POST",
      body: { type: "Bug", title: "项目反馈", content: "内部正文", contact: "private@example.com", images: [] }
    });
    assert.equal(feedback.response.status, 201);
    const feedbackId = feedback.data.data.id;

    const assigned = await jsonRequest(server.baseUrl, "/api/admin/project/item/assign", {
      method: "POST",
      headers,
      body: { projectId, sourceType: "feedback", sourceId: feedbackId, milestoneId }
    });
    assert.equal(assigned.response.status, 201);

    const detail = await jsonRequest(server.baseUrl, `/api/admin/project/${projectId}`, { headers });
    assert.equal(detail.response.status, 200);
    assert.equal(detail.data.data.items[0].sourceType, "feedback");
    assert.equal(detail.data.data.items[0].content, undefined);
    assert.equal(detail.data.data.project.completion, 100);

    const conflict = await jsonRequest(server.baseUrl, "/api/admin/project/item/assign", {
      method: "POST",
      headers,
      body: { projectId, sourceType: "feedback", sourceId: feedbackId }
    });
    assert.equal(conflict.response.status, 409);
    assert.equal(conflict.data.error.code, "PROJECT_ITEM_CONFLICT");

    const candidates = await jsonRequest(server.baseUrl, "/api/admin/project/item-candidates", {
      method: "POST",
      headers,
      body: { sourceType: "feedback", keyword: "项目" }
    });
    assert.equal(candidates.response.status, 200);
    assert.equal(candidates.data.data.items[0].content, undefined);

    const archived = await jsonRequest(server.baseUrl, "/api/admin/project/archive", {
      method: "POST", headers, body: { id: projectId }
    });
    assert.equal(archived.response.status, 200);
    const blocked = await jsonRequest(server.baseUrl, "/api/admin/project/milestone/create", {
      method: "POST", headers, body: { projectId, title: "归档时禁止" }
    });
    assert.equal(blocked.response.status, 409);
    assert.equal(blocked.data.error.code, "PROJECT_STATE_CONFLICT");

    const hidden = await jsonRequest(server.baseUrl, `/api/public/projects/${publicKey}`);
    assert.equal(hidden.response.status, 404);
    const restored = await jsonRequest(server.baseUrl, "/api/admin/project/restore", {
      method: "POST", headers, body: { id: projectId }
    });
    assert.equal(restored.response.status, 200);
    const publicList = await jsonRequest(server.baseUrl, "/api/public/projects");
    assert.equal(publicList.response.status, 200);
    assert.equal(publicList.data.data.items[0].id, undefined);
    const publicDetail = await jsonRequest(server.baseUrl, `/api/public/projects/${publicKey}`);
    assert.equal(publicDetail.response.status, 200);
    assert.equal(publicDetail.data.data.id, undefined);
    assert.equal(publicDetail.data.data.items, undefined);
    assert.equal(publicDetail.data.data.milestones[0].title, "第一阶段");

    const projectAudits = await jsonRequest(server.baseUrl, "/api/admin/audit/list", {
      method: "POST",
      headers,
      body: { entityType: "project", entityId: projectId, page: 1, pageSize: 20 }
    });
    assert.equal(projectAudits.response.status, 200);
    assert.ok(projectAudits.data.data.items.some((item) => item.action === "project.create"));
  } finally {
    await server.stop();
  }
});

test("项目工作项状态 API 按来源校验、同步项目时间并脱敏审计", async () => {
  const server = await startServer();
  try {
    const anonymous = await jsonRequest(server.baseUrl, "/api/admin/project/item/status", {
      method: "POST",
      body: { projectId: 1, sourceType: "feedback", sourceId: 1, status: "reviewed" }
    });
    assert.equal(anonymous.response.status, 401);
    assert.equal(anonymous.data.error.code, "UNAUTHORIZED");

    const login = await jsonRequest(server.baseUrl, "/api/admin/login", {
      method: "POST",
      body: { username: "admin", password: "admin-password" }
    });
    assert.equal(login.response.status, 200);
    const headers = { cookie: cookie(login.response) };

    const crossSourceStatus = await jsonRequest(server.baseUrl, "/api/admin/project/item/status", {
      method: "POST",
      headers,
      body: { projectId: 1, sourceType: "feedback", sourceId: 1, status: "scheduled" }
    });
    assert.equal(crossSourceStatus.response.status, 400);
    assert.equal(crossSourceStatus.data.error.code, "INVALID_PAYLOAD");

    const invalidStatusAudits = await jsonRequest(server.baseUrl, "/api/admin/audit/list", {
      method: "POST",
      headers,
      body: { action: "project.item.status", entityType: "project_item", page: 1, pageSize: 20 }
    });
    assert.equal(invalidStatusAudits.response.status, 200);
    assert.ok(invalidStatusAudits.data.data.items.some((item) => (
      item.action === "project.item.status"
      && item.result === "failed"
      && item.metadata.errorCode === "INVALID_PAYLOAD"
    )));

    const project = await jsonRequest(server.baseUrl, "/api/admin/project/create", {
      method: "POST",
      headers,
      body: { name: "状态项目", description: "状态 API 测试" }
    });
    assert.equal(project.response.status, 201);
    const projectId = project.data.data.id;

    const otherProject = await jsonRequest(server.baseUrl, "/api/admin/project/create", {
      method: "POST",
      headers,
      body: { name: "其他项目", description: "跨项目状态测试" }
    });
    assert.equal(otherProject.response.status, 201);
    const otherProjectId = otherProject.data.data.id;

    const milestone = await jsonRequest(server.baseUrl, "/api/admin/project/milestone/create", {
      method: "POST",
      headers,
      body: { projectId, title: "状态里程碑" }
    });
    assert.equal(milestone.response.status, 201);
    const milestoneId = milestone.data.data.id;

    const feedback = await jsonRequest(server.baseUrl, "/api/feedback", {
      method: "POST",
      body: {
        type: "Bug",
        title: "状态反馈",
        content: "不应进入状态接口响应或审计",
        contact: "private@example.com",
        images: []
      }
    });
    assert.equal(feedback.response.status, 201);
    const feedbackId = feedback.data.data.id;

    const worktask = await jsonRequest(server.baseUrl, "/api/worktask", {
      method: "POST",
      body: {
        type: "任务安排",
        title: "状态任务",
        content: "任务正文不应进入状态接口响应或审计",
        contact: "task-private@example.com",
        priority: "medium",
        expectedAt: ""
      }
    });
    assert.equal(worktask.response.status, 201);
    const worktaskId = worktask.data.data.id;

    const feedbackAssignment = await jsonRequest(server.baseUrl, "/api/admin/project/item/assign", {
      method: "POST",
      headers,
      body: { projectId, sourceType: "feedback", sourceId: feedbackId, milestoneId }
    });
    assert.equal(feedbackAssignment.response.status, 201);
    const feedbackProjectItemId = feedbackAssignment.data.data.id;

    const worktaskAssignment = await jsonRequest(server.baseUrl, "/api/admin/project/item/assign", {
      method: "POST",
      headers,
      body: { projectId, sourceType: "worktask", sourceId: worktaskId, milestoneId }
    });
    assert.equal(worktaskAssignment.response.status, 201);
    const worktaskProjectItemId = worktaskAssignment.data.data.id;

    const crossProject = await jsonRequest(server.baseUrl, "/api/admin/project/item/status", {
      method: "POST",
      headers,
      body: { projectId: otherProjectId, sourceType: "feedback", sourceId: feedbackId, status: "reviewed" }
    });
    assert.equal(crossProject.response.status, 409);
    assert.equal(crossProject.data.error.code, "PROJECT_ITEM_CONFLICT");

    const unboundFeedback = await jsonRequest(server.baseUrl, "/api/feedback", {
      method: "POST",
      body: {
        type: "其他",
        title: "未绑定反馈",
        content: "未绑定",
        contact: "unbound@example.com",
        images: []
      }
    });
    assert.equal(unboundFeedback.response.status, 201);
    const unbound = await jsonRequest(server.baseUrl, "/api/admin/project/item/status", {
      method: "POST",
      headers,
      body: { projectId, sourceType: "feedback", sourceId: unboundFeedback.data.data.id, status: "reviewed" }
    });
    assert.equal(unbound.response.status, 404);
    assert.equal(unbound.data.error.code, "NOT_FOUND");

    const feedbackStatus = await jsonRequest(server.baseUrl, "/api/admin/project/item/status", {
      method: "POST",
      headers,
      body: { projectId, sourceType: "feedback", sourceId: feedbackId, status: "reviewed" }
    });
    assert.equal(feedbackStatus.response.status, 200);
    assert.deepEqual(Object.keys(feedbackStatus.data.data).sort(), [
      "projectId", "sourceType", "sourceId", "status", "projectUpdatedAt"
    ].sort());
    assert.deepEqual(feedbackStatus.data.data, {
      projectId,
      sourceType: "feedback",
      sourceId: feedbackId,
      status: "reviewed",
      projectUpdatedAt: feedbackStatus.data.data.projectUpdatedAt
    });
    assert.ok(feedbackStatus.data.data.projectUpdatedAt);

    const feedbackSameStatus = await jsonRequest(server.baseUrl, "/api/admin/project/item/status", {
      method: "POST",
      headers,
      body: { projectId, sourceType: "feedback", sourceId: feedbackId, status: "reviewed" }
    });
    assert.equal(feedbackSameStatus.response.status, 200);
    assert.equal(feedbackSameStatus.data.data.projectUpdatedAt, feedbackStatus.data.data.projectUpdatedAt);

    const worktaskStatus = await jsonRequest(server.baseUrl, "/api/admin/project/item/status", {
      method: "POST",
      headers,
      body: { projectId, sourceType: "worktask", sourceId: worktaskId, status: "in_progress" }
    });
    assert.equal(worktaskStatus.response.status, 200);
    assert.deepEqual(Object.keys(worktaskStatus.data.data).sort(), [
      "projectId", "sourceType", "sourceId", "status", "projectUpdatedAt"
    ].sort());
    assert.equal(worktaskStatus.data.data.projectId, projectId);
    assert.equal(worktaskStatus.data.data.sourceType, "worktask");
    assert.equal(worktaskStatus.data.data.sourceId, worktaskId);
    assert.equal(worktaskStatus.data.data.status, "in_progress");
    assert.ok(worktaskStatus.data.data.projectUpdatedAt);

    const detail = await jsonRequest(server.baseUrl, `/api/admin/project/${projectId}`, { headers });
    assert.equal(detail.response.status, 200);
    const detailFeedback = detail.data.data.items.find((item) => item.sourceType === "feedback" && item.sourceId === feedbackId);
    const detailWorktask = detail.data.data.items.find((item) => item.sourceType === "worktask" && item.sourceId === worktaskId);
    assert.equal(detailFeedback.status, "reviewed");
    assert.equal(detailFeedback.milestoneId, milestoneId);
    assert.equal(detailWorktask.status, "in_progress");
    assert.equal(detailWorktask.milestoneId, milestoneId);
    assert.equal(detail.data.data.project.updatedAt, worktaskStatus.data.data.projectUpdatedAt);

    const archived = await jsonRequest(server.baseUrl, "/api/admin/project/archive", {
      method: "POST",
      headers,
      body: { id: projectId }
    });
    assert.equal(archived.response.status, 200);
    const archivedStatus = await jsonRequest(server.baseUrl, "/api/admin/project/item/status", {
      method: "POST",
      headers,
      body: { projectId, sourceType: "feedback", sourceId: feedbackId, status: "resolved" }
    });
    assert.equal(archivedStatus.response.status, 409);
    assert.equal(archivedStatus.data.error.code, "PROJECT_STATE_CONFLICT");
    assert.equal(archivedStatus.data.error.message, "归档项目不能更新工作项状态");

    const audits = await jsonRequest(server.baseUrl, "/api/admin/audit/list", {
      method: "POST",
      headers,
      body: { action: "project.item.status", entityType: "project_item", page: 1, pageSize: 100 }
    });
    assert.equal(audits.response.status, 200);
    const statusAudits = audits.data.data.items.filter((item) => (
      item.entityType === "project_item"
      && [feedbackProjectItemId, worktaskProjectItemId].includes(item.entityId)
    ));
    assert.ok(statusAudits.length >= 3);
    const allowedMetadata = new Set(["projectId", "sourceType", "sourceId", "status", "errorCode"]);
    for (const audit of statusAudits) {
      assert.equal(audit.action, "project.item.status");
      assert.ok(Object.keys(audit.metadata).every((key) => allowedMetadata.has(key)));
      assert.equal(audit.metadata.content, undefined);
      assert.equal(audit.metadata.contact, undefined);
      assert.equal(audit.metadata.url, undefined);
      assert.equal(audit.metadata.key, undefined);
      assert.equal(audit.metadata.adminNote, undefined);
      assert.equal(audit.metadata.publicReply, undefined);
    }
  } finally {
    await server.stop();
  }
});
