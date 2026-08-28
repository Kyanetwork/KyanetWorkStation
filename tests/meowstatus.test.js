const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const {
  fetchMeowStatusDashboard,
  normalizeBaseUrl,
  normalizeDashboard,
  normalizeFaviconDataUrl,
  MAX_DASHBOARD_BYTES,
  MAX_FAVICON_BYTES,
  MAX_FAVICON_TEXT_BYTES
} = require("../server/meowstatus");

function startFixture(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(() => done()))
      });
    });
  });
}

test("MeowStatus normalizes only bounded public fields and safe raster favicon", () => {
  const dashboard = normalizeDashboard({
    profile_status: {
      state: "working",
      note: "n".repeat(5000),
      updated_at: "2026-08-27T00:00:00.000Z",
      secret: "do-not-return"
    },
    widgets: [{
      id: "widget-1",
      kind: "minecraft-java",
      name: "n".repeat(5000),
      enabled: true,
      config: {
        host: "mc.example.test",
        port: 25565,
        password: "do-not-return"
      },
      last_payload: {
        provider: "minecraft",
        target: "mc.example.test:25565",
        online: true,
        motd: "m".repeat(5000),
        players_online: 3,
        players_max: 20,
        latency_ms: 42,
        favicon: "data:image/svg+xml;base64,PHN2Zy8+",
        secret: "do-not-return"
      },
      last_error: "e".repeat(5000),
      private_field: "do-not-return"
    }]
  });

  assert.equal(dashboard.profile.state, "working");
  assert.ok(dashboard.profile.note.length < 5000);
  assert.equal(dashboard.minecraftWidgets.length, 1);
  assert.ok(dashboard.minecraftWidgets[0].name.length < 5000);
  assert.deepEqual(dashboard.minecraftWidgets[0].config, {
    host: "mc.example.test",
    port: 25565
  });
  assert.equal(dashboard.minecraftWidgets[0].lastPayload.favicon, "");
  assert.equal(dashboard.minecraftWidgets[0].lastPayload.secret, undefined);
  assert.ok(dashboard.minecraftWidgets[0].lastPayload.motd.length < 5000);
  assert.ok(dashboard.minecraftWidgets[0].lastError.length < 5000);
});

test("MeowStatus rejects base URLs that contain embedded credentials", () => {
  assert.equal(normalizeBaseUrl("https://user:pass@example.test"), "");
});

test("MeowStatus accepts JSON MIME and rejects HTML or invalid JSON", async () => {
  const fixture = await startFixture((req, res) => {
    if (req.url === "/json/api/dashboard") {
      res.writeHead(200, { "content-type": "application/problem+json; charset=utf-8" });
      res.end(JSON.stringify({ profile_status: { state: "resting" }, widgets: [] }));
      return;
    }
    if (req.url === "/html/api/dashboard") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html>not json</html>");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{invalid");
  });

  try {
    const valid = await fetchMeowStatusDashboard({ baseUrl: `${fixture.baseUrl}/json`, timeoutMs: 1000 });
    assert.equal(valid.profile.state, "resting");
    await assert.rejects(
      fetchMeowStatusDashboard({ baseUrl: `${fixture.baseUrl}/html`, timeoutMs: 1000 }),
      /JSON/iu
    );
    await assert.rejects(
      fetchMeowStatusDashboard({ baseUrl: `${fixture.baseUrl}/invalid`, timeoutMs: 1000 }),
      /JSON/iu
    );
  } finally {
    await fixture.close();
  }
});

test("MeowStatus rejects declared and streamed dashboard responses above the byte limit", async () => {
  const fixture = await startFixture((req, res) => {
    if (req.url === "/declared/api/dashboard") {
      res.writeHead(200, {
        "content-type": "application/json",
        "content-length": String(MAX_DASHBOARD_BYTES + 1)
      });
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.write("x".repeat(128 * 1024));
    res.end("x".repeat(MAX_DASHBOARD_BYTES));
  });

  try {
    await assert.rejects(
      fetchMeowStatusDashboard({ baseUrl: `${fixture.baseUrl}/declared`, timeoutMs: 1000 }),
      /大小|过大/iu
    );
    await assert.rejects(
      fetchMeowStatusDashboard({ baseUrl: `${fixture.baseUrl}/streamed`, timeoutMs: 1000 }),
      /大小|过大/iu
    );
  } finally {
    await fixture.close();
  }
});

test("MeowStatus turns a slow upstream into a bounded timeout error", async () => {
  const fixture = await startFixture((req, res) => {
    setTimeout(() => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    }, 1500);
  });

  try {
    await assert.rejects(
      fetchMeowStatusDashboard({ baseUrl: fixture.baseUrl, timeoutMs: 1000 }),
      /超时/iu
    );
  } finally {
    await fixture.close();
  }
});

test("favicon normalization accepts bounded PNG data and rejects unsafe or oversized data", () => {
  const tinyPng = "data:image/png;base64,iVBORw0KGgo=";
  assert.equal(normalizeFaviconDataUrl(tinyPng), tinyPng);
  assert.equal(normalizeFaviconDataUrl("https://example.test/icon.png"), "");
  assert.equal(normalizeFaviconDataUrl("data:image/svg+xml;base64,PHN2Zy8+"), "");
  assert.equal(normalizeFaviconDataUrl("data:image/png;base64,not-base64!"), "");
  assert.equal(
    normalizeFaviconDataUrl(`data:image/png;base64,${"A".repeat(MAX_FAVICON_TEXT_BYTES)}`),
    ""
  );
  const oversized = Buffer.alloc(MAX_FAVICON_BYTES + 1, 0);
  assert.equal(
    normalizeFaviconDataUrl(`data:image/png;base64,${oversized.toString("base64")}`),
    ""
  );
});
