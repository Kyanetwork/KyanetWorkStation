const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const {
  EXPORT_BATCH_SIZE,
  csvEscape,
  writeCsvExport
} = require("../server/admin-export");

class FakeResponse extends EventEmitter {
  constructor({ backpressure = false, closeOnBackpressure = false } = {}) {
    super();
    this.headers = {};
    this.writes = [];
    this.backpressure = backpressure;
    this.closeOnBackpressure = closeOnBackpressure;
    this.endCalled = false;
    this.destroyCalled = false;
  }

  setHeader(name, value) {
    this.headers[name.toLowerCase()] = String(value);
  }

  write(chunk) {
    this.writes.push(String(chunk));
    if (this.backpressure) {
      this.backpressure = false;
      setImmediate(() => this.emit(this.closeOnBackpressure ? "close" : "drain"));
      return false;
    }
    return true;
  }

  end() {
    this.endCalled = true;
  }

  destroy() {
    this.destroyCalled = true;
  }
}

test("CSV escaping quotes every value and doubles embedded quotes", () => {
  assert.equal(csvEscape("a,b\"c\n中文"), '"a,b""c\n中文"');
  assert.equal(csvEscape(null), '""');
});

test("CSV export writes BOM, headers, bounded batches, and does not collect all rows", async () => {
  const response = new FakeResponse();
  const calls = [];
  const progress = [];
  const result = await writeCsvExport({
    res: response,
    total: 501,
    maxRows: 1000,
    filename: "feedback_export_2026-08-29.csv",
    columns: [
      { name: "id", get: (row) => row.id },
      { name: "title", get: (row) => row.title }
    ],
    fetchBatch: async (limit, offset) => {
      calls.push({ limit, offset });
      if (offset === 0) return Array.from({ length: 250 }, (_, index) => ({ id: index + 1, title: `标题 ${index + 1}` }));
      if (offset === 250) return Array.from({ length: 250 }, (_, index) => ({ id: index + 251, title: `标题 ${index + 251}` }));
      return [{ id: 501, title: '包含,逗号"和\n换行' }];
    },
    recordProgress: (event) => progress.push(event)
  });

  assert.equal(EXPORT_BATCH_SIZE, 250);
  assert.deepEqual(calls, [
    { limit: 250, offset: 0 },
    { limit: 250, offset: 250 },
    { limit: 250, offset: 500 }
  ]);
  assert.equal(result.rowCount, 501);
  assert.equal(response.endCalled, true);
  assert.equal(response.headers["content-type"], "text/csv; charset=utf-8");
  assert.match(response.headers["content-disposition"], /feedback_export_2026-08-29\.csv/);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.headers["x-export-count"], "501");
  assert.equal(response.writes[0], "\ufeffid,title\n");
  assert.match(response.writes.join(""), /"包含,逗号""和\n换行"/u);
  assert.equal(progress.at(-1).result, "success");
  assert.equal(progress.at(-1).rowCount, 501);
});

test("CSV export rejects over-limit totals before setting headers or writing", async () => {
  const response = new FakeResponse();
  let fetchCalled = false;
  await assert.rejects(
    () => writeCsvExport({
      res: response,
      total: 1001,
      maxRows: 1000,
      filename: "export.csv",
      columns: [{ name: "id", get: (row) => row.id }],
      fetchBatch: async () => { fetchCalled = true; return []; }
    }),
    (error) => {
      assert.equal(error.code, "EXPORT_LIMIT_EXCEEDED");
      assert.equal(error.status, 413);
      assert.equal(error.rowCount, 1001);
      assert.equal(error.maxRows, 1000);
      return true;
    }
  );
  assert.equal(fetchCalled, false);
  assert.deepEqual(response.headers, {});
  assert.deepEqual(response.writes, []);
});

test("CSV export waits for drain when response applies backpressure", async () => {
  const response = new FakeResponse({ backpressure: true });
  const result = await writeCsvExport({
    res: response,
    total: 1,
    maxRows: 1000,
    filename: "export.csv",
    columns: [{ name: "id", get: (row) => row.id }],
    fetchBatch: async () => [{ id: 1 }]
  });
  assert.equal(result.rowCount, 1);
  assert.equal(response.endCalled, true);
});

test("CSV export closes the response when a later batch fails", async () => {
  const response = new FakeResponse();
  await assert.rejects(
    () => writeCsvExport({
      res: response,
      total: 251,
      maxRows: 1000,
      filename: "export.csv",
      columns: [{ name: "id", get: (row) => row.id }],
      fetchBatch: async (_limit, offset) => {
        if (offset === 0) return Array.from({ length: 250 }, (_, index) => ({ id: index + 1 }));
        throw Object.assign(new Error("query failed"), { code: "SQLITE_BUSY" });
      }
    }),
    /query failed/
  );
  assert.equal(response.destroyCalled, true);
});

test("CSV export aborts a backpressured response when the client closes", async () => {
  const response = new FakeResponse({ backpressure: true, closeOnBackpressure: true });
  await assert.rejects(
    () => writeCsvExport({
      res: response,
      total: 1,
      maxRows: 1000,
      filename: "export.csv",
      columns: [{ name: "id", get: (row) => row.id }],
      fetchBatch: async () => [{ id: 1 }]
    }),
    (error) => error && error.code === "EXPORT_CLIENT_CLOSED"
  );
  assert.equal(response.destroyCalled, true);
});
