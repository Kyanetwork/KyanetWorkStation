const test = require("node:test");
const assert = require("node:assert/strict");

const {
  safeOriginFromUrl,
  getRequestOrigin,
  createRequireSameOriginForAdminMutation,
  requireJsonForAdminMutation
} = require("../server/security");

function createReq(options = {}) {
  const headers = {};
  for (const [key, value] of Object.entries(options.headers || {})) {
    headers[String(key).toLowerCase()] = value;
  }
  return {
    method: options.method || "POST",
    protocol: options.protocol || "http",
    get(name) {
      return headers[String(name).toLowerCase()] || "";
    },
    is(contentType) {
      const actual = String(headers["content-type"] || "").toLowerCase();
      return actual.includes(String(contentType).toLowerCase());
    }
  };
}

function createRes() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.payload = data;
      return this;
    }
  };
}

function runMiddleware(mw, req, res) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const done = (error) => {
      if (finished) return;
      finished = true;
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };

    try {
      mw(req, res, (err) => {
        done(err || null);
      });
      setImmediate(() => {
        if (res.payload || res.statusCode >= 400) {
          done(null);
        }
      });
    } catch (error) {
      done(error);
    }
  });
}

test("safeOriginFromUrl returns empty string for invalid URL", () => {
  assert.equal(safeOriginFromUrl("not-a-url"), "");
  assert.equal(safeOriginFromUrl(""), "");
});

test("getRequestOrigin prefers forwarded headers", () => {
  const req = createReq({
    headers: {
      host: "127.0.0.1:3000",
      "x-forwarded-proto": "https",
      "x-forwarded-host": "workstation.example.com"
    }
  });
  assert.equal(getRequestOrigin(req), "https://workstation.example.com");
});

test("same-origin admin mutation is allowed", async () => {
  const req = createReq({
    headers: {
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
      "content-type": "application/json"
    }
  });
  const res = createRes();
  const mw = createRequireSameOriginForAdminMutation({ appBaseUrl: "http://127.0.0.1:3000" });
  await runMiddleware(mw, req, res);
  assert.equal(res.payload, null);
});

test("cross-origin admin mutation is blocked", async () => {
  const req = createReq({
    headers: {
      host: "127.0.0.1:3000",
      origin: "https://evil.example"
    }
  });
  const res = createRes();
  const mw = createRequireSameOriginForAdminMutation({ appBaseUrl: "http://127.0.0.1:3000" });
  await runMiddleware(mw, req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.error.code, "CSRF_BLOCKED");
});

test("headerless admin mutation is blocked by default", async () => {
  const req = createReq({
    headers: {
      host: "127.0.0.1:3000"
    }
  });
  const res = createRes();
  const mw = createRequireSameOriginForAdminMutation({ appBaseUrl: "http://127.0.0.1:3000" });
  await runMiddleware(mw, req, res);
  assert.equal(res.statusCode, 403);
});

test("headerless admin mutation can be allowed by config", async () => {
  const req = createReq({
    headers: {
      host: "127.0.0.1:3000"
    }
  });
  const res = createRes();
  const mw = createRequireSameOriginForAdminMutation({
    appBaseUrl: "http://127.0.0.1:3000",
    allowHeaderlessAdminMutation: true
  });
  await runMiddleware(mw, req, res);
  assert.equal(res.payload, null);
});

test("requireJsonForAdminMutation rejects non-json requests", async () => {
  const req = createReq({
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    }
  });
  const res = createRes();
  await runMiddleware(requireJsonForAdminMutation, req, res);
  assert.equal(res.statusCode, 415);
  assert.equal(res.payload.error.code, "UNSUPPORTED_MEDIA_TYPE");
});

