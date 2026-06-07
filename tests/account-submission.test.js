const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const APP_PATH = path.join(ROOT_DIR, "server", "app.js");
const INTEGRATION_SECRET = "test-integration-secret";

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

function jsonResponse(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function startFakeAccountServer(options = {}) {
  const port = await getFreePort();
  const requests = [];
  const policy = options.policy || {
    feedbackRequiresLogin: true,
    worktaskRequiresLogin: true,
    allowAnonymousSubmission: false
  };
  const ticketUsers = options.ticketUsers || {};

  const server = http.createServer(async (req, res) => {
    requests.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization || ""
    });

    if (req.headers.authorization !== `Bearer ${INTEGRATION_SECRET}`) {
      return jsonResponse(res, 401, { ok: false });
    }

    if (req.method === "GET" && req.url === "/api/integrations/workstation/policy") {
      return jsonResponse(res, 200, { ok: true, policy });
    }

    if (req.method === "POST" && req.url === "/api/integrations/workstation/login-ticket/exchange") {
      const body = await readJsonBody(req);
      const user = ticketUsers[body.ticket];
      if (!user) {
        return jsonResponse(res, 404, { ok: false });
      }
      return jsonResponse(res, 200, { ok: true, user });
    }

    return jsonResponse(res, 404, { ok: false });
  });

  await new Promise((resolve, reject) => {
    server.listen(port, "127.0.0.1", resolve);
    server.on("error", reject);
  });

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function waitForHealth(baseUrl, child, output) {
  const deadline = Date.now() + 10000;
  let lastError = null;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`KWS server exited early with code ${child.exitCode}\n${output.join("")}`);
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

async function startKwsServer(options = {}) {
  const port = await getFreePort();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kws-account-submission-"));
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
    LOG_LEVEL: "fatal",
    ACCESS_LOG_ENABLED: "false",
    SMTP_ENABLED: "false",
    WEBHOOK_ENABLED: "false",
    RATE_LIMIT_SUBMIT_MAX: "1000",
    RATE_LIMIT_LOGIN_MAX: "1000",
    RATE_LIMIT_ADMIN_MAX: "1000",
    KYANET_ACCOUNT_BASE_URL: options.accountBaseUrl || `http://127.0.0.1:${await getFreePort()}`,
    KYANET_ACCOUNT_PUBLIC_URL: options.accountPublicUrl || options.accountBaseUrl || "http://account.local",
    KYANET_ACCOUNT_INTEGRATION_SECRET: INTEGRATION_SECRET,
    KYANET_ACCOUNT_POLICY_CACHE_MS: "0",
    KYANET_ACCOUNT_REQUEST_TIMEOUT_MS: "500"
  };

  const child = spawn(process.execPath, [APP_PATH], {
    cwd: ROOT_DIR,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => output.push(chunk.toString("utf8")));
  child.stderr.on("data", (chunk) => output.push(chunk.toString("utf8")));

  await waitForHealth(baseUrl, child, output);

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

async function requestJson(baseUrl, pathName, options = {}) {
  const method = options.method || "GET";
  const headers = { ...(options.headers || {}) };
  let body = options.body;
  if (body && typeof body !== "string") {
    body = JSON.stringify(body);
    headers["content-type"] = headers["content-type"] || "application/json";
  }

  const response = await fetch(`${baseUrl}${pathName}`, {
    method,
    headers,
    body,
    redirect: options.redirect || "follow"
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function requestRaw(baseUrl, pathName, options = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: options.method || "GET",
    headers: options.headers || {},
    redirect: options.redirect || "manual"
  });
  return response;
}

function accountCookieFrom(response) {
  const setCookie = response.headers.get("set-cookie") || "";
  const match = setCookie.match(/kws_account_sid=[^;]+/);
  assert.ok(match, `expected account cookie in ${setCookie}`);
  return match[0];
}

function adminCookieFrom(response) {
  const setCookie = response.headers.get("set-cookie") || "";
  const match = setCookie.match(/kws_sid=[^;]+/);
  assert.ok(match, `expected admin cookie in ${setCookie}`);
  return match[0];
}

function feedbackPayload(title) {
  return {
    type: "Bug",
    title,
    content: `${title} 的详细内容`,
    contact: "tester@example.com",
    images: []
  };
}

function worktaskPayload(title) {
  return {
    type: "WorkTask提交",
    title,
    content: `${title} 的详细说明`,
    contact: "tester@example.com",
    priority: "medium",
    expectedAt: "",
    tags: "account"
  };
}

async function loginAccount(baseUrl, ticket, returnUrl = "/feedback/") {
  const response = await requestRaw(
    baseUrl,
    `/auth/account/callback?ticket=${encodeURIComponent(ticket)}&returnUrl=${encodeURIComponent(returnUrl)}`
  );
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), returnUrl);
  return accountCookieFrom(response);
}

