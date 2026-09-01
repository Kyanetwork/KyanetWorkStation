const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
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

async function startServer() {
  const port = await getFreePort();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kws-ai-profile-api-"));
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
      AI_COPILOT_ENABLED: "true",
      AI_PROFILE_ENCRYPTION_KEY: MASTER_KEY,
      MEOWSTATUS_ENABLED: "false",
      LOG_LEVEL: "fatal",
      ACCESS_LOG_ENABLED: "false",
      RATE_LIMIT_LOGIN_MAX: "1000",
      RATE_LIMIT_ADMIN_MAX: "1000"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => output.push(chunk.toString("utf8")));
  child.stderr.on("data", (chunk) => output.push(chunk.toString("utf8")));
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`AI profile API server exited: ${child.exitCode}\n${output.join("")}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
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
    } catch (_) {
      // The listener may still be bootstrapping.
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  if (child.exitCode === null) child.kill();
  fs.rmSync(tempDir, { recursive: true, force: true });
  throw new Error(`AI profile API server did not become healthy\n${output.join("")}`);
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
  const setCookie = response.headers.get("set-cookie") || "";
  const match = setCookie.match(/kws_sid=[^;]+/);
  assert.ok(match, `expected admin cookie in ${setCookie}`);
  return match[0];
}

test("admin AI profile API requires a session, masks keys, and hot-switches active profiles", async () => {
  const server = await startServer();
  try {
    const anonymous = await requestJson(server.baseUrl, "/api/admin/ai/status");
    assert.equal(anonymous.response.status, 401);

    const login = await requestJson(server.baseUrl, "/api/admin/login", {
      method: "POST",
      body: { username: "admin", password: "admin-password" }
    });
    assert.equal(login.response.status, 200);
    const cookie = cookieFrom(login.response);

    const initial = await requestJson(server.baseUrl, "/api/admin/ai/status", {
      headers: { cookie }
    });
    assert.equal(initial.response.status, 200);
    assert.equal(initial.data.data.available, false);
    assert.equal(initial.data.data.reason, "no_active_profile");

    const saved = await requestJson(server.baseUrl, "/api/admin/ai/profiles", {
      method: "POST",
      headers: { cookie },
      body: {
        name: "OpenAI",
        protocol: "openai-chat",
        baseUrl: "https://api.openai.com/v1/",
        model: "gpt-4o-mini",
        key: "sk-test-secret-value",
        reasoningEffort: "xhigh",
        promptInstruction: "请优先给出简洁、可执行的建议。"
      }
    });
    assert.equal(saved.response.status, 200);
    assert.equal(saved.data.ok, true);
    assert.equal(saved.data.data.keyConfigured, true);
    assert.match(saved.data.data.keyMask, /•/u);
    assert.equal(saved.data.data.reasoningEffort, "xhigh");
    assert.equal(saved.data.data.promptInstruction, "请优先给出简洁、可执行的建议。");
    assert.equal(JSON.stringify(saved.data).includes("sk-test-secret-value"), false);
    assert.equal(JSON.stringify(saved.data).includes("keyEnvelope"), false);

    const profileId = saved.data.data.id;
    const legacyUpdate = await requestJson(server.baseUrl, "/api/admin/ai/profiles", {
      method: "POST",
      headers: { cookie },
      body: {
        id: profileId,
        name: "OpenAI Legacy Update",
        protocol: "openai-chat",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        key: ""
      }
    });
    assert.equal(legacyUpdate.response.status, 200);
    assert.equal(legacyUpdate.data.data.reasoningEffort, "xhigh");
    assert.equal(legacyUpdate.data.data.promptInstruction, "请优先给出简洁、可执行的建议。");

    const active = await requestJson(server.baseUrl, "/api/admin/ai/profiles/active", {
      method: "POST",
      headers: { cookie },
      body: { profileId }
    });
    assert.equal(active.response.status, 200);
    assert.equal(active.data.data.id, profileId);

    const second = await requestJson(server.baseUrl, "/api/admin/ai/profiles", {
      method: "POST",
      headers: { cookie },
      body: {
        name: "Claude",
        protocol: "anthropic-messages",
        baseUrl: "https://api.anthropic.com",
        model: "claude-3-5-sonnet",
        key: "anthropic-secret"
      }
    });
    assert.equal(second.response.status, 200);
    const secondId = second.data.data.id;

    const updatedWithoutKey = await requestJson(server.baseUrl, "/api/admin/ai/profiles", {
      method: "POST",
      headers: { cookie },
      body: {
        id: profileId,
        name: "OpenAI Updated",
        protocol: "openai-chat",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        key: "",
        reasoning_effort: "high",
        promptInstruction: "更新后的工作指令"
      }
    });
    assert.equal(updatedWithoutKey.response.status, 200);
    assert.equal(updatedWithoutKey.data.data.keyConfigured, true);
    assert.equal(updatedWithoutKey.data.data.reasoningEffort, "high");
    assert.equal(updatedWithoutKey.data.data.promptInstruction, "更新后的工作指令");

    const cleared = await requestJson(server.baseUrl, "/api/admin/ai/profiles", {
      method: "POST",
      headers: { cookie },
      body: {
        id: profileId,
        name: "OpenAI Updated",
        protocol: "openai-chat",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        key: "",
        reasoningEffort: "",
        promptInstruction: ""
      }
    });
    assert.equal(cleared.response.status, 200);
    assert.equal(cleared.data.data.reasoningEffort, "");
    assert.equal(cleared.data.data.promptInstruction, "");

    const switched = await requestJson(server.baseUrl, "/api/admin/ai/profiles/active", {
      method: "POST",
      headers: { cookie },
      body: { profileId: secondId }
    });
    assert.equal(switched.response.status, 200);
    assert.equal(switched.data.data.id, secondId);

    const deleted = await requestJson(server.baseUrl, "/api/admin/ai/profiles/delete", {
      method: "POST",
      headers: { cookie },
      body: { profileId: secondId }
    });
    assert.equal(deleted.response.status, 200);
    assert.equal(deleted.data.data.deleted, true);
    assert.equal(deleted.data.data.activeProfile, null);

    const status = await requestJson(server.baseUrl, "/api/admin/ai/status", {
      headers: { cookie }
    });
    assert.equal(status.data.data.activeProfile, null);
    assert.equal(status.data.data.profiles.length, 1);
  } finally {
    await server.stop();
  }
});

test("AI profile write rejects cross-origin mutations and unsafe profile payloads", async () => {
  const server = await startServer();
  try {
    const login = await requestJson(server.baseUrl, "/api/admin/login", {
      method: "POST",
      body: { username: "admin", password: "admin-password" }
    });
    const cookie = cookieFrom(login.response);
    const crossOrigin = await requestJson(server.baseUrl, "/api/admin/ai/profiles", {
      method: "POST",
      headers: { cookie, origin: "https://evil.example" },
      body: { name: "Provider", protocol: "openai-chat", baseUrl: "https://provider.example", model: "model", key: "key" }
    });
    assert.equal(crossOrigin.response.status, 403);
    assert.equal(crossOrigin.data.error.code, "CSRF_BLOCKED");

    const unsafe = await requestJson(server.baseUrl, "/api/admin/ai/profiles", {
      method: "POST",
      headers: { cookie },
      body: { name: "Provider", protocol: "openai-chat", baseUrl: "https://user:pass@provider.example/v1", model: "model", key: "key" }
    });
    assert.equal(unsafe.response.status, 400);
    assert.equal(unsafe.data.error.code, "INVALID_PAYLOAD");

    const invalidReasoning = await requestJson(server.baseUrl, "/api/admin/ai/profiles", {
      method: "POST",
      headers: { cookie },
      body: {
        name: "Provider",
        protocol: "openai-chat",
        baseUrl: "https://provider.example",
        model: "model",
        key: "key",
        reasoningEffort: "critical"
      }
    });
    assert.equal(invalidReasoning.response.status, 400);
    assert.equal(invalidReasoning.data.error.code, "INVALID_PAYLOAD");

    const explicitNull = await requestJson(server.baseUrl, "/api/admin/ai/profiles", {
      method: "POST",
      headers: { cookie },
      body: {
        name: "Null Provider",
        protocol: "openai-chat",
        baseUrl: "https://provider.example",
        model: "model",
        key: "key",
        reasoningEffort: null,
        promptInstruction: null
      }
    });
    assert.equal(explicitNull.response.status, 400);
    assert.equal(explicitNull.data.error.code, "INVALID_PAYLOAD");
  } finally {
    await server.stop();
  }
});
