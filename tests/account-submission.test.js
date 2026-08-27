const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const APP_PATH = path.join(ROOT_DIR, "server", "app.js");

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

async function waitForHealth(baseUrl, child, output) {
  const deadline = Date.now() + 10000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`KWS server exited early (${child.exitCode})\n${output.join("")}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
      lastError = new Error(`health status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`KWS server did not become healthy: ${lastError && lastError.message}\n${output.join("")}`);
}

async function startKwsServer() {
  const port = await getFreePort();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kws-api-smoke-"));
  const dbPath = path.join(tempDir, "workstation.db");
  const baseUrl = `http://127.0.0.1:${port}`;
  const output = [];
  const env = {
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
    SMTP_ENABLED: "false",
    WEBHOOK_ENABLED: "false",
    RATE_LIMIT_SUBMIT_MAX: "1000",
    RATE_LIMIT_LOGIN_MAX: "1000",
    RATE_LIMIT_ADMIN_MAX: "1000"
  };
  const child = spawn(process.execPath, [APP_PATH], {
    cwd: ROOT_DIR,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => output.push(chunk.toString("utf8")));
  child.stderr.on("data", (chunk) => output.push(chunk.toString("utf8")));
  try {
    await waitForHealth(baseUrl, child, output);
  } catch (error) {
    if (child.exitCode === null) child.kill();
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
  return {
    baseUrl,
    stop: async () => {
      if (child.exitCode === null) {
        child.kill();
        await new Promise((resolve) => child.once("exit", resolve));
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

async function requestJson(baseUrl, pathname, options = {}) {
  const headers = { ...(options.headers || {}) };
  let body = options.body;
  if (body && typeof body !== "string") {
    body = JSON.stringify(body);
    headers["content-type"] = headers["content-type"] || "application/json";
  }
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || "GET",
    headers,
    body,
    redirect: options.redirect || "follow"
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function cookieFrom(response, name) {
  const setCookie = response.headers.get("set-cookie") || "";
  const match = setCookie.match(new RegExp(`${name}=[^;]+`));
  assert.ok(match, `expected ${name} cookie in ${setCookie}`);
  return match[0];
}

function feedbackPayload(title) {
  return {
    type: "Bug",
    title,
    content: `${title} 的内部详细内容`,
    contact: "private@example.com",
    images: []
  };
}

function worktaskPayload(title) {
  return {
    type: "WorkTask提交",
    title,
    content: `${title} 的内部详细说明`,
    contact: "private@example.com",
    priority: "high",
    expectedAt: "",
    tags: "smoke"
  };
}

test("匿名 API、Account 下线、公开 DTO 和 WorkTask 清空流程可重复运行", async () => {
  const server = await startKwsServer();
  try {
    const feedback = await requestJson(server.baseUrl, "/api/feedback", {
      method: "POST",
      body: feedbackPayload("匿名反馈")
    });
    const worktask = await requestJson(server.baseUrl, "/api/worktask", {
      method: "POST",
      body: worktaskPayload("匿名 WorkTask")
    });
    assert.equal(feedback.response.status, 201);
    assert.equal(feedback.data.ok, true);
    assert.equal(worktask.response.status, 201);
    assert.equal(worktask.data.ok, true);

    const meowStatus = await requestJson(server.baseUrl, "/api/public/meowstatus");
    assert.equal(meowStatus.response.status, 200);
    assert.equal(meowStatus.data.data.state, "disabled");
    assert.equal(meowStatus.data.data.settings.profileEnabled, false);
    assert.equal(meowStatus.data.data.settings.minecraftEnabled, false);

    for (const pathname of ["/api/account/me", "/api/account/feedback", "/api/account/worktask"]) {
      const response = await requestJson(server.baseUrl, pathname);
      assert.equal(response.response.status, 404, `legacy route ${pathname} should be removed`);
      assert.equal(response.data.error.code, "NOT_FOUND");
    }
    for (const pathname of ["/auth/account/start", "/auth/account/callback"]) {
      const response = await fetch(`${server.baseUrl}${pathname}`);
      assert.equal(response.status, 404, `legacy route ${pathname} should be removed`);
    }

    const login = await requestJson(server.baseUrl, "/api/admin/login", {
      method: "POST",
      body: { username: "admin", password: "admin-password" }
    });
    assert.equal(login.response.status, 200);
    const adminCookie = cookieFrom(login.response, "kws_sid");
    const headers = { cookie: adminCookie };

    const feedbackList = await requestJson(server.baseUrl, "/api/admin/feedback/list", {
      method: "POST",
      headers,
      body: { page: 1, pageSize: 20 }
    });
    const feedbackItem = feedbackList.data.data.items.find((item) => item.title === "匿名反馈");
    assert.ok(feedbackItem);
    const worktaskList = await requestJson(server.baseUrl, "/api/admin/worktask/list", {
      method: "POST",
      headers,
      body: { page: 1, pageSize: 20 }
    });
    const worktaskItem = worktaskList.data.data.items.find((item) => item.title === "匿名 WorkTask");
    assert.ok(worktaskItem);

    const homeDisplay = await requestJson(server.baseUrl, "/api/admin/feedback/home-display", {
      method: "POST",
      headers,
      body: { id: feedbackItem.id, showOnHome: true }
    });
    assert.equal(homeDisplay.response.status, 200);
    const noteReply = await requestJson(server.baseUrl, "/api/admin/feedback/note-reply", {
      method: "POST",
      headers,
      body: { id: feedbackItem.id, adminNote: "只限后台", publicReply: "公开回复" }
    });
    assert.equal(noteReply.response.status, 200);
    const highlights = await requestJson(server.baseUrl, "/api/public/highlights");
    assert.equal(highlights.response.status, 200);
    const publicFeedback = highlights.data.data.feedbackItems.find((item) => item.id === feedbackItem.id);
    assert.ok(publicFeedback);
    assert.deepEqual(Object.keys(publicFeedback).sort(), ["id", "publicReply", "status", "title", "type", "updatedAt"].sort());
    assert.equal(publicFeedback.content, undefined);
    assert.equal(publicFeedback.contact, undefined);
    assert.equal(publicFeedback.adminNote, undefined);

    const arrange = await requestJson(server.baseUrl, "/api/admin/worktask/arrange", {
      method: "POST",
      headers,
      body: { id: worktaskItem.id, assignee: "Kyan", scheduledAt: "2030-01-02T03:04:05.000Z" }
    });
    assert.equal(arrange.response.status, 200);
    let arranged = await requestJson(server.baseUrl, "/api/admin/worktask/list", {
      method: "POST",
      headers,
      body: { page: 1, pageSize: 20 }
    });
    let arrangedItem = arranged.data.data.items.find((item) => item.id === worktaskItem.id);
    assert.equal(arrangedItem.assignee, "Kyan");
    assert.equal(arrangedItem.scheduledAt, "2030-01-02T03:04:05.000Z");
    assert.equal(arrangedItem.status, "scheduled");

    const clearAssignee = await requestJson(server.baseUrl, "/api/admin/worktask/arrange", {
      method: "POST",
      headers,
      body: { id: worktaskItem.id, assignee: null }
    });
    assert.equal(clearAssignee.response.status, 200);
    const clearSchedule = await requestJson(server.baseUrl, "/api/admin/worktask/arrange", {
      method: "POST",
      headers,
      body: { id: worktaskItem.id, scheduledAt: "" }
    });
    assert.equal(clearSchedule.response.status, 200);
    arranged = await requestJson(server.baseUrl, "/api/admin/worktask/list", {
      method: "POST",
      headers,
      body: { page: 1, pageSize: 20 }
    });
    arrangedItem = arranged.data.data.items.find((item) => item.id === worktaskItem.id);
    assert.equal(arrangedItem.assignee, "");
    assert.equal(arrangedItem.scheduledAt, "");
    assert.equal(arrangedItem.status, "scheduled");
  } finally {
    await server.stop();
  }
});
