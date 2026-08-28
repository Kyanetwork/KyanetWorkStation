const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { spawn, spawnSync } = require("node:child_process");

const BetterSqlite3 = require("better-sqlite3");

const ROOT_DIR = path.resolve(__dirname, "..");
const BACKUP_SCRIPT = path.join(ROOT_DIR, "scripts", "backup-db.js");
const VERIFY_SCRIPT = path.join(ROOT_DIR, "scripts", "verify-sqlite-backup.js");

function forceTerminate(child) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true
    });
    return;
  }
  child.kill("SIGKILL");
}

function initializeLegacyDatabase(dbPath, runs = 1) {
  const script = [
    "process.env.NODE_ENV = 'test';",
    "process.env.DB_CLIENT = 'sqlite';",
    `process.env.DB_PATH = ${JSON.stringify(dbPath)};`,
    `const db = require(${JSON.stringify(path.join(ROOT_DIR, "server", "db.js"))});`,
    `(async () => { for (let attempt = 0; attempt < ${runs}; attempt += 1) await db.initializeDatabase(); process.stdout.write('READY\\n'); setInterval(() => {}, 1000); })().catch((error) => { process.stderr.write(error.message); process.exit(1); });`
  ].join("\n");
  const child = spawn(process.execPath, ["-e", script], {
    cwd: ROOT_DIR,
    env: { ...process.env, NODE_ENV: "test", DB_CLIENT: "sqlite", DB_PATH: dbPath },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  return new Promise((resolve, reject) => {
    let settled = false;
    let terminationRequested = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    const timer = setTimeout(() => {
      terminationRequested = true;
      forceTerminate(child);
      finish(new Error("legacy schema initialization timed out"));
    }, 12000);
    child.on("error", (error) => {
      finish(error);
    });
    child.on("close", (code) => {
      if (!stdout.includes("READY") || stderr.trim()) {
        finish(new Error(stderr || `legacy schema initialization exited with ${code}`));
        return;
      }
      finish();
    });
    child.stdout.on("data", () => {
      if (settled || terminationRequested || !stdout.includes("READY")) return;
      terminationRequested = true;
      forceTerminate(child);
    });
  });
}

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

test("initializeDatabase upgrades legacy SQLite submissions and remains idempotent", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kws-db-migration-"));
  const dbPath = path.join(tempDir, "legacy.db");
  const db = new BetterSqlite3(dbPath);
  db.exec(`
    CREATE TABLE feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      contact TEXT NOT NULL,
      images TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE worktask (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      contact TEXT NOT NULL,
      priority TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      tags TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE admin_user (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.prepare(`
    INSERT INTO feedback (type, title, content, contact, images, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run("Bug", "legacy feedback", "legacy content", "legacy@example.com", "[]", "new", "2026-08-27T00:00:00.000Z", "2026-08-27T00:00:00.000Z");
  db.prepare(`
    INSERT INTO worktask (type, title, content, contact, priority, status, tags, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run("WorkTask提交", "legacy worktask", "legacy content", "legacy@example.com", "medium", "new", "legacy", "2026-08-27T00:00:00.000Z", "2026-08-27T00:00:00.000Z");
  db.close();

  try {
    await initializeLegacyDatabase(dbPath, 2);

    const upgraded = new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true });
    try {
      for (const table of ["feedback", "worktask"]) {
        const columns = upgraded.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
        assert.ok(columns.includes("account_user_id"));
        assert.ok(columns.includes("account_email_snapshot"));
        assert.ok(columns.includes("account_display_name_snapshot"));
      }
      assert.deepEqual(
        upgraded.prepare("SELECT title, account_user_id, account_email_snapshot, account_display_name_snapshot FROM feedback WHERE title = ?").get("legacy feedback"),
        { title: "legacy feedback", account_user_id: "", account_email_snapshot: "", account_display_name_snapshot: "" }
      );
      assert.deepEqual(
        upgraded.prepare("SELECT title, account_user_id, account_email_snapshot, account_display_name_snapshot FROM worktask WHERE title = ?").get("legacy worktask"),
        { title: "legacy worktask", account_user_id: "", account_email_snapshot: "", account_display_name_snapshot: "" }
      );
      for (const [table, indexName] of [
        ["feedback", "idx_feedback_account_user_id"],
        ["worktask", "idx_worktask_account_user_id"]
      ]) {
        const indexColumns = upgraded.prepare(`PRAGMA index_info(${indexName})`).all().map((row) => row.name);
        assert.deepEqual(indexColumns, ["account_user_id"], `${table} account index must target account_user_id`);
      }
    } finally {
      upgraded.close();
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
