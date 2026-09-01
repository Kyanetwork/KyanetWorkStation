const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const DB_PATH = path.join(ROOT_DIR, "server", "db.js");

function runDatabaseScript(dbPath, body) {
  const script = [
    "process.env.NODE_ENV = 'test';",
    "process.env.DB_CLIENT = 'sqlite';",
    `process.env.DB_PATH = ${JSON.stringify(dbPath)};`,
    `const db = require(${JSON.stringify(DB_PATH)});`,
    `(async () => { ${body} })().catch((error) => { process.stderr.write(error.stack || error.message); process.exit(1); });`
  ].join("\n");
  return spawnSync(process.execPath, ["-e", script], {
    cwd: ROOT_DIR,
    env: { ...process.env, NODE_ENV: "test", DB_CLIENT: "sqlite", DB_PATH: dbPath },
    encoding: "utf8",
    windowsHide: true
  });
}

test("SQLite initializes admin_audit idempotently and supports safe audit and export queries", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kws-admin-audit-"));
  const dbPath = path.join(tempDir, "workstation.db");
  try {
    const result = runDatabaseScript(dbPath, `
      await db.initializeDatabase();
      await db.initializeDatabase();
      await db.createFeedback({ type: "Bug", title: "导出反馈", content: "含,逗号", contact: "private@example.com", images: [] });
      await db.createWorktask({ type: "WorkTask提交", title: "导出任务", content: "任务内容", contact: "private@example.com", priority: "urgent", expectedAt: "", tags: "部署" });
      const auditId = await db.createAdminAudit({
        actorUserId: 7,
        actorUsername: "admin",
        action: "feedback.export",
        entityType: "feedback",
        entityId: 1,
        requestId: "request-1",
        result: "success",
        metadata: { rowCount: 1, hasKeyword: false }
      });
      await db.createAdminAudit({
        actorUserId: 7,
        actorUsername: "admin",
        action: "feedback.status",
        entityType: "feedback",
        entityId: 1,
        requestId: "request-2",
        result: "success",
        metadata: { tooLong: "x".repeat(3000), nested: { secret: "must-not-survive" } }
      });
      const feedbackCount = await db.countExportRows("feedback", { status: "", keyword: "导出" });
      const feedbackBatch = await db.listFeedbackExportBatch({ status: "", keyword: "导出" }, 250, 0);
      const worktaskCount = await db.countExportRows("worktask", { status: "", priority: "urgent", keyword: "" });
      const worktaskBatch = await db.listWorktaskExportBatch({ status: "", priority: "urgent", keyword: "" }, 250, 0);
      const audits = await db.listAdminAudits({ action: "feedback.export", actor: "admin", page: 1, pageSize: 20 });
      const allAudits = await db.listAdminAudits({ page: 1, pageSize: 20 });
      const row = allAudits.items.find((item) => item.action === "feedback.status");
      await db.closeDatabase();
      process.stdout.write(JSON.stringify({ auditId, feedbackCount, feedbackBatch, worktaskCount, worktaskBatch, audits, row }));
    `);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout);
    assert.equal(output.auditId, 1);
    assert.equal(output.feedbackCount, 1);
    assert.equal(output.feedbackBatch.length, 1);
    assert.equal(output.feedbackBatch[0].title, "导出反馈");
    assert.equal(output.worktaskCount, 1);
    assert.equal(output.worktaskBatch[0].priority, "urgent");
    assert.equal(output.audits.total, 1);
    assert.equal(output.audits.items[0].action, "feedback.export");
    assert.deepEqual(output.audits.items[0].metadata, { rowCount: 1, hasKeyword: false });
    assert.deepEqual(output.row.metadata, {});

    const sqlite = require("better-sqlite3");
    const inspect = new sqlite(dbPath, { readonly: true, fileMustExist: true });
    try {
      assert.equal(inspect.prepare("SELECT COUNT(*) AS count FROM admin_audit").get().count, 2);
      assert.ok(inspect.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_admin_audit_created_at'").get());
    } finally {
      inspect.close();
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("audit metadata sanitizer keeps only bounded action fields and drops sensitive content", async () => {
  const { sanitizeAuditMetadata } = require("../server/admin-audit");
  const metadata = sanitizeAuditMetadata({
    rowCount: 12,
    hasKeyword: true,
    fields: ["summary", "replyDraft"],
    content: "private business content",
    apiKey: "secret",
    nested: { value: "not allowed" },
    tooLong: "x".repeat(3000)
  });
  assert.deepEqual(metadata, { rowCount: 12, hasKeyword: true, fields: ["summary", "replyDraft"] });
  assert.equal(JSON.stringify(metadata).includes("secret"), false);
  assert.ok(Buffer.byteLength(JSON.stringify(metadata), "utf8") <= 2048);
});

test("audit metadata preserves non-sensitive action field summaries and safe error codes", () => {
  const { sanitizeAuditMetadata } = require("../server/admin-audit");
  assert.deepEqual(sanitizeAuditMetadata({
    fields: ["adminNote", "publicReply", "scheduledAt", "unknown"],
    adminNoteLength: 12,
    publicReplyLength: 34,
    errorCode: "SQLITE_BUSY",
    unsafeError: "provider response contains secret token"
  }), {
    fields: ["adminNote", "publicReply", "scheduledAt"],
    adminNoteLength: 12,
    publicReplyLength: 34,
    errorCode: "SQLITE_BUSY"
  });
  assert.deepEqual(sanitizeAuditMetadata({
    errorCode: "Authorization: Bearer secret-token"
  }), {});
});

test("audit metadata never persists URL-shaped model values", () => {
  const { sanitizeAuditMetadata } = require("../server/admin-audit");
  assert.deepEqual(sanitizeAuditMetadata({
    model: "https://provider.example/v1/models/secret"
  }), {});
  assert.deepEqual(sanitizeAuditMetadata({
    model: "//provider.example/v1/models/secret"
  }), {});
  assert.deepEqual(sanitizeAuditMetadata({
    model: "gpt-4o-mini"
  }), { model: "gpt-4o-mini" });
});

test("audit metadata preserves bounded knowledge action summaries without paths or content", () => {
  const { sanitizeAuditMetadata } = require("../server/admin-audit");
  const metadata = sanitizeAuditMetadata({
    rootId: "tyutland",
    answerId: 42,
    basis: "mixed",
    sourceCount: 3,
    indexedFiles: 12,
    chunkCount: 48,
    warningCount: 1,
    deleted: 2,
    autoCleanup: false,
    relativePath: "E:\\private\\notes.md",
    answer: "private answer text",
    absolutePath: "E:\\private\\notes.md",
    errorCode: "KNOWLEDGE_REINDEX_FAILED"
  });

  assert.deepEqual(metadata, {
    rootId: "tyutland",
    answerId: 42,
    basis: "mixed",
    sourceCount: 3,
    indexedFiles: 12,
    chunkCount: 48,
    warningCount: 1,
    deleted: 2,
    autoCleanup: false,
    errorCode: "KNOWLEDGE_REINDEX_FAILED"
  });
  assert.equal(JSON.stringify(metadata).includes("private"), false);
});

test("safe audit recorder never changes business flow when persistence fails", async () => {
  const { recordAdminAuditSafely } = require("../server/admin-audit");
  const calls = [];
  const warnings = [];
  const result = await recordAdminAuditSafely({
    req: {
      requestId: "request-1",
      adminUser: { id: 7, username: "admin" }
    },
    action: "feedback.status",
    entityType: "feedback",
    entityId: 42,
    result: "success",
    metadata: { status: "reviewed", content: "must not persist" },
    auditDb: {
      createAdminAudit: async (payload) => {
        calls.push(payload);
        throw Object.assign(new Error("database failed"), { code: "SQLITE_BUSY" });
      }
    },
    auditLogger: {
      warn: (payload) => warnings.push(payload)
    }
  });
  assert.equal(result, false);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].metadata, { status: "reviewed" });
  assert.deepEqual(warnings[0], {
    event: "admin.audit.write.error",
    requestId: "request-1",
    action: "feedback.status",
    errorCode: "SQLITE_BUSY"
  });
});