test("anonymous submissions fail closed when policy fetch is unavailable", async () => {
  const server = await startKwsServer();
  try {
    const { response, data } = await requestJson(server.baseUrl, "/api/feedback", {
      method: "POST",
      body: feedbackPayload("默认拒绝匿名反馈")
    });

    assert.equal(response.status, 401);
    assert.equal(data.error.code, "UNAUTHORIZED");
    assert.equal(data.error.message, "提交前请先登录 KyanetAccount");
  } finally {
    await server.stop();
  }
});

test("policy-enforced feedback and WorkTask reject anonymous submissions", async () => {
  const account = await startFakeAccountServer();
  const server = await startKwsServer({
    accountBaseUrl: account.baseUrl,
    accountPublicUrl: account.baseUrl
  });
  try {
    const feedback = await requestJson(server.baseUrl, "/api/feedback", {
      method: "POST",
      body: feedbackPayload("拒绝匿名反馈")
    });
    const worktask = await requestJson(server.baseUrl, "/api/worktask", {
      method: "POST",
      body: worktaskPayload("拒绝匿名 WorkTask")
    });

    assert.equal(feedback.response.status, 401);
    assert.equal(feedback.data.error.message, "提交前请先登录 KyanetAccount");
    assert.equal(worktask.response.status, 401);
    assert.equal(worktask.data.error.message, "提交前请先登录 KyanetAccount");
  } finally {
    await server.stop();
    await account.close();
  }
});

test("anonymous submissions keep legacy behavior only when policy explicitly allows them", async () => {
  const account = await startFakeAccountServer({
    policy: {
      feedbackRequiresLogin: false,
      worktaskRequiresLogin: false,
      allowAnonymousSubmission: true
    }
  });
  const server = await startKwsServer({
    accountBaseUrl: account.baseUrl,
    accountPublicUrl: account.baseUrl
  });
  try {
    const feedback = await requestJson(server.baseUrl, "/api/feedback", {
      method: "POST",
      body: feedbackPayload("允许匿名反馈")
    });
    const worktask = await requestJson(server.baseUrl, "/api/worktask", {
      method: "POST",
      body: worktaskPayload("允许匿名 WorkTask")
    });

    assert.equal(feedback.response.status, 201);
    assert.equal(feedback.data.ok, true);
    assert.equal(worktask.response.status, 201);
    assert.equal(worktask.data.ok, true);
  } finally {
    await server.stop();
    await account.close();
  }
});

