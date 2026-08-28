const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { spawnSync } = require("node:child_process");

const BetterSqlite3 = require("better-sqlite3");

const ROOT_DIR = path.resolve(__dirname, "..");
const BACKUP_SCRIPT = path.join(ROOT_DIR, "scripts", "backup-db.js");
const VERIFY_SCRIPT = path.join(ROOT_DIR, "scripts", "verify-sqlite-backup.js");

test("SQLite backup can be checksum-verified and restored in an isolated database", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kws-backup-restore-"));
  const sourcePath = path.join(tempDir, "source.db");
  const backupDir = path.join(tempDir, "backups");
  const restoredPath = path.join(tempDir, "restored.db");
  let restored = null;

  try {
    const initializeScript = `
      process.env.DB_CLIENT = "sqlite";
      process.env.DB_PATH = process.argv[1];
      const db = require(${JSON.stringify(path.join(ROOT_DIR, "server", "db.js"))});
      (async () => {
        await db.initializeDatabase();
        await db.createFeedback({ type: "Bug", title: "backup feedback", content: "content", contact: "test@example.com", images: [] });
        await db.createWorktask({ type: "WorkTask提交", title: "backup worktask", content: "content", contact: "test@example.com", priority: "medium", expectedAt: "", tags: "" });
        await db.upsertAdminUser("admin", "hash");
        await db.closeDatabase();
      })().catch((error) => { console.error(error); process.exit(1); });
    `;
    const initializeResult = spawnSync(process.execPath, ["-e", initializeScript, sourcePath], {
      cwd: ROOT_DIR,
      env: { ...process.env, DB_CLIENT: "sqlite", DB_PATH: sourcePath },
      encoding: "utf8",
      windowsHide: true
    });
    assert.equal(initializeResult.status, 0, initializeResult.stderr || initializeResult.stdout);

    const result = spawnSync(process.execPath, [BACKUP_SCRIPT], {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        DB_CLIENT: "sqlite",
        DB_PATH: sourcePath,
        BACKUP_DIR: backupDir,
        BACKUP_RETENTION_DAYS: "30"
      },
      encoding: "utf8",
      windowsHide: true
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const backups = fs.readdirSync(backupDir).filter((name) => name.endsWith(".db.gz"));
    assert.equal(backups.length, 1);
    const backupPath = path.join(backupDir, backups[0]);
    const compressed = fs.readFileSync(backupPath);
    const checksum = crypto.createHash("sha256").update(compressed).digest("hex");
    assert.match(checksum, /^[a-f0-9]{64}$/);

    fs.writeFileSync(restoredPath, zlib.gunzipSync(compressed));
    restored = new BetterSqlite3(restoredPath, { readonly: true, fileMustExist: true });
    const tables = restored
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name);
    assert.deepEqual(tables, [
      "account_session",
      "admin_session",
      "admin_user",
      "feedback",
      "notification_delivery",
      "sqlite_sequence",
      "workstation_setting",
      "worktask"
    ]);
    assert.equal(restored.prepare("SELECT COUNT(*) AS count FROM feedback").get().count, 1);
    assert.equal(restored.prepare("SELECT COUNT(*) AS count FROM worktask").get().count, 1);
    assert.equal(restored.prepare("SELECT COUNT(*) AS count FROM admin_user").get().count, 1);
    assert.equal(restored.prepare("SELECT COUNT(*) AS count FROM workstation_setting").get().count, 2);

    const verifyResult = spawnSync(process.execPath, [VERIFY_SCRIPT, "--backup", backupPath], {
      cwd: ROOT_DIR,
      env: { ...process.env, NODE_ENV: "test" },
      encoding: "utf8",
      windowsHide: true
    });
    assert.equal(verifyResult.status, 0, verifyResult.stderr || verifyResult.stdout);
    const evidence = JSON.parse(verifyResult.stdout);
    assert.equal(evidence.ok, true);
    assert.equal(evidence.backupFile, path.basename(backupPath));
    assert.match(evidence.sha256, /^[a-f0-9]{64}$/);
    assert.equal(evidence.integrityCheck, "ok");
    assert.equal(evidence.tables.feedback.exists, true);
    assert.equal(evidence.tables.feedback.count, 1);
    assert.equal(evidence.tables.worktask.count, 1);
    assert.equal(evidence.tables.admin_user.count, 1);
    assert.equal(evidence.tables.notification_delivery.exists, true);
    assert.equal(evidence.fullPath, undefined);
  } finally {
    if (restored) restored.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("SQLite backup verifier rejects missing critical tables, corrupt gzip, and unknown extensions", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kws-backup-verify-negative-"));
  const missingTablePath = path.join(tempDir, "missing.db");
  const corruptGzipPath = path.join(tempDir, "corrupt.db.gz");
  const unknownPath = path.join(tempDir, "backup.txt");
  const db = new BetterSqlite3(missingTablePath);
  db.exec("CREATE TABLE feedback (id INTEGER PRIMARY KEY)");
  db.close();
  fs.writeFileSync(corruptGzipPath, "not-gzip");
  fs.writeFileSync(unknownPath, "not-a-backup");

  try {
    for (const backupPath of [missingTablePath, corruptGzipPath, unknownPath]) {
      const result = spawnSync(process.execPath, [VERIFY_SCRIPT, "--backup", backupPath], {
        cwd: ROOT_DIR,
        env: { ...process.env, NODE_ENV: "test" },
        encoding: "utf8",
        windowsHide: true
      });
      assert.notEqual(result.status, 0, `expected verifier to reject ${backupPath}`);
      assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(backupPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
      assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /DATABASE_URL|password|token|secret/iu);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
