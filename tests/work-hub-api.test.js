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
    const listener = net.createServer();
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      const port = address && typeof address === "object" ? address.port : 0;
      listener.close(() => resolve(port));
    });
    listener.on("error", reject);
  });
}

async function startServer() {
  const port = await freePort();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kws-work-hub-api-"));
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
      SMTP_ENABLED: "false",
      WEBHOOK_ENABLED: "false",
      LOG_LEVEL: "fatal",
      ACCESS_LOG_ENABLED: "false",
      RATE_LIMIT_LOGIN_MAX: "1000",
      RATE_LIMIT_ADMIN_MAX: "1000",
      RATE_LIMIT_SUBMIT_MAX: "1000"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => output.push(chunk.toString("utf8")));
  child.stderr.on("data", (chunk) => output.push(chunk.toString("utf8")));

  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited: ${child.exitCode}\n${output.join("")}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return {
          baseUrl,
          dbPath,
          async stop() {
            if (child.exitCode === null) {
              child.kill();
              await new Promise((resolve) => child.once("exit", resolve));
            }
            fs.rmSync(tempDir, { recursive: true, force: true });
          }
        };
      }
    } catch (_) {
      // Retry until startup deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (child.exitCode === null) child.kill();
  fs.rmSync(tempDir, { recursive: true, force: true });
  throw new Error(`server did not become healthy\n${output.join("")}`);
}

async function jsonRequest(baseUrl, pathname, options = {}) {
  const headers = { ...(options.headers || {}) };
  let body = options.body;
  if (body && typeof body !== "string") {
    body = JSON.stringify(body);
    headers["content-type"] = headers["content-type"] || "application/json";
  }
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || "GET",
    headers,
    body
  });
  return { response, data: await response.json().catch(() => ({})) };
}

function cookieFrom(response) {
  const setCookie = response.headers.get("set-cookie") || "";
  const match = setCookie.match(/kws_sid=[^;]+/);
  assert.ok(match, `expected admin cookie in ${setCookie}`);
  return match[0];
}

test("Work Hub 管理 API 需要会话、返回安全 envelope 并可精确定位条目", async () => {
  const server = await startServer();
  try {
    const anonymous = await jsonRequest(server.baseUrl, "/api/admin/work-hub/overview");
    assert.equal(anonymous.response.status, 401);
    assert.equal(anonymous.data.ok, false);
    assert.equal(anonymous.data.error.code, "UNAUTHORIZED");

    const login = await jsonRequest(server.baseUrl, "/api/admin/login", {
      method: "POST",
      body: { username: "admin", password: "admin-password" }
    });
    assert.equal(login.response.status, 200);
    const headers = { cookie: cookieFrom(login.response) };

    const feedback = await jsonRequest(server.baseUrl, "/api/feedback", {
      method: "POST",
      body: {
        type: "Bug",
        title: "Work Hub API 反馈",
        content: "不应出现在 Work Hub 响应中的正文",
        contact: "private@example.com",
        images: []
      }
    });
    assert.equal(feedback.response.status, 201);
    const feedbackId = feedback.data.data.id;

    const now = Date.now();
    const worktask = await jsonRequest(server.baseUrl, "/api/admin/worktask/create", {
      method: "POST",
      headers,
      body: {
        type: "任务安排",
        title: "Work Hub API 逾期任务",
        content: "不应出现在 Work Hub 响应中的任务正文",
        priority: "urgent",
        status: "scheduled",
        showOnHome: false,
        scheduledAt: new Date(now - 60 * 60 * 1000).toISOString(),
        assignee: ""
      }
    });
    assert.equal(worktask.response.status, 201);
    const worktaskId = worktask.data.data.id;

    const overview = await jsonRequest(server.baseUrl, "/api/admin/work-hub/overview", { headers });
    assert.equal(overview.response.status, 200);
    assert.equal(overview.data.ok, true);
    assert.equal(overview.data.data.sections.overdue.items.some((item) => item.sourceId === worktaskId), true);
    assert.equal(overview.data.data.sections.recent.items.some((item) => item.sourceId === feedbackId), true);
    assert.equal(overview.data.data.sections.recent.items.some((item) => item.sourceId === worktaskId), true);
    const serialized = JSON.stringify(overview.data);
    for (const forbidden of ["不应出现在 Work Hub 响应中的正文", "private@example.com", "adminNote", "accountUserId", "contact"]) {
      assert.equal(serialized.includes(forbidden), false, `forbidden field leaked: ${forbidden}`);
    }

    const feedbackList = await jsonRequest(server.baseUrl, "/api/admin/feedback/list", {
      method: "POST",
      headers,
      body: { id: feedbackId }
    });
    assert.equal(feedbackList.response.status, 200);
    assert.deepEqual(feedbackList.data.data.items.map((item) => item.id), [feedbackId]);

    const worktaskList = await jsonRequest(server.baseUrl, "/api/admin/worktask/list", {
      method: "POST",
      headers,
      body: { id: worktaskId }
    });
    assert.equal(worktaskList.response.status, 200);
    assert.deepEqual(worktaskList.data.data.items.map((item) => item.id), [worktaskId]);

    const invalidId = await jsonRequest(server.baseUrl, "/api/admin/worktask/list", {
      method: "POST",
      headers,
      body: { id: "0" }
    });
    assert.equal(invalidId.response.status, 400);
    assert.equal(invalidId.data.error.code, "INVALID_PAYLOAD");
  } finally {
    await server.stop();
  }
});
