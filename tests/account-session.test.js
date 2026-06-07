const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const accountSessionPath = path.resolve(__dirname, "..", "server", "account-session.js");
const dbPath = path.resolve(__dirname, "..", "server", "db.js");
const configPath = path.resolve(__dirname, "..", "server", "config.js");

function loadAccountSessionWithDb(dbOverrides) {
  const previousDbCache = require.cache[dbPath];
  delete require.cache[accountSessionPath];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      nowIso: () => "2026-06-07T00:00:00.000Z",
      createAccountSessionRecord: async () => {},
      deleteAccountSessionByTokenHash: async () => {},
      findAccountSessionByTokenHash: async () => null,
      deleteAccountSessionById: async () => {},
      touchAccountSessionLastSeen: async () => {},
      ...dbOverrides
    }
  };

  const accountSession = require(accountSessionPath);
  delete require.cache[accountSessionPath];
  if (previousDbCache) {
    require.cache[dbPath] = previousDbCache;
  } else {
    delete require.cache[dbPath];
  }
  return accountSession;
}

function createReq(cookieName, rawToken) {
  return {
    cookies: rawToken ? { [cookieName]: rawToken } : {},
    ip: "127.0.0.1",
    get(name) {
      return name.toLowerCase() === "user-agent" ? "node-test" : "";
    }
  };
}

function createRes() {
  return {
    statusCode: 200,
    payload: null,
    clearedCookies: [],
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.payload = data;
      return this;
    },
    clearCookie(name, options) {
      this.clearedCookies.push({ name, options });
      return this;
    }
  };
}

async function runMiddleware(mw, req, res) {
  await new Promise((resolve, reject) => {
    let settled = false;
    const done = (error) => {
      if (settled) return;
      settled = true;
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };

    mw(req, res, done);
    setImmediate(() => {
      if (res.payload || res.statusCode >= 400) {
        done(null);
      }
    });
  });
}

test("requireAccountSession returns 401 with Chinese message when account cookie is missing", async () => {
  const { requireAccountSession, accountCookieName } = loadAccountSessionWithDb({});
  const req = createReq(accountCookieName, "");
  const res = createRes();

  await runMiddleware(requireAccountSession, req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.error.code, "UNAUTHORIZED");
  assert.match(res.payload.error.message, /请先登录账号/);
});

test("expired account session clears account cookie", async () => {
  const { requireAccountSession, accountCookieName } = loadAccountSessionWithDb({
    findAccountSessionByTokenHash: async () => ({
      session_id: 12,
      account_user_id: "acct_1",
      account_email: "user@example.com",
      account_display_name: "Kyan",
      expires_at: "2020-01-01T00:00:00.000Z"
    })
  });
  const req = createReq(accountCookieName, "raw-account-token");
  const res = createRes();

  await runMiddleware(requireAccountSession, req, res);

  assert.equal(res.statusCode, 401);
  assert.match(res.payload.error.message, /账号登录已过期/);
  assert.deepEqual(res.clearedCookies.map((item) => item.name), [accountCookieName]);
});

test("account session cookie does not satisfy admin session", async () => {
  const { requireAccountSession, accountCookieName } = loadAccountSessionWithDb({
    findAccountSessionByTokenHash: async () => ({
      session_id: 18,
      account_user_id: "acct_1",
      account_email: "user@example.com",
      account_display_name: "Kyan",
      expires_at: "2999-01-01T00:00:00.000Z"
    })
  });
  const { requireAdminSession } = require("../server/auth");
  const req = createReq(accountCookieName, "raw-account-token");
  const accountRes = createRes();
  const adminRes = createRes();

  await runMiddleware(requireAccountSession, req, accountRes);
  await runMiddleware(requireAdminSession, req, adminRes);

  assert.equal(accountRes.statusCode, 200);
  assert.equal(req.accountUser.id, "acct_1");
  assert.equal(adminRes.statusCode, 401);
  assert.match(adminRes.payload.error.message, /管理员账号/);
});

test("account session records are stored and deleted in sqlite", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kws-account-session-"));
  const dbFile = path.join(tempDir, "workstation.db");
  const previousEnv = {
    DB_CLIENT: process.env.DB_CLIENT,
    DB_PATH: process.env.DB_PATH
  };

  process.env.DB_CLIENT = "sqlite";
  process.env.DB_PATH = dbFile;
  delete require.cache[configPath];
  delete require.cache[dbPath];

  const db = require(dbPath);
  try {
    await db.initializeDatabase();
    await db.createAccountSessionRecord({
      accountUserId: "acct_1",
      accountEmail: "user@example.com",
      accountDisplayName: "测试用户",
      tokenHash: "hashed-token",
      ip: "127.0.0.1",
      userAgent: "node-test",
      createdAt: "2026-06-07T00:00:00.000Z",
      expiresAt: "2999-01-01T00:00:00.000Z",
      lastSeenAt: "2026-06-07T00:00:00.000Z"
    });

    const found = await db.findAccountSessionByTokenHash("hashed-token");
    assert.equal(found.account_user_id, "acct_1");
    assert.equal(found.account_email, "user@example.com");
    assert.equal(found.account_display_name, "测试用户");

    await db.touchAccountSessionLastSeen(found.session_id, "2026-06-07T00:01:00.000Z");
    const touched = await db.findAccountSessionByTokenHash("hashed-token");
    assert.equal(touched.last_seen_at, "2026-06-07T00:01:00.000Z");

    await db.deleteAccountSessionByTokenHash("hashed-token");
    assert.equal(await db.findAccountSessionByTokenHash("hashed-token"), null);
  } finally {
    await db.closeDatabase();
    delete require.cache[configPath];
    delete require.cache[dbPath];
    if (previousEnv.DB_CLIENT === undefined) {
      delete process.env.DB_CLIENT;
    } else {
      process.env.DB_CLIENT = previousEnv.DB_CLIENT;
    }
    if (previousEnv.DB_PATH === undefined) {
      delete process.env.DB_PATH;
    } else {
      process.env.DB_PATH = previousEnv.DB_PATH;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