test("account routes create linked submissions, private lists, logout, and keep admin session separate", async () => {
  const account = await startFakeAccountServer({
    ticketUsers: {
      "ticket-alice": {
        id: "acct_alice",
        email: "alice@example.com",
        profile: { displayName: "Alice 用户" }
      },
      "ticket-bob": {
        id: "acct_bob",
        email: "bob@example.com",
        displayName: "Bob 用户"
      }
    }
  });
  const server = await startKwsServer({
    accountBaseUrl: account.baseUrl,
    accountPublicUrl: account.baseUrl
  });

  try {
    const startResponse = await requestRaw(
      server.baseUrl,
      "/auth/account/start?returnUrl=%2Ffeedback%2F"
    );
    assert.equal(startResponse.status, 302);
    const startLocation = new URL(startResponse.headers.get("location"));
    assert.equal(startLocation.origin, account.baseUrl);
    assert.equal(startLocation.pathname, "/workstation/login");
    assert.equal(startLocation.searchParams.get("returnUrl"), `${server.baseUrl}/feedback/`);

    const aliceCookie = await loginAccount(server.baseUrl, "ticket-alice", "/feedback/");
    const bobCookie = await loginAccount(server.baseUrl, "ticket-bob", "/worktask/");

    const accountOnlyAdminMe = await requestJson(server.baseUrl, "/api/admin/me", {
      headers: { cookie: aliceCookie }
    });
    assert.equal(accountOnlyAdminMe.response.status, 401);
    assert.match(accountOnlyAdminMe.data.error.message, /管理员账号/);

    const me = await requestJson(server.baseUrl, "/api/account/me", {
      headers: { cookie: aliceCookie }
    });
    assert.equal(me.response.status, 200);
    assert.deepEqual(me.data.data, {
      id: "acct_alice",
      email: "alice@example.com",
      displayName: "Alice 用户"
    });

    const aliceFeedback = await requestJson(server.baseUrl, "/api/feedback", {
      method: "POST",
      headers: { cookie: aliceCookie },
      body: feedbackPayload("Alice 反馈")
    });
    const aliceWorktask = await requestJson(server.baseUrl, "/api/worktask", {
      method: "POST",
      headers: { cookie: aliceCookie },
      body: worktaskPayload("Alice WorkTask")
    });
    const bobFeedback = await requestJson(server.baseUrl, "/api/feedback", {
      method: "POST",
      headers: { cookie: bobCookie },
      body: feedbackPayload("Bob 反馈")
    });
    const bobWorktask = await requestJson(server.baseUrl, "/api/worktask", {
      method: "POST",
      headers: { cookie: bobCookie },
      body: worktaskPayload("Bob WorkTask")
    });

    assert.equal(aliceFeedback.response.status, 201);
    assert.equal(aliceWorktask.response.status, 201);
    assert.equal(bobFeedback.response.status, 201);
    assert.equal(bobWorktask.response.status, 201);

    const aliceFeedbackList = await requestJson(server.baseUrl, "/api/account/feedback", {
      headers: { cookie: aliceCookie }
    });
    const aliceWorktaskList = await requestJson(server.baseUrl, "/api/account/worktask", {
      headers: { cookie: aliceCookie }
    });
    assert.deepEqual(aliceFeedbackList.data.data.items.map((item) => item.title), ["Alice 反馈"]);
    assert.deepEqual(aliceWorktaskList.data.data.items.map((item) => item.title), ["Alice WorkTask"]);

    const login = await requestJson(server.baseUrl, "/api/admin/login", {
      method: "POST",
      body: { username: "admin", password: "admin-password" }
    });
    assert.equal(login.response.status, 200);
    const adminCookie = adminCookieFrom(login.response);

    const adminFeedback = await requestJson(server.baseUrl, "/api/admin/feedback/list", {
      method: "POST",
      headers: { cookie: adminCookie },
      body: { page: 1, pageSize: 20 }
    });
    const adminWorktask = await requestJson(server.baseUrl, "/api/admin/worktask/list", {
      method: "POST",
      headers: { cookie: adminCookie },
      body: { page: 1, pageSize: 20 }
    });
    const feedbackItem = adminFeedback.data.data.items.find((item) => item.title === "Alice 反馈");
    const worktaskItem = adminWorktask.data.data.items.find((item) => item.title === "Alice WorkTask");

    assert.equal(feedbackItem.accountUserId, "acct_alice");
    assert.equal(feedbackItem.accountEmailSnapshot, "alice@example.com");
    assert.equal(feedbackItem.accountDisplayNameSnapshot, "Alice 用户");
    assert.equal(worktaskItem.accountUserId, "acct_alice");
    assert.equal(worktaskItem.accountEmailSnapshot, "alice@example.com");
    assert.equal(worktaskItem.accountDisplayNameSnapshot, "Alice 用户");

    const logout = await requestJson(server.baseUrl, "/api/account/logout", {
      method: "POST",
      headers: { cookie: aliceCookie },
      body: {}
    });
    assert.equal(logout.response.status, 200);
    assert.match(logout.response.headers.get("set-cookie") || "", /kws_account_sid=;/);

    const meAfterLogout = await requestJson(server.baseUrl, "/api/account/me", {
      headers: { cookie: aliceCookie }
    });
    assert.equal(meAfterLogout.response.status, 401);
  } finally {
    await server.stop();
    await account.close();
  }
});
