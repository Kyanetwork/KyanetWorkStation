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
