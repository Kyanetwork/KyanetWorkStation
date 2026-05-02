const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const config = require("./config");

const SUPPORTED_CLIENTS = new Set(["sqlite", "mysql", "postgres"]);
const client = (config.dbClient || "sqlite").toLowerCase();
if (!SUPPORTED_CLIENTS.has(client)) {
  throw new Error(`Unsupported DB_CLIENT: ${config.dbClient}`);
}

let sqliteDb = null;
let mysqlPool = null;
let postgresPool = null;

function nowIso() {
  return new Date().toISOString();
}

function placeholder(index) {
  return client === "postgres" ? `$${index}` : "?";
}

function toNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toBoolean(value) {
  if (typeof value === "boolean") return value;
  return toNumber(value) === 1;
}

function toDbBoolean(value) {
  const normalized = Boolean(value);
  if (client === "postgres") {
    return normalized;
  }
  return normalized ? 1 : 0;
}

async function ensureDriverInitialized() {
  if (client === "sqlite") {
    if (sqliteDb) return;
    const dbDir = path.dirname(config.dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    // Load sqlite driver only when sqlite mode is enabled.
    const BetterSqlite3 = require("better-sqlite3");
    sqliteDb = new BetterSqlite3(config.dbPath);
    sqliteDb.pragma("journal_mode = WAL");
    sqliteDb.pragma("foreign_keys = ON");
    sqliteDb.pragma("busy_timeout = 5000");
    return;
  }

  if (client === "mysql") {
    if (mysqlPool) return;
    if (!config.databaseUrl) {
      throw new Error("DATABASE_URL is required when DB_CLIENT=mysql");
    }
    const mysql = require("mysql2/promise");
    mysqlPool = mysql.createPool({
      uri: config.databaseUrl,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });
    return;
  }

  if (client === "postgres") {
    if (postgresPool) return;
    if (!config.databaseUrl) {
      throw new Error("DATABASE_URL is required when DB_CLIENT=postgres");
    }
    const { Pool } = require("pg");
    postgresPool = new Pool({
      connectionString: config.databaseUrl,
      max: 10
    });
  }
}

async function queryOne(sql, params = []) {
  await ensureDriverInitialized();
  if (client === "sqlite") {
    return sqliteDb.prepare(sql).get(...params) || null;
  }
  if (client === "mysql") {
    const [rows] = await mysqlPool.query(sql, params);
    return rows[0] || null;
  }
  const result = await postgresPool.query(sql, params);
  return result.rows[0] || null;
}

async function queryAll(sql, params = []) {
  await ensureDriverInitialized();
  if (client === "sqlite") {
    return sqliteDb.prepare(sql).all(...params);
  }
  if (client === "mysql") {
    const [rows] = await mysqlPool.query(sql, params);
    return rows;
  }
  const result = await postgresPool.query(sql, params);
  return result.rows;
}

async function execute(sql, params = []) {
  await ensureDriverInitialized();
  if (client === "sqlite") {
    const result = sqliteDb.prepare(sql).run(...params);
    return {
      changes: toNumber(result.changes),
      lastInsertId: toNumber(result.lastInsertRowid)
    };
  }
  if (client === "mysql") {
    const [result] = await mysqlPool.query(sql, params);
    return {
      changes: toNumber(result.affectedRows),
      lastInsertId: toNumber(result.insertId)
    };
  }
  const result = await postgresPool.query(sql, params);
  return {
    changes: toNumber(result.rowCount),
    lastInsertId: result.rows[0] && result.rows[0].id != null ? toNumber(result.rows[0].id) : 0
  };
}

async function executeMany(statements) {
  for (const statement of statements) {
    if (statement && statement.trim()) {
      await execute(statement);
    }
  }
}

function sqliteSchemaStatements() {
  return [
    `CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      contact TEXT NOT NULL,
      images TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'new',
      show_on_home INTEGER NOT NULL DEFAULT 0,
      admin_note TEXT NOT NULL DEFAULT '',
      public_reply TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status)",
    "CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback(created_at DESC)",
    `CREATE TABLE IF NOT EXISTS worktask (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      contact TEXT NOT NULL,
      priority TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      show_on_home INTEGER NOT NULL DEFAULT 0,
      created_by_admin INTEGER NOT NULL DEFAULT 0,
      admin_note TEXT NOT NULL DEFAULT '',
      public_reply TEXT NOT NULL DEFAULT '',
      expected_at TEXT,
      scheduled_at TEXT,
      assignee TEXT,
      tags TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS idx_worktask_status ON worktask(status)",
    "CREATE INDEX IF NOT EXISTS idx_worktask_priority ON worktask(priority)",
    "CREATE INDEX IF NOT EXISTS idx_worktask_created_at ON worktask(created_at DESC)",
    `CREATE TABLE IF NOT EXISTS admin_user (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS admin_session (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      ip TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES admin_user(id) ON DELETE CASCADE
    )`,
    "CREATE INDEX IF NOT EXISTS idx_admin_session_expires_at ON admin_session(expires_at)",
    "CREATE INDEX IF NOT EXISTS idx_admin_session_user_id ON admin_session(user_id)"
  ];
}

function mysqlSchemaStatements() {
  return [
    `CREATE TABLE IF NOT EXISTS feedback (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      type VARCHAR(64) NOT NULL,
      title VARCHAR(255) NOT NULL,
      content TEXT NOT NULL,
      contact VARCHAR(255) NOT NULL,
      images TEXT NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'new',
      show_on_home TINYINT(1) NOT NULL DEFAULT 0,
      admin_note VARCHAR(2000) NOT NULL DEFAULT '',
      public_reply VARCHAR(2000) NOT NULL DEFAULT '',
      created_at VARCHAR(40) NOT NULL,
      updated_at VARCHAR(40) NOT NULL,
      INDEX idx_feedback_status (status),
      INDEX idx_feedback_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS worktask (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      type VARCHAR(64) NOT NULL,
      title VARCHAR(255) NOT NULL,
      content TEXT NOT NULL,
      contact VARCHAR(255) NOT NULL,
      priority VARCHAR(32) NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'new',
      show_on_home TINYINT(1) NOT NULL DEFAULT 0,
      created_by_admin TINYINT(1) NOT NULL DEFAULT 0,
      admin_note VARCHAR(2000) NOT NULL DEFAULT '',
      public_reply VARCHAR(2000) NOT NULL DEFAULT '',
      expected_at VARCHAR(40) NULL,
      scheduled_at VARCHAR(40) NULL,
      assignee VARCHAR(255) NULL,
      tags VARCHAR(255) NOT NULL DEFAULT '',
      created_at VARCHAR(40) NOT NULL,
      updated_at VARCHAR(40) NOT NULL,
      INDEX idx_worktask_status (status),
      INDEX idx_worktask_priority (priority),
      INDEX idx_worktask_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS admin_user (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      username VARCHAR(64) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      created_at VARCHAR(40) NOT NULL,
      updated_at VARCHAR(40) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS admin_session (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      user_id BIGINT NOT NULL,
      token_hash VARCHAR(128) NOT NULL UNIQUE,
      ip VARCHAR(64) NULL,
      user_agent VARCHAR(255) NULL,
      created_at VARCHAR(40) NOT NULL,
      expires_at VARCHAR(40) NOT NULL,
      last_seen_at VARCHAR(40) NOT NULL,
      INDEX idx_admin_session_expires_at (expires_at),
      INDEX idx_admin_session_user_id (user_id),
      CONSTRAINT fk_admin_session_user
        FOREIGN KEY (user_id) REFERENCES admin_user(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  ];
}

function postgresSchemaStatements() {
  return [
    `CREATE TABLE IF NOT EXISTS feedback (
      id BIGSERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      contact TEXT NOT NULL,
      images TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'new',
      show_on_home BOOLEAN NOT NULL DEFAULT FALSE,
      admin_note TEXT NOT NULL DEFAULT '',
      public_reply TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status)",
    "CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback(created_at DESC)",
    `CREATE TABLE IF NOT EXISTS worktask (
      id BIGSERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      contact TEXT NOT NULL,
      priority TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      show_on_home BOOLEAN NOT NULL DEFAULT FALSE,
      created_by_admin BOOLEAN NOT NULL DEFAULT FALSE,
      admin_note TEXT NOT NULL DEFAULT '',
      public_reply TEXT NOT NULL DEFAULT '',
      expected_at TEXT,
      scheduled_at TEXT,
      assignee TEXT,
      tags TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS idx_worktask_status ON worktask(status)",
    "CREATE INDEX IF NOT EXISTS idx_worktask_priority ON worktask(priority)",
    "CREATE INDEX IF NOT EXISTS idx_worktask_created_at ON worktask(created_at DESC)",
    `CREATE TABLE IF NOT EXISTS admin_user (
      id BIGSERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS admin_session (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES admin_user(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      ip TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS idx_admin_session_expires_at ON admin_session(expires_at)",
    "CREATE INDEX IF NOT EXISTS idx_admin_session_user_id ON admin_session(user_id)"
  ];
}

async function initializeDatabase() {
  await ensureDriverInitialized();
  if (client === "sqlite") {
    sqliteDb.exec(sqliteSchemaStatements().join(";\n"));
  } else if (client === "mysql") {
    await executeMany(mysqlSchemaStatements());
  } else {
    await executeMany(postgresSchemaStatements());
  }
  await ensureHomeDisplayColumns();
}

async function columnExists(tableName, columnName) {
  if (client === "sqlite") {
    const rows = await queryAll(`PRAGMA table_info(${tableName})`);
    return rows.some((row) => row.name === columnName);
  }

  if (client === "mysql") {
    const row = await queryOne(
      "SELECT 1 AS exists_flag FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1",
      [tableName, columnName]
    );
    return Boolean(row);
  }

  const row = await queryOne(
    "SELECT 1 AS exists_flag FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2 LIMIT 1",
    [tableName, columnName]
  );
  return Boolean(row);
}

async function ensureHomeDisplayColumns() {
  const feedbackHasColumn = await columnExists("feedback", "show_on_home");
  if (!feedbackHasColumn) {
    if (client === "sqlite") {
      await execute("ALTER TABLE feedback ADD COLUMN show_on_home INTEGER NOT NULL DEFAULT 0");
    } else if (client === "mysql") {
      await execute("ALTER TABLE feedback ADD COLUMN show_on_home TINYINT(1) NOT NULL DEFAULT 0");
    } else {
      await execute("ALTER TABLE feedback ADD COLUMN show_on_home BOOLEAN NOT NULL DEFAULT FALSE");
    }
  }

  const worktaskHasColumn = await columnExists("worktask", "show_on_home");
  if (!worktaskHasColumn) {
    if (client === "sqlite") {
      await execute("ALTER TABLE worktask ADD COLUMN show_on_home INTEGER NOT NULL DEFAULT 0");
    } else if (client === "mysql") {
      await execute("ALTER TABLE worktask ADD COLUMN show_on_home TINYINT(1) NOT NULL DEFAULT 0");
    } else {
      await execute("ALTER TABLE worktask ADD COLUMN show_on_home BOOLEAN NOT NULL DEFAULT FALSE");
    }
  }

  const feedbackHasAdminNote = await columnExists("feedback", "admin_note");
  if (!feedbackHasAdminNote) {
    if (client === "sqlite") {
      await execute("ALTER TABLE feedback ADD COLUMN admin_note TEXT NOT NULL DEFAULT ''");
    } else if (client === "mysql") {
      await execute("ALTER TABLE feedback ADD COLUMN admin_note VARCHAR(2000) NOT NULL DEFAULT ''");
    } else {
      await execute("ALTER TABLE feedback ADD COLUMN admin_note TEXT NOT NULL DEFAULT ''");
    }
  }

  const feedbackHasPublicReply = await columnExists("feedback", "public_reply");
  if (!feedbackHasPublicReply) {
    if (client === "sqlite") {
      await execute("ALTER TABLE feedback ADD COLUMN public_reply TEXT NOT NULL DEFAULT ''");
    } else if (client === "mysql") {
      await execute("ALTER TABLE feedback ADD COLUMN public_reply VARCHAR(2000) NOT NULL DEFAULT ''");
    } else {
      await execute("ALTER TABLE feedback ADD COLUMN public_reply TEXT NOT NULL DEFAULT ''");
    }
  }

  const worktaskHasAdminNote = await columnExists("worktask", "admin_note");
  if (!worktaskHasAdminNote) {
    if (client === "sqlite") {
      await execute("ALTER TABLE worktask ADD COLUMN admin_note TEXT NOT NULL DEFAULT ''");
    } else if (client === "mysql") {
      await execute("ALTER TABLE worktask ADD COLUMN admin_note VARCHAR(2000) NOT NULL DEFAULT ''");
    } else {
      await execute("ALTER TABLE worktask ADD COLUMN admin_note TEXT NOT NULL DEFAULT ''");
    }
  }

  const worktaskHasPublicReply = await columnExists("worktask", "public_reply");
  if (!worktaskHasPublicReply) {
    if (client === "sqlite") {
      await execute("ALTER TABLE worktask ADD COLUMN public_reply TEXT NOT NULL DEFAULT ''");
    } else if (client === "mysql") {
      await execute("ALTER TABLE worktask ADD COLUMN public_reply VARCHAR(2000) NOT NULL DEFAULT ''");
    } else {
      await execute("ALTER TABLE worktask ADD COLUMN public_reply TEXT NOT NULL DEFAULT ''");
    }
  }

  const worktaskHasCreatedByAdmin = await columnExists("worktask", "created_by_admin");
  if (!worktaskHasCreatedByAdmin) {
    if (client === "sqlite") {
      await execute("ALTER TABLE worktask ADD COLUMN created_by_admin INTEGER NOT NULL DEFAULT 0");
    } else if (client === "mysql") {
      await execute("ALTER TABLE worktask ADD COLUMN created_by_admin TINYINT(1) NOT NULL DEFAULT 0");
    } else {
      await execute("ALTER TABLE worktask ADD COLUMN created_by_admin BOOLEAN NOT NULL DEFAULT FALSE");
    }
  }
}

async function ensureBootstrapAdmin() {
  const countRow = await queryOne("SELECT COUNT(*) AS count FROM admin_user");
  if (!countRow || toNumber(countRow.count) > 0) {
    return { created: false, reason: "admin_exists" };
  }

  const username = config.adminBootstrapUsername;
  const password = config.adminBootstrapPassword;
  if (!username || !password) {
    return { created: false, reason: "missing_bootstrap_credentials" };
  }

  const passwordHash = bcrypt.hashSync(password, config.bcryptRounds);
  const now = nowIso();
  const p1 = placeholder(1);
  const p2 = placeholder(2);
  const p3 = placeholder(3);
  const p4 = placeholder(4);
  await execute(
    `INSERT INTO admin_user (username, password_hash, created_at, updated_at)
     VALUES (${p1}, ${p2}, ${p3}, ${p4})`,
    [username, passwordHash, now, now]
  );

  return { created: true, reason: "bootstrapped" };
}

async function cleanupExpiredSessions() {
  const p1 = placeholder(1);
  await execute(`DELETE FROM admin_session WHERE expires_at <= ${p1}`, [nowIso()]);
}

async function getHealthCounts() {
  const feedbackRow = await queryOne("SELECT COUNT(*) AS count FROM feedback");
  const worktaskRow = await queryOne("SELECT COUNT(*) AS count FROM worktask");
  return {
    feedbackCount: toNumber(feedbackRow && feedbackRow.count),
    worktaskCount: toNumber(worktaskRow && worktaskRow.count)
  };
}

async function createFeedback(payload) {
  const now = nowIso();
  const params = [
    payload.type,
    payload.title,
    payload.content,
    payload.contact,
    JSON.stringify(payload.images),
    now,
    now
  ];
  const values = params.map((_, idx) => placeholder(idx + 1));
  const sql = client === "postgres"
    ? `INSERT INTO feedback (type, title, content, contact, images, status, created_at, updated_at)
       VALUES (${values[0]}, ${values[1]}, ${values[2]}, ${values[3]}, ${values[4]}, 'new', ${values[5]}, ${values[6]})
       RETURNING id`
    : `INSERT INTO feedback (type, title, content, contact, images, status, created_at, updated_at)
       VALUES (${values[0]}, ${values[1]}, ${values[2]}, ${values[3]}, ${values[4]}, 'new', ${values[5]}, ${values[6]})`;

  const result = await execute(sql, params);
  return result.lastInsertId;
}

async function createWorktask(payload) {
  const now = nowIso();
  const params = [
    payload.type,
    payload.title,
    payload.content,
    payload.contact,
    payload.priority,
    payload.expectedAt || null,
    payload.tags,
    now,
    now
  ];
  const values = params.map((_, idx) => placeholder(idx + 1));
  const sql = client === "postgres"
    ? `INSERT INTO worktask (type, title, content, contact, priority, status, show_on_home, created_by_admin, expected_at, scheduled_at, assignee, tags, admin_note, public_reply, created_at, updated_at)
       VALUES (${values[0]}, ${values[1]}, ${values[2]}, ${values[3]}, ${values[4]}, 'new', FALSE, FALSE, ${values[5]}, NULL, NULL, ${values[6]}, '', '', ${values[7]}, ${values[8]})
       RETURNING id`
    : `INSERT INTO worktask (type, title, content, contact, priority, status, show_on_home, created_by_admin, expected_at, scheduled_at, assignee, tags, admin_note, public_reply, created_at, updated_at)
       VALUES (${values[0]}, ${values[1]}, ${values[2]}, ${values[3]}, ${values[4]}, 'new', 0, 0, ${values[5]}, NULL, NULL, ${values[6]}, '', '', ${values[7]}, ${values[8]})`;

  const result = await execute(sql, params);
  return result.lastInsertId;
}

async function createWorktaskByAdmin(payload) {
  const now = nowIso();
  const scheduledAt = payload.scheduledAt || null;
  const assignee = payload.assignee || null;
  let status = payload.status || "new";
  if (!payload.status && (scheduledAt || assignee)) {
    status = "scheduled";
  }

  const params = [
    payload.type,
    payload.title,
    payload.content,
    "管理员内部任务",
    payload.priority,
    status,
    toDbBoolean(payload.showOnHome),
    toDbBoolean(true),
    payload.expectedAt || null,
    scheduledAt,
    assignee,
    payload.tags || "",
    payload.adminNote || "",
    payload.publicReply || "",
    now,
    now
  ];
  const values = params.map((_, idx) => placeholder(idx + 1));
  const sql = client === "postgres"
    ? `INSERT INTO worktask (type, title, content, contact, priority, status, show_on_home, created_by_admin, expected_at, scheduled_at, assignee, tags, admin_note, public_reply, created_at, updated_at)
       VALUES (${values[0]}, ${values[1]}, ${values[2]}, ${values[3]}, ${values[4]}, ${values[5]}, ${values[6]}, ${values[7]}, ${values[8]}, ${values[9]}, ${values[10]}, ${values[11]}, ${values[12]}, ${values[13]}, ${values[14]}, ${values[15]})
       RETURNING id`
    : `INSERT INTO worktask (type, title, content, contact, priority, status, show_on_home, created_by_admin, expected_at, scheduled_at, assignee, tags, admin_note, public_reply, created_at, updated_at)
       VALUES (${values[0]}, ${values[1]}, ${values[2]}, ${values[3]}, ${values[4]}, ${values[5]}, ${values[6]}, ${values[7]}, ${values[8]}, ${values[9]}, ${values[10]}, ${values[11]}, ${values[12]}, ${values[13]}, ${values[14]}, ${values[15]})`;

  const result = await execute(sql, params);
  return result.lastInsertId;
}

async function getAdminByUsername(username) {
  const p1 = placeholder(1);
  return queryOne(
    `SELECT id, username, password_hash FROM admin_user WHERE username = ${p1} LIMIT 1`,
    [username]
  );
}

async function upsertAdminUser(username, passwordHash) {
  const now = nowIso();
  const existing = await getAdminByUsername(username);
  if (existing) {
    const p1 = placeholder(1);
    const p2 = placeholder(2);
    const p3 = placeholder(3);
    await execute(
      `UPDATE admin_user SET password_hash = ${p1}, updated_at = ${p2} WHERE id = ${p3}`,
      [passwordHash, now, existing.id]
    );
    return { created: false, id: toNumber(existing.id) };
  }

  const p1 = placeholder(1);
  const p2 = placeholder(2);
  const p3 = placeholder(3);
  const p4 = placeholder(4);
  const sql = client === "postgres"
    ? `INSERT INTO admin_user (username, password_hash, created_at, updated_at)
       VALUES (${p1}, ${p2}, ${p3}, ${p4}) RETURNING id`
    : `INSERT INTO admin_user (username, password_hash, created_at, updated_at)
       VALUES (${p1}, ${p2}, ${p3}, ${p4})`;
  const result = await execute(sql, [username, passwordHash, now, now]);
  return { created: true, id: result.lastInsertId };
}

async function createSessionRecord({ userId, tokenHash, ip, userAgent, createdAt, expiresAt, lastSeenAt }) {
  const params = [userId, tokenHash, ip || "", String(userAgent || "").slice(0, 255), createdAt, expiresAt, lastSeenAt];
  const marks = params.map((_, idx) => placeholder(idx + 1)).join(", ");
  await execute(
    `INSERT INTO admin_session (user_id, token_hash, ip, user_agent, created_at, expires_at, last_seen_at)
     VALUES (${marks})`,
    params
  );
}

async function deleteSessionByTokenHash(tokenHash) {
  const p1 = placeholder(1);
  await execute(`DELETE FROM admin_session WHERE token_hash = ${p1}`, [tokenHash]);
}

async function findSessionWithUserByTokenHash(tokenHash) {
  const p1 = placeholder(1);
  return queryOne(
    `SELECT s.id AS session_id, s.user_id, s.expires_at, u.username
     FROM admin_session s
     JOIN admin_user u ON u.id = s.user_id
     WHERE s.token_hash = ${p1}
     LIMIT 1`,
    [tokenHash]
  );
}

async function deleteSessionById(sessionId) {
  const p1 = placeholder(1);
  await execute(`DELETE FROM admin_session WHERE id = ${p1}`, [sessionId]);
}

async function touchSessionLastSeen(sessionId, isoTime) {
  const p1 = placeholder(1);
  const p2 = placeholder(2);
  await execute(`UPDATE admin_session SET last_seen_at = ${p1} WHERE id = ${p2}`, [isoTime, sessionId]);
}

function buildFeedbackFilter(status, keyword) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (status) {
    conditions.push(`status = ${placeholder(idx++)}`);
    params.push(status);
  }
  if (keyword) {
    const kw = `%${keyword}%`;
    const p1 = placeholder(idx++);
    const p2 = placeholder(idx++);
    const p3 = placeholder(idx++);
    conditions.push(`(title LIKE ${p1} OR content LIKE ${p2} OR contact LIKE ${p3})`);
    params.push(kw, kw, kw);
  }

  return {
    whereClause: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
    nextIndex: idx
  };
}

function buildWorktaskFilter(status, keyword, priority) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (status) {
    conditions.push(`status = ${placeholder(idx++)}`);
    params.push(status);
  }
  if (priority) {
    conditions.push(`priority = ${placeholder(idx++)}`);
    params.push(priority);
  }
  if (keyword) {
    const kw = `%${keyword}%`;
    const p1 = placeholder(idx++);
    const p2 = placeholder(idx++);
    const p3 = placeholder(idx++);
    const p4 = placeholder(idx++);
    const p5 = placeholder(idx++);
    conditions.push(`(title LIKE ${p1} OR content LIKE ${p2} OR contact LIKE ${p3} OR assignee LIKE ${p4} OR tags LIKE ${p5})`);
    params.push(kw, kw, kw, kw, kw);
  }

  return {
    whereClause: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
    nextIndex: idx
  };
}

async function listFeedback({ status, keyword, page, pageSize }) {
  const { whereClause, params, nextIndex } = buildFeedbackFilter(status, keyword);
  const totalRow = await queryOne(`SELECT COUNT(*) AS count FROM feedback ${whereClause}`, params);
  const total = toNumber(totalRow && totalRow.count);

  const summaryRows = await queryAll(
    `SELECT status, COUNT(*) AS count
     FROM feedback
     ${whereClause}
     GROUP BY status`,
    params
  );
  const summary = { new: 0, reviewed: 0, resolved: 0, notplanned: 0 };
  for (const row of summaryRows) {
    if (summary[row.status] !== undefined) {
      summary[row.status] = toNumber(row.count);
    }
  }

  const offset = (page - 1) * pageSize;
  const limitPlaceholder = placeholder(nextIndex);
  const offsetPlaceholder = placeholder(nextIndex + 1);
  const rows = await queryAll(
    `SELECT id, type, title, content, contact, images, status, show_on_home, admin_note, public_reply, created_at, updated_at
     FROM feedback
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
    [...params, pageSize, offset]
  );

  const items = rows.map((row) => {
    let images = [];
    try {
      images = JSON.parse(row.images || "[]");
    } catch (_) {
      images = [];
    }
    return {
      id: toNumber(row.id),
      type: row.type,
      title: row.title,
      content: row.content,
      contact: row.contact,
      images,
      status: row.status,
      showOnHome: toBoolean(row.show_on_home),
      adminNote: row.admin_note || "",
      publicReply: row.public_reply || "",
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  });

  return {
    items,
    page,
    pageSize,
    total,
    summary,
    totalPages: total === 0 ? 1 : Math.ceil(total / pageSize)
  };
}

async function updateFeedbackStatus(id, status) {
  const p1 = placeholder(1);
  const p2 = placeholder(2);
  const p3 = placeholder(3);
  const result = await execute(
    `UPDATE feedback SET status = ${p1}, updated_at = ${p2} WHERE id = ${p3}`,
    [status, nowIso(), id]
  );
  return result.changes;
}

async function updateFeedbackHomeDisplay(id, showOnHome) {
  const p1 = placeholder(1);
  const p2 = placeholder(2);
  const p3 = placeholder(3);
  const result = await execute(
    `UPDATE feedback SET show_on_home = ${p1}, updated_at = ${p2} WHERE id = ${p3}`,
    [toDbBoolean(showOnHome), nowIso(), id]
  );
  return result.changes;
}

async function updateFeedbackNoteReply(id, adminNote, publicReply) {
  const p1 = placeholder(1);
  const p2 = placeholder(2);
  const p3 = placeholder(3);
  const p4 = placeholder(4);
  const result = await execute(
    `UPDATE feedback SET admin_note = ${p1}, public_reply = ${p2}, updated_at = ${p3} WHERE id = ${p4}`,
    [adminNote, publicReply, nowIso(), id]
  );
  return result.changes;
}

async function deleteFeedback(id) {
  const p1 = placeholder(1);
  const result = await execute(`DELETE FROM feedback WHERE id = ${p1}`, [id]);
  return result.changes;
}

async function listWorktask({ status, keyword, priority, page, pageSize }) {
  const { whereClause, params, nextIndex } = buildWorktaskFilter(status, keyword, priority);
  const totalRow = await queryOne(`SELECT COUNT(*) AS count FROM worktask ${whereClause}`, params);
  const total = toNumber(totalRow && totalRow.count);

  const summaryRows = await queryAll(
    `SELECT status, COUNT(*) AS count
     FROM worktask
     ${whereClause}
     GROUP BY status`,
    params
  );
  const summary = { new: 0, scheduled: 0, in_progress: 0, completed: 0, cancelled: 0 };
  for (const row of summaryRows) {
    if (summary[row.status] !== undefined) {
      summary[row.status] = toNumber(row.count);
    }
  }

  const priorityRows = await queryAll(
    `SELECT priority, COUNT(*) AS count
     FROM worktask
     ${whereClause}
     GROUP BY priority`,
    params
  );
  const prioritySummary = { low: 0, medium: 0, high: 0, urgent: 0 };
  for (const row of priorityRows) {
    if (prioritySummary[row.priority] !== undefined) {
      prioritySummary[row.priority] = toNumber(row.count);
    }
  }

  const offset = (page - 1) * pageSize;
  const limitPlaceholder = placeholder(nextIndex);
  const offsetPlaceholder = placeholder(nextIndex + 1);
  const rows = await queryAll(
    `SELECT id, type, title, content, contact, priority, status, show_on_home, created_by_admin, admin_note, public_reply, expected_at, scheduled_at, assignee, tags, created_at, updated_at
     FROM worktask
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
    [...params, pageSize, offset]
  );

  const items = rows.map((row) => ({
    id: toNumber(row.id),
    type: row.type,
    title: row.title,
    content: row.content,
    contact: row.contact,
    priority: row.priority,
    status: row.status,
    showOnHome: toBoolean(row.show_on_home),
    createdByAdmin: toBoolean(row.created_by_admin),
    adminNote: row.admin_note || "",
    publicReply: row.public_reply || "",
    expectedAt: row.expected_at || "",
    scheduledAt: row.scheduled_at || "",
    assignee: row.assignee || "",
    tags: row.tags || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));

  return {
    items,
    page,
    pageSize,
    total,
    summary,
    prioritySummary,
    totalPages: total === 0 ? 1 : Math.ceil(total / pageSize)
  };
}

async function updateWorktaskStatus(id, status) {
  const p1 = placeholder(1);
  const p2 = placeholder(2);
  const p3 = placeholder(3);
  const result = await execute(
    `UPDATE worktask SET status = ${p1}, updated_at = ${p2} WHERE id = ${p3}`,
    [status, nowIso(), id]
  );
  return result.changes;
}

async function updateWorktaskHomeDisplay(id, showOnHome) {
  const p1 = placeholder(1);
  const p2 = placeholder(2);
  const p3 = placeholder(3);
  const result = await execute(
    `UPDATE worktask SET show_on_home = ${p1}, updated_at = ${p2} WHERE id = ${p3}`,
    [toDbBoolean(showOnHome), nowIso(), id]
  );
  return result.changes;
}

async function updateWorktaskNoteReply(id, adminNote, publicReply) {
  const p1 = placeholder(1);
  const p2 = placeholder(2);
  const p3 = placeholder(3);
  const p4 = placeholder(4);
  const result = await execute(
    `UPDATE worktask SET admin_note = ${p1}, public_reply = ${p2}, updated_at = ${p3} WHERE id = ${p4}`,
    [adminNote, publicReply, nowIso(), id]
  );
  return result.changes;
}

async function arrangeWorktask({ id, assignee, scheduledAt, status }) {
  const updates = [];
  const params = [];
  let idx = 1;

  if (assignee) {
    updates.push(`assignee = ${placeholder(idx++)}`);
    params.push(assignee);
  }
  if (scheduledAt) {
    updates.push(`scheduled_at = ${placeholder(idx++)}`);
    params.push(scheduledAt);
  }

  let nextStatus = status;
  if (!nextStatus && (assignee || scheduledAt)) {
    nextStatus = "scheduled";
  }
  if (nextStatus) {
    updates.push(`status = ${placeholder(idx++)}`);
    params.push(nextStatus);
  }

  updates.push(`updated_at = ${placeholder(idx++)}`);
  params.push(nowIso());
  params.push(id);

  const sql = `UPDATE worktask SET ${updates.join(", ")} WHERE id = ${placeholder(idx)}`;
  const result = await execute(sql, params);
  return result.changes;
}

async function deleteWorktask(id) {
  const p1 = placeholder(1);
  const result = await execute(`DELETE FROM worktask WHERE id = ${p1}`, [id]);
  return result.changes;
}

function homeDisplayCondition() {
  return client === "postgres" ? "show_on_home = TRUE" : "show_on_home = 1";
}

async function getHomeHighlights(limitPerType = 6) {
  const limit = Math.max(1, Math.min(20, toNumber(limitPerType) || 6));
  const p1 = placeholder(1);
  const feedbackRows = await queryAll(
    `SELECT id, type, title, content, status, public_reply, updated_at
     FROM feedback
     WHERE ${homeDisplayCondition()} AND status IN ('new', 'reviewed')
     ORDER BY updated_at DESC
     LIMIT ${p1}`,
    [limit]
  );
  const worktaskRows = await queryAll(
    `SELECT id, type, title, content, status, priority, created_by_admin, public_reply, updated_at
     FROM worktask
     WHERE ${homeDisplayCondition()} AND status IN ('new', 'scheduled', 'in_progress')
     ORDER BY updated_at DESC
     LIMIT ${p1}`,
    [limit]
  );

  return {
    feedbackItems: feedbackRows.map((row) => ({
      id: toNumber(row.id),
      type: row.type,
      title: row.title,
      content: row.content,
      status: row.status,
      publicReply: row.public_reply || "",
      updatedAt: row.updated_at
    })),
    worktaskItems: worktaskRows.map((row) => ({
      id: toNumber(row.id),
      type: row.type,
      title: row.title,
      content: row.content,
      status: row.status,
      priority: row.priority,
      createdByAdmin: toBoolean(row.created_by_admin),
      publicReply: row.public_reply || "",
      updatedAt: row.updated_at
    }))
  };
}

async function closeDatabase() {
  if (sqliteDb) {
    sqliteDb.close();
    sqliteDb = null;
  }
  if (mysqlPool) {
    await mysqlPool.end();
    mysqlPool = null;
  }
  if (postgresPool) {
    await postgresPool.end();
    postgresPool = null;
  }
}

module.exports = {
  client,
  initializeDatabase,
  ensureBootstrapAdmin,
  cleanupExpiredSessions,
  nowIso,
  getHealthCounts,
  createFeedback,
  createWorktask,
  createWorktaskByAdmin,
  getAdminByUsername,
  upsertAdminUser,
  createSessionRecord,
  deleteSessionByTokenHash,
  findSessionWithUserByTokenHash,
  deleteSessionById,
  touchSessionLastSeen,
  listFeedback,
  updateFeedbackStatus,
  updateFeedbackHomeDisplay,
  updateFeedbackNoteReply,
  deleteFeedback,
  listWorktask,
  updateWorktaskStatus,
  updateWorktaskHomeDisplay,
  updateWorktaskNoteReply,
  arrangeWorktask,
  deleteWorktask,
  getHomeHighlights,
  closeDatabase
};
