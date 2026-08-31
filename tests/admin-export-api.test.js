const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const BetterSqlite3 = require("better-sqlite3");

const ROOT_DIR = path.resolve(__dirname, "..");
const APP_PATH = path.join(ROOT_DIR, "server", "app.js");

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

async function startServer(overrides = {}) {
  const port = await freePort();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kws-admin-export-api-"));
  const dbPath = path.join(tempDir, "workstation.db");
  const baseUrl = `http://127.0.0.1:${port}`;
  const output = [];
  const child = spawn(process.execPath, [APP_PATH], {
    cwd: ROOT_DIR,
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
      RATE_LIMIT_SUBMIT_MAX: "1000",
      RATE_LIMIT_LOGIN_MAX: "1000",
      RATE_LIMIT_ADMIN_MAX: "1000",
      ...overrides
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => output.push(chunk.toString("utf8")));
  child.stderr.on("data", (chunk) => output.push(chunk.toString("utf8")));
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited: ${child.exitCode}\n${output.join("")}`);
    try {
      const health = await fetch(`${baseUrl}/api/health`);
      if (health.ok) {
        return {
          baseUrl,
          dbPath,
          stop: async () => {
            if (child.exitCode === null) {
              child.kill();
              await new Promise((resolve) => child.once("exit", resolve));
            }
            fs.rmSync(tempDir, { recursive: true, force: true });
          }
        };
      }
    } catch (_) {
      // Listener is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  if (child.exitCode === null) child.kill();
  fs.rmSync(tempDir, { recursive: true, force: true });
  throw new Error(`server did not become healthy\n${output.join("")}`);
}

async function request(baseUrl, pathname, options = {}) {
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
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("json") ? await response.json().catch(() => ({})) : null;
  const text = data === null ? Buffer.from(await response.arrayBuffer()).toString("utf8") : "";
  return { response, data, text };
}

function cookieFrom(response) {
  const setCookie = response.headers.get("set-cookie") || "";
  const match = setCookie.match(/kws_sid=[^;]+/);
  assert.ok(match, `expected session cookie in ${setCookie}`);
  return match[0];
}

async function login(server) {
  const result = await request(server.baseUrl, "/api/admin/login", {
    method: "POST",
    body: { username: "admin", password: "admin-password" }
  });
  assert.equal(result.response.status, 200);
  return cookieFrom(result.response);
}

test("admin CSV exports and audit query require a session and return filtered server output", async () => {
  const server = await startServer();
  try {
    const anonymous = await request(server.baseUrl, "/api/admin/feedback/export", { method: "POST", body: {} });
    assert.equal(anonymous.response.status, 401);
    const anonymousAudit = await request(server.baseUrl, "/api/admin/audit/list", { method: "POST", body: {} });
    assert.equal(anonymousAudit.response.status, 401);

    const feedback = await request(server.baseUrl, "/api/feedback", {
      method: "POST",
      body: { type: "Bug", title: "CSV 反馈", content: "含,逗号", contact: "private@example.com", images: [] }
    });
    assert.equal(feedback.response.status, 201);
    const cookie = await login(server);
    const headers = { cookie };

    const exported = await request(server.baseUrl, "/api/admin/feedback/export", {
      method: "POST",
      headers,
      body: { keyword: "CSV" }
    });
    assert.equal(exported.response.status, 200);
    assert.match(exported.response.headers.get("content-type"), /text\/csv/);
    assert.match(exported.response.headers.get("content-disposition"), /feedback_export_/);
    assert.equal(exported.response.headers.get("x-export-count"), "1");
    assert.match(exported.text, /^\ufeffid,type,title/);
    assert.match(exported.text, /CSV 反馈/u);

    const worktask = await request(server.baseUrl, "/api/worktask", {
      method: "POST",
      body: { type: "WorkTask提交", title: "CSV 任务", content: "任务内容", contact: "private@example.com", priority: "urgent", expectedAt: "", tags: "" }
    });
    assert.equal(worktask.response.status, 201);
    const worktaskExport = await request(server.baseUrl, "/api/admin/worktask/export", {
      method: "POST",
      headers,
      body: { priority: "urgent" }
    });
    assert.equal(worktaskExport.response.status, 200);
    assert.equal(worktaskExport.response.headers.get("x-export-count"), "1");
    assert.match(worktaskExport.text, /CSV 任务/u);

    const audits = await request(server.baseUrl, "/api/admin/audit/list", {
      method: "POST",
      headers,
      body: { action: "feedback.export", page: 1, pageSize: 100 }
    });
    assert.equal(audits.response.status, 200);
    assert.equal(audits.data.ok, true);
    assert.equal(audits.data.data.total, 1);
    assert.equal(audits.data.data.items[0].result, "success");
    assert.equal(audits.data.data.items[0].metadata.hasKeyword, true);
  } finally {
    await server.stop();
  }
});

test("admin CSV export rejects totals above configured limit and records a rejected audit", async () => {
  const server = await startServer({ ADMIN_EXPORT_MAX_ROWS: "100" });
  let db = null;
  try {
    db = new BetterSqlite3(server.dbPath);
    const insert = db.prepare("INSERT INTO feedback (type, title, content, contact, images, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    const insertMany = db.transaction(() => {
      for (let index = 0; index < 101; index += 1) {
        const createdAt = new Date(Date.UTC(2026, 7, 29, 0, 0, index)).toISOString();
        insert.run("Bug", `limit-${index}`, "content", "contact", "[]", "new", createdAt, createdAt);
      }
    });
    insertMany();
    db.close();
    db = null;

    const cookie = await login(server);
    const result = await request(server.baseUrl, "/api/admin/feedback/export", {
      method: "POST",
      headers: { cookie },
      body: {}
    });
    assert.equal(result.response.status, 413);
    assert.equal(result.data.error.code, "EXPORT_LIMIT_EXCEEDED");

    const audits = await request(server.baseUrl, "/api/admin/audit/list", {
      method: "POST",
      headers: { cookie },
      body: { action: "feedback.export" }
    });
    assert.equal(audits.data.data.total, 1);
    assert.equal(audits.data.data.items[0].result, "rejected");
    assert.equal(audits.data.data.items[0].metadata.rowCount, 101);
    assert.equal(audits.data.data.items[0].metadata.maxRows, 100);
  } finally {
    if (db) db.close();
    await server.stop();
  }
});
