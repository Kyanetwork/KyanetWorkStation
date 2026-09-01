const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const APP_PATH = path.join(ROOT_DIR, "server", "app.js");
const MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

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

async function startProvider() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({ url: req.url, body });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        id: "knowledge-provider-request",
        choices: [{ message: { content: JSON.stringify({
          answer: "管理员登录需要有效账号。",
          basis: "document",
          citedSourceIds: ["s-does-not-exist"],
          caveats: ""
        }) } }],
        usage: { prompt_tokens: 5, completion_tokens: 6 }
      }));
    });
  });
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.on("error", reject);
  });
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    stop: () => new Promise((resolve) => server.close(resolve))
  };
}

async function startKwsServer(providerBaseUrl) {
  const port = await getFreePort();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kws-knowledge-api-"));
  const dbPath = path.join(tempDir, "workstation.db");
  const root = path.join(tempDir, "docs");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "guide.md"), "# 登录\n\n管理员登录需要有效账号。\n");
  const baseUrl = `http://127.0.0.1:${port}`;
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
      AI_COPILOT_ENABLED: "true",
      AI_PROFILE_ENCRYPTION_KEY: MASTER_KEY,
      AI_KNOWLEDGE_BASE_DIRS: JSON.stringify([{ id: "docs", name: "Docs", path: root }]),
      AI_KNOWLEDGE_HISTORY_RETENTION_DAYS: "30",
      MEOWSTATUS_ENABLED: "false",
      LOG_LEVEL: "fatal",
      ACCESS_LOG_ENABLED: "false",
      RATE_LIMIT_LOGIN_MAX: "1000",
      RATE_LIMIT_ADMIN_MAX: "1000"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const output = [];
  child.stdout.on("data", (chunk) => output.push(chunk.toString("utf8")));
  child.stderr.on("data", (chunk) => output.push(chunk.toString("utf8")));
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited: ${child.exitCode}\n${output.join("")}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return {
          baseUrl,
          root,
          output,
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
      // Listener may still be bootstrapping.
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  if (child.exitCode === null) child.kill();
  fs.rmSync(tempDir, { recursive: true, force: true });
  throw new Error(`server did not become healthy\n${output.join("")}`);
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
    body
  });
  return { response, data: await response.json().catch(() => ({})) };
}

function cookieFrom(response) {
  const value = response.headers.get("set-cookie") || "";
  const match = value.match(/kws_sid=[^;]+/);
  assert.ok(match, `expected admin cookie in ${value}`);
  return match[0];
}

test("knowledge admin API requires auth and supports status, ask, history, settings, and deletion", async () => {
  const provider = await startProvider();
  const server = await startKwsServer(provider.baseUrl);
  try {
    const anonymous = await requestJson(server.baseUrl, "/api/admin/ai/knowledge/status");
    assert.equal(anonymous.response.status, 401);

    const login = await requestJson(server.baseUrl, "/api/admin/login", {
      method: "POST",
      body: { username: "admin", password: "admin-password" }
    });
    const cookie = cookieFrom(login.response);
    const reindex = await requestJson(server.baseUrl, "/api/admin/ai/knowledge/reindex", {
      method: "POST",
      headers: { cookie },
      body: {}
    });
    assert.equal(reindex.response.status, 200, JSON.stringify(reindex.data));
    assert.equal(reindex.data.data.summary.indexedFiles, 1);

    const status = await requestJson(server.baseUrl, "/api/admin/ai/knowledge/status", { headers: { cookie } });
    assert.equal(status.response.status, 200);
    assert.equal(status.data.data.available, true);
    assert.equal(status.data.data.roots[0].name, "Docs");
    assert.equal(JSON.stringify(status.data).includes(server.root), false);

    const profile = await requestJson(server.baseUrl, "/api/admin/ai/profiles", {
      method: "POST",
      headers: { cookie },
      body: {
        name: "Knowledge Provider",
        protocol: "openai-chat",
        baseUrl: provider.baseUrl,
        model: "knowledge-model",
        key: "provider-secret"
      }
    });
    assert.equal(profile.response.status, 200, JSON.stringify(profile.data));
    await requestJson(server.baseUrl, "/api/admin/ai/profiles/active", {
      method: "POST",
      headers: { cookie },
      body: { profileId: profile.data.data.id }
    });

    const asked = await requestJson(server.baseUrl, "/api/admin/ai/knowledge/ask", {
      method: "POST",
      headers: { cookie },
      body: { question: "登录按钮需要什么？" }
    });
    assert.equal(asked.response.status, 200, JSON.stringify(asked.data));
    assert.equal(asked.data.data.basis, "mixed");
    assert.match(asked.data.data.caveats, /非文档依据/u);
    assert.equal(asked.data.data.usage.inputTokens, 5);
    assert.equal(JSON.stringify(asked.data).includes("provider-secret"), false);
    assert.equal(provider.requests.length, 1);

    const history = await requestJson(server.baseUrl, "/api/admin/ai/knowledge/history", { headers: { cookie } });
    assert.equal(history.response.status, 200);
    assert.equal(history.data.data.total, 1);
    const answerId = history.data.data.items[0].id;

    const settings = await requestJson(server.baseUrl, "/api/admin/ai/knowledge/settings", {
      method: "POST",
      headers: { cookie },
      body: { autoCleanup: false }
    });
    assert.equal(settings.response.status, 200);
    assert.equal(settings.data.data.autoCleanup, false);

    const cleanup = await requestJson(server.baseUrl, "/api/admin/ai/knowledge/history/cleanup", {
      method: "POST",
      headers: { cookie },
      body: {}
    });
    assert.equal(cleanup.response.status, 200);
    assert.equal(cleanup.data.data.deleted, 0);

    const deleted = await requestJson(server.baseUrl, "/api/admin/ai/knowledge/history/delete", {
      method: "POST",
      headers: { cookie },
      body: { id: answerId }
    });
    assert.equal(deleted.response.status, 200);
    assert.equal(deleted.data.data.deleted, 1);

    const knowledgeAudits = await requestJson(server.baseUrl, "/api/admin/audit/list", {
      method: "POST",
      headers: { cookie },
      body: { entityType: "ai_knowledge", pageSize: 100 }
    });
    assert.equal(knowledgeAudits.response.status, 200, JSON.stringify(knowledgeAudits.data));
    assert.ok(knowledgeAudits.data.data.items.length >= 5);
    const reindexAudit = knowledgeAudits.data.data.items.find((item) => item.action === "ai.knowledge.reindex");
    assert.ok(reindexAudit);
    assert.equal(reindexAudit.metadata.indexedFiles, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(reindexAudit.metadata, "relativePath"), false);
    assert.equal(knowledgeAudits.data.data.items.every((item) => item.entityType === "ai_knowledge"), true);
  } finally {
    await server.stop();
    await provider.stop();
  }
});
