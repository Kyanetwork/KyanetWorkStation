const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const config = require("./config");
const { sanitizeAuditMetadata } = require("./admin-audit-metadata");

const SUPPORTED_CLIENTS = new Set(["sqlite", "mysql", "postgres"]);
const client = (config.dbClient || "sqlite").toLowerCase();

const STATUS_PROFILE_SETTING_KEY = "status.profile";
const MINECRAFT_STATUS_SETTING_KEY = "status.minecraft";
const AI_PROVIDER_PROFILES_SETTING_KEY = "ai_provider_profiles";
const AI_KNOWLEDGE_SETTINGS_KEY = "ai_knowledge_settings";
const DEFAULT_AI_PROVIDER_PROFILES = {
  version: 1,
  activeProfileId: "",
  profiles: []
};
const DEFAULT_STATUS_PROFILE = {
  enabled: false,
  apiBaseUrl: config.meowStatusBaseUrl,
  timeoutMs: config.meowStatusTimeoutMs,
  updatedAt: ""
};
const DEFAULT_MINECRAFT_STATUS = {
  enabled: false,
  updatedAt: ""
};
const DEFAULT_AI_KNOWLEDGE_SETTINGS = {
  autoCleanup: true,
  updatedAt: ""
};

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
  if (!SUPPORTED_CLIENTS.has(client)) {
    throw new Error(`Unsupported DB_CLIENT: ${config.dbClient}`);
  }
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
      account_user_id TEXT NOT NULL DEFAULT '',
      account_email_snapshot TEXT NOT NULL DEFAULT '',
      account_display_name_snapshot TEXT NOT NULL DEFAULT '',
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
      account_user_id TEXT NOT NULL DEFAULT '',
      account_email_snapshot TEXT NOT NULL DEFAULT '',
      account_display_name_snapshot TEXT NOT NULL DEFAULT '',
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
    "CREATE INDEX IF NOT EXISTS idx_admin_session_user_id ON admin_session(user_id)",
    `CREATE TABLE IF NOT EXISTS account_session (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_user_id TEXT NOT NULL,
      account_email TEXT NOT NULL,
      account_display_name TEXT NOT NULL DEFAULT '',
      token_hash TEXT NOT NULL UNIQUE,
      ip TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS idx_account_session_expires_at ON account_session(expires_at)",
    "CREATE INDEX IF NOT EXISTS idx_account_session_user_id ON account_session(account_user_id)",
    `CREATE TABLE IF NOT EXISTS notification_delivery (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      target TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT NOT NULL,
      last_error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS idx_notification_delivery_due ON notification_delivery(status, next_attempt_at)",
    `CREATE TABLE IF NOT EXISTS workstation_setting (
      setting_key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ai_copilot_suggestion (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      profile_id TEXT NOT NULL,
      protocol TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'available',
      result_json TEXT NOT NULL,
      accepted_fields TEXT NOT NULL DEFAULT '[]',
      decided_by TEXT NOT NULL DEFAULT '',
      decided_at TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS idx_ai_suggestion_entity_created ON ai_copilot_suggestion(entity_type, entity_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_ai_suggestion_expires_at ON ai_copilot_suggestion(expires_at)",
    `CREATE TABLE IF NOT EXISTS ai_knowledge_answer (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      basis TEXT NOT NULL,
      caveats TEXT NOT NULL DEFAULT '',
      sources_json TEXT NOT NULL DEFAULT '[]',
      root_id TEXT NOT NULL DEFAULT '',
      profile_id TEXT NOT NULL DEFAULT '',
      protocol TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      usage_json TEXT NOT NULL DEFAULT '{}',
      prompt_version TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS idx_ai_knowledge_answer_created_at ON ai_knowledge_answer(created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_ai_knowledge_answer_expires_at ON ai_knowledge_answer(expires_at)",
    `CREATE TABLE IF NOT EXISTS admin_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      actor_user_id INTEGER,
      actor_username TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL DEFAULT '',
      entity_id INTEGER,
      request_id TEXT NOT NULL DEFAULT '',
      result TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    )`,
    "CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at ON admin_audit(created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit(action)",
    "CREATE INDEX IF NOT EXISTS idx_admin_audit_entity ON admin_audit(entity_type, entity_id)",
    "CREATE INDEX IF NOT EXISTS idx_admin_audit_actor ON admin_audit(actor_user_id)"
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
      account_user_id VARCHAR(128) NOT NULL DEFAULT '',
      account_email_snapshot VARCHAR(320) NOT NULL DEFAULT '',
      account_display_name_snapshot VARCHAR(255) NOT NULL DEFAULT '',
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
      account_user_id VARCHAR(128) NOT NULL DEFAULT '',
      account_email_snapshot VARCHAR(320) NOT NULL DEFAULT '',
      account_display_name_snapshot VARCHAR(255) NOT NULL DEFAULT '',
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS account_session (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      account_user_id VARCHAR(128) NOT NULL,
      account_email VARCHAR(320) NOT NULL,
      account_display_name VARCHAR(255) NOT NULL DEFAULT '',
      token_hash VARCHAR(128) NOT NULL UNIQUE,
      ip VARCHAR(64) NULL,
      user_agent VARCHAR(255) NULL,
      created_at VARCHAR(40) NOT NULL,
      expires_at VARCHAR(40) NOT NULL,
      last_seen_at VARCHAR(40) NOT NULL,
      INDEX idx_account_session_expires_at (expires_at),
      INDEX idx_account_session_user_id (account_user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS notification_delivery (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      event_id VARCHAR(255) NOT NULL UNIQUE,
      entity_type VARCHAR(32) NOT NULL,
      entity_id BIGINT NOT NULL,
      provider VARCHAR(32) NOT NULL,
      target VARCHAR(255) NOT NULL DEFAULT '',
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      attempts INT NOT NULL DEFAULT 0,
      next_attempt_at VARCHAR(40) NOT NULL,
      last_error VARCHAR(500) NOT NULL DEFAULT '',
      created_at VARCHAR(40) NOT NULL,
      updated_at VARCHAR(40) NOT NULL,
      INDEX idx_notification_delivery_due (status, next_attempt_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS workstation_setting (
      setting_key VARCHAR(128) PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at VARCHAR(40) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS ai_copilot_suggestion (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      entity_type VARCHAR(32) NOT NULL,
      entity_id BIGINT NOT NULL,
      profile_id VARCHAR(128) NOT NULL,
      protocol VARCHAR(64) NOT NULL,
      model VARCHAR(120) NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'available',
      result_json TEXT NOT NULL,
      accepted_fields TEXT NOT NULL,
      decided_by VARCHAR(128) NOT NULL DEFAULT '',
      decided_at VARCHAR(40) NULL,
      created_at VARCHAR(40) NOT NULL,
      expires_at VARCHAR(40) NOT NULL,
      INDEX idx_ai_suggestion_entity_created (entity_type, entity_id, created_at),
      INDEX idx_ai_suggestion_expires_at (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS ai_knowledge_answer (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      basis VARCHAR(16) NOT NULL,
      caveats VARCHAR(1200) NOT NULL DEFAULT '',
      sources_json TEXT NOT NULL,
      root_id VARCHAR(128) NOT NULL DEFAULT '',
      profile_id VARCHAR(128) NOT NULL DEFAULT '',
      protocol VARCHAR(64) NOT NULL DEFAULT '',
      model VARCHAR(120) NOT NULL DEFAULT '',
      usage_json TEXT NOT NULL,
      prompt_version VARCHAR(64) NOT NULL DEFAULT '',
      created_at VARCHAR(40) NOT NULL,
      expires_at VARCHAR(40) NOT NULL,
      INDEX idx_ai_knowledge_answer_created_at (created_at),
      INDEX idx_ai_knowledge_answer_expires_at (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS admin_audit (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      created_at VARCHAR(40) NOT NULL,
      actor_user_id BIGINT NULL,
      actor_username VARCHAR(64) NOT NULL DEFAULT '',
      action VARCHAR(64) NOT NULL,
      entity_type VARCHAR(32) NOT NULL DEFAULT '',
      entity_id BIGINT NULL,
      request_id VARCHAR(120) NOT NULL DEFAULT '',
      result VARCHAR(32) NOT NULL,
      metadata_json VARCHAR(2048) NOT NULL DEFAULT '{}',
      INDEX idx_admin_audit_created_at (created_at),
      INDEX idx_admin_audit_action (action),
      INDEX idx_admin_audit_entity (entity_type, entity_id),
      INDEX idx_admin_audit_actor (actor_user_id)
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
      account_user_id TEXT NOT NULL DEFAULT '',
      account_email_snapshot TEXT NOT NULL DEFAULT '',
      account_display_name_snapshot TEXT NOT NULL DEFAULT '',
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
      account_user_id TEXT NOT NULL DEFAULT '',
      account_email_snapshot TEXT NOT NULL DEFAULT '',
      account_display_name_snapshot TEXT NOT NULL DEFAULT '',
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
    "CREATE INDEX IF NOT EXISTS idx_admin_session_user_id ON admin_session(user_id)",
    `CREATE TABLE IF NOT EXISTS account_session (
      id BIGSERIAL PRIMARY KEY,
      account_user_id TEXT NOT NULL,
      account_email TEXT NOT NULL,
      account_display_name TEXT NOT NULL DEFAULT '',
      token_hash TEXT NOT NULL UNIQUE,
      ip TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS idx_account_session_expires_at ON account_session(expires_at)",
    "CREATE INDEX IF NOT EXISTS idx_account_session_user_id ON account_session(account_user_id)",
    `CREATE TABLE IF NOT EXISTS notification_delivery (
      id BIGSERIAL PRIMARY KEY,
      event_id TEXT NOT NULL UNIQUE,
      entity_type TEXT NOT NULL,
      entity_id BIGINT NOT NULL,
      provider TEXT NOT NULL,
      target TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT NOT NULL,
      last_error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS idx_notification_delivery_due ON notification_delivery(status, next_attempt_at)",
    `CREATE TABLE IF NOT EXISTS workstation_setting (
      setting_key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ai_copilot_suggestion (
      id BIGSERIAL PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id BIGINT NOT NULL,
      profile_id TEXT NOT NULL,
      protocol TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'available',
      result_json TEXT NOT NULL,
      accepted_fields TEXT NOT NULL DEFAULT '[]',
      decided_by TEXT NOT NULL DEFAULT '',
      decided_at TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS idx_ai_suggestion_entity_created ON ai_copilot_suggestion(entity_type, entity_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_ai_suggestion_expires_at ON ai_copilot_suggestion(expires_at)",
    `CREATE TABLE IF NOT EXISTS ai_knowledge_answer (
      id BIGSERIAL PRIMARY KEY,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      basis TEXT NOT NULL,
      caveats TEXT NOT NULL DEFAULT '',
      sources_json TEXT NOT NULL DEFAULT '[]',
      root_id TEXT NOT NULL DEFAULT '',
      profile_id TEXT NOT NULL DEFAULT '',
      protocol TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      usage_json TEXT NOT NULL DEFAULT '{}',
      prompt_version TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS idx_ai_knowledge_answer_created_at ON ai_knowledge_answer(created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_ai_knowledge_answer_expires_at ON ai_knowledge_answer(expires_at)",
    `CREATE TABLE IF NOT EXISTS admin_audit (
      id BIGSERIAL PRIMARY KEY,
      created_at TEXT NOT NULL,
      actor_user_id BIGINT,
      actor_username TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL DEFAULT '',
      entity_id BIGINT,
      request_id TEXT NOT NULL DEFAULT '',
      result TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    )`,
    "CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at ON admin_audit(created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit(action)",
    "CREATE INDEX IF NOT EXISTS idx_admin_audit_entity ON admin_audit(entity_type, entity_id)",
    "CREATE INDEX IF NOT EXISTS idx_admin_audit_actor ON admin_audit(actor_user_id)"
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
  await ensureSubmissionAccountColumns();
  await ensureAccountSessionSchema();
  await ensureStatusSettings();
  await ensureAiProviderProfilesSetting();
  await ensureAiKnowledgeSettings();
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

async function addSubmissionAccountColumn(tableName, columnName, columnType) {
  if (await columnExists(tableName, columnName)) {
    return;
  }
  try {
    await execute(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType} NOT NULL DEFAULT ''`);
  } catch (error) {
    if (!(await columnExists(tableName, columnName))) {
      throw error;
    }
  }
}

function accountColumnType(columnName) {
  if (client !== "mysql") {
    return "TEXT";
  }
  if (columnName === "account_user_id") {
    return "VARCHAR(128)";
  }
  if (columnName === "account_email_snapshot") {
    return "VARCHAR(320)";
  }
  return "VARCHAR(255)";
}

async function ensureSubmissionAccountColumns() {
  const columns = ["account_user_id", "account_email_snapshot", "account_display_name_snapshot"];
  for (const tableName of ["feedback", "worktask"]) {
    for (const columnName of columns) {
      await addSubmissionAccountColumn(tableName, columnName, accountColumnType(columnName));
    }
  }

  for (const [tableName, indexName] of [
    ["feedback", "idx_feedback_account_user_id"],
    ["worktask", "idx_worktask_account_user_id"]
  ]) {
    if (await indexExists(tableName, indexName)) {
      continue;
    }
    try {
      await execute(`CREATE INDEX ${indexName} ON ${tableName}(account_user_id)`);
    } catch (error) {
      if (!(await indexExists(tableName, indexName))) {
        throw error;
      }
    }
  }
}

async function tableExists(tableName) {
  if (client === "sqlite") {
    const row = await queryOne("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [tableName]);
    return Boolean(row);
  }

  if (client === "mysql") {
    const row = await queryOne(
      "SELECT 1 AS exists_flag FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1",
      [tableName]
    );
    return Boolean(row);
  }

  const row = await queryOne(
    "SELECT 1 AS exists_flag FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1 LIMIT 1",
    [tableName]
  );
  return Boolean(row);
}

async function indexExists(tableName, indexName) {
  if (client === "sqlite") {
    const row = await queryOne("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND name = ?", [tableName, indexName]);
    return Boolean(row);
  }

  if (client === "mysql") {
    const row = await queryOne(
      "SELECT 1 AS exists_flag FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1",
      [tableName, indexName]
    );
    return Boolean(row);
  }

  const row = await queryOne(
    "SELECT 1 AS exists_flag FROM pg_indexes WHERE schemaname = current_schema() AND tablename = $1 AND indexname = $2 LIMIT 1",
    [tableName, indexName]
  );
  return Boolean(row);
}

async function ensureAccountSessionSchema() {
  if (await tableExists("account_session")) {
    return;
  }

  if (client === "sqlite") {
    await executeMany(sqliteSchemaStatements().filter((statement) => statement.includes("account_session")));
  } else if (client === "mysql") {
    await executeMany(mysqlSchemaStatements().filter((statement) => statement.includes("account_session")));
  } else {
    await executeMany(postgresSchemaStatements().filter((statement) => statement.includes("account_session")));
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
  await execute(`DELETE FROM account_session WHERE expires_at <= ${p1}`, [nowIso()]);
}

async function getHealthCounts() {
  const feedbackRow = await queryOne("SELECT COUNT(*) AS count FROM feedback");
  const worktaskRow = await queryOne("SELECT COUNT(*) AS count FROM worktask");
  return {
    feedbackCount: toNumber(feedbackRow && feedbackRow.count),
    worktaskCount: toNumber(worktaskRow && worktaskRow.count)
  };
}

function defaultStatusProfile(now = "") {
  return {
    ...DEFAULT_STATUS_PROFILE,
    updatedAt: now || DEFAULT_STATUS_PROFILE.updatedAt
  };
}

function defaultMinecraftStatus(now = "") {
  return {
    ...DEFAULT_MINECRAFT_STATUS,
    updatedAt: now || DEFAULT_MINECRAFT_STATUS.updatedAt
  };
}

function normalizeStatusProfile(value) {
  const raw = value && typeof value === "object" ? value : {};
  const timeoutMs = Number.parseInt(raw.timeoutMs, 10);
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_STATUS_PROFILE.enabled,
    apiBaseUrl: typeof raw.apiBaseUrl === "string" && raw.apiBaseUrl ? raw.apiBaseUrl : DEFAULT_STATUS_PROFILE.apiBaseUrl,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs >= 1000 ? timeoutMs : DEFAULT_STATUS_PROFILE.timeoutMs,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : ""
  };
}

function normalizeMinecraftStatus(value) {
  const raw = value && typeof value === "object" ? value : {};
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_MINECRAFT_STATUS.enabled,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : ""
  };
}

async function getSettingJson(key, defaults) {
  const p1 = placeholder(1);
  const row = await queryOne(`SELECT value FROM workstation_setting WHERE setting_key = ${p1} LIMIT 1`, [key]);
  if (!row || typeof row.value !== "string") {
    return { ...defaults };
  }
  try {
    const parsed = JSON.parse(row.value);
    if (parsed && typeof parsed === "object") {
      return {
        ...defaults,
        ...parsed
      };
    }
  } catch (_) {
    return { ...defaults };
  }
  return { ...defaults };
}

async function setSettingJson(key, value) {
  const now = nowIso();
  const encoded = JSON.stringify(value);
  const p1 = placeholder(1);
  const p2 = placeholder(2);
  const p3 = placeholder(3);
  const updateResult = await execute(
    `UPDATE workstation_setting SET value = ${p1}, updated_at = ${p2} WHERE setting_key = ${p3}`,
    [encoded, now, key]
  );
  if (updateResult.changes === 0) {
    await execute(
      `INSERT INTO workstation_setting (setting_key, value, updated_at) VALUES (${p1}, ${p2}, ${p3})`,
      [key, encoded, now]
    );
  }
  return value;
}

async function getAiProviderProfiles() {
  const value = await getSettingJson(AI_PROVIDER_PROFILES_SETTING_KEY, DEFAULT_AI_PROVIDER_PROFILES);
  const profiles = Array.isArray(value.profiles) ? value.profiles : [];
  return {
    version: value.version === 1 ? 1 : DEFAULT_AI_PROVIDER_PROFILES.version,
    activeProfileId: typeof value.activeProfileId === "string" ? value.activeProfileId : "",
    profiles
  };
}

async function setAiProviderProfiles(value) {
  const next = value && typeof value === "object" ? value : DEFAULT_AI_PROVIDER_PROFILES;
  return setSettingJson(AI_PROVIDER_PROFILES_SETTING_KEY, {
    version: next.version === 1 ? 1 : DEFAULT_AI_PROVIDER_PROFILES.version,
    activeProfileId: typeof next.activeProfileId === "string" ? next.activeProfileId : "",
    profiles: Array.isArray(next.profiles) ? next.profiles : []
  });
}

function mapAiSuggestionRow(row) {
  let resultJson = {};
  let acceptedFields = [];
  try {
    const parsed = JSON.parse(row.result_json || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      resultJson = parsed;
    }
  } catch (_) {
    resultJson = {};
  }
  try {
    const parsed = JSON.parse(row.accepted_fields || "[]");
    if (Array.isArray(parsed)) {
      acceptedFields = parsed.filter((field) => typeof field === "string");
    }
  } catch (_) {
    acceptedFields = [];
  }
  return {
    id: toNumber(row.id),
    entityType: row.entity_type,
    entityId: toNumber(row.entity_id),
    profileId: row.profile_id,
    protocol: row.protocol,
    model: row.model,
    status: row.status,
    resultJson,
    acceptedFields,
    decidedBy: row.decided_by || "",
    decidedAt: row.decided_at || "",
    createdAt: row.created_at,
    expiresAt: row.expires_at
  };
}

function encodeAiSuggestionResult(input) {
  const candidate = input && Object.prototype.hasOwnProperty.call(input, "resultJson")
    ? input.resultJson
    : input && input.result;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return "{}";
  }
  const encoded = JSON.stringify(candidate);
  if (Buffer.byteLength(encoded, "utf8") > 32 * 1024) {
    throw new Error("AI suggestion result is too large");
  }
  return encoded;
}

async function createAiSuggestion(input = {}) {
  const resultJson = encodeAiSuggestionResult(input);
  const acceptedFields = Array.isArray(input.acceptedFields)
    ? JSON.stringify(input.acceptedFields.filter((field) => typeof field === "string").slice(0, 5))
    : "[]";
  const createdAt = typeof input.createdAt === "string" && input.createdAt ? input.createdAt : nowIso();
  const expiresAt = typeof input.expiresAt === "string" && input.expiresAt ? input.expiresAt : createdAt;
  const params = [
    String(input.entityType || "").slice(0, 32),
    toNumber(input.entityId),
    String(input.profileId || "").slice(0, 128),
    String(input.protocol || "").slice(0, 64),
    String(input.model || "").slice(0, 120),
    String(input.status || "available").slice(0, 32),
    resultJson,
    acceptedFields,
    String(input.decidedBy || "").slice(0, 128),
    input.decidedAt ? String(input.decidedAt).slice(0, 40) : null,
    createdAt,
    expiresAt
  ];
  const marks = params.map((_, index) => placeholder(index + 1));
  const columns = "entity_type, entity_id, profile_id, protocol, model, status, result_json, accepted_fields, decided_by, decided_at, created_at, expires_at";
  const values = marks.join(", ");
  const sql = client === "postgres"
    ? `INSERT INTO ai_copilot_suggestion (${columns}) VALUES (${values}) RETURNING id`
    : `INSERT INTO ai_copilot_suggestion (${columns}) VALUES (${values})`;
  const result = await execute(sql, params);
  return result.lastInsertId;
}

async function getAiSuggestionById(id) {
  const p1 = placeholder(1);
  const row = await queryOne(
    `SELECT id, entity_type, entity_id, profile_id, protocol, model, status, result_json, accepted_fields, decided_by, decided_at, created_at, expires_at
     FROM ai_copilot_suggestion WHERE id = ${p1} LIMIT 1`,
    [id]
  );
  return row ? mapAiSuggestionRow(row) : null;
}

async function listAiSuggestions({ entityType = "", entityId, now = nowIso() } = {}) {
  const conditions = [`expires_at > ${placeholder(1)}`];
  const params = [typeof now === "string" && now ? now : nowIso()];
  let index = 2;
  if (entityType) {
    conditions.push(`entity_type = ${placeholder(index++)}`);
    params.push(String(entityType).slice(0, 32));
  }
  if (entityId !== undefined && entityId !== null) {
    conditions.push(`entity_id = ${placeholder(index++)}`);
    params.push(toNumber(entityId));
  }
  const limitPlaceholder = placeholder(index++);
  params.push(100);
  const rows = await queryAll(
    `SELECT id, entity_type, entity_id, profile_id, protocol, model, status, result_json, accepted_fields, decided_by, decided_at, created_at, expires_at
     FROM ai_copilot_suggestion WHERE ${conditions.join(" AND ")}
     ORDER BY created_at DESC, id DESC LIMIT ${limitPlaceholder}`,
    params
  );
  return rows.map(mapAiSuggestionRow);
}

async function recordAiSuggestionDecision(id, decision, fields = [], actor = "") {
  const normalizedDecision = decision === "accepted" || decision === "rejected" ? decision : "";
  if (!normalizedDecision) return 0;
  const allowedFields = new Set(["summary", "category", "priority", "tags", "replyDraft"]);
  const normalizedFields = Array.isArray(fields)
    ? [...new Set(fields.filter((field) => allowedFields.has(field)))]
    : [];
  const p1 = placeholder(1);
  const p2 = placeholder(2);
  const p3 = placeholder(3);
  const p4 = placeholder(4);
  const p5 = placeholder(5);
  const p6 = placeholder(6);
  const result = await execute(
    `UPDATE ai_copilot_suggestion
     SET status = ${p1}, accepted_fields = ${p2}, decided_by = ${p3}, decided_at = ${p4}
     WHERE id = ${p5} AND status = 'available' AND expires_at > ${p6}`,
    [normalizedDecision, JSON.stringify(normalizedFields), String(actor || "").slice(0, 128), nowIso(), id, nowIso()]
  );
  return result.changes;
}

async function deleteExpiredAiSuggestions(now = nowIso()) {
  const p1 = placeholder(1);
  const result = await execute(`DELETE FROM ai_copilot_suggestion WHERE expires_at <= ${p1}`, [now]);
  return result.changes;
}

const KNOWLEDGE_BASIS = new Set(["document", "mixed", "general"]);
const KNOWLEDGE_SOURCE_FIELDS = ["sourceId", "libraryName", "relativePath", "title", "heading", "excerpt"];

function boundedDbText(value, maxLength) {
  const text = typeof value === "string" ? value : value == null ? "" : String(value);
  return Array.from(text).slice(0, maxLength).join("");
}

function isSafeKnowledgeRelativePath(value) {
  if (!value || value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:[\\/]/u.test(value)) {
    return false;
  }
  const segments = value.replace(/\\/gu, "/").split("/");
  return segments.length > 0 && !segments.some((segment) => segment === ".." || segment === "");
}

function normalizeKnowledgeSources(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 6).map((entry) => {
    const source = entry && typeof entry === "object" && !Array.isArray(entry) ? entry : {};
    const normalized = {};
    for (const field of KNOWLEDGE_SOURCE_FIELDS) {
      if (typeof source[field] !== "string") continue;
      const maxLength = field === "excerpt" ? 1200 : field === "relativePath" ? 500 : field === "title" || field === "heading" ? 300 : 128;
      const text = boundedDbText(source[field], maxLength).trim();
      if (!text) continue;
      if (field === "relativePath" && !isSafeKnowledgeRelativePath(text)) continue;
      normalized[field] = text;
    }
    return normalized;
  }).filter((source) => Object.keys(source).length > 0);
}

function normalizeKnowledgeUsage(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const normalizeTokenCount = (candidate) => {
    const number = typeof candidate === "number" ? candidate : Number(candidate);
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
  };
  return {
    inputTokens: normalizeTokenCount(source.inputTokens),
    outputTokens: normalizeTokenCount(source.outputTokens)
  };
}

function mapAiKnowledgeAnswerRow(row, now = nowIso()) {
  let sources = [];
  let usage = normalizeKnowledgeUsage(null);
  try {
    const parsedSources = JSON.parse(row.sources_json || "[]");
    sources = normalizeKnowledgeSources(parsedSources);
  } catch (_) {
    sources = [];
  }
  try {
    usage = normalizeKnowledgeUsage(JSON.parse(row.usage_json || "{}"));
  } catch (_) {
    usage = normalizeKnowledgeUsage(null);
  }
  const expiresAt = boundedDbText(row.expires_at, 40);
  const expiresTime = Date.parse(expiresAt);
  const nowTime = Date.parse(now);
  return {
    id: toNumber(row.id),
    question: boundedDbText(row.question, 4000),
    answer: boundedDbText(row.answer, 6000),
    basis: KNOWLEDGE_BASIS.has(row.basis) ? row.basis : "general",
    caveats: boundedDbText(row.caveats, 1200),
    sources,
    rootId: boundedDbText(row.root_id, 128),
    profileId: boundedDbText(row.profile_id, 128),
    protocol: boundedDbText(row.protocol, 64),
    model: boundedDbText(row.model, 120),
    usage,
    promptVersion: boundedDbText(row.prompt_version, 64),
    createdAt: boundedDbText(row.created_at, 40),
    expiresAt,
    expired: Number.isFinite(expiresTime) && Number.isFinite(nowTime) ? expiresTime <= nowTime : false
  };
}

function knowledgeAnswerRetentionMs() {
  const configured = config && (
    config.aiKnowledgeHistoryRetentionDays ||
    (config.knowledge && config.knowledge.historyRetentionDays)
  );
  const days = Number(configured);
  return Number.isFinite(days) && days >= 1 && days <= 3650
    ? Math.trunc(days) * 24 * 60 * 60 * 1000
    : 30 * 24 * 60 * 60 * 1000;
}

async function createAiKnowledgeAnswer(input = {}) {
  const question = boundedDbText(input.question, 4000).trim();
  const answer = boundedDbText(input.answer, 6000);
  const basis = KNOWLEDGE_BASIS.has(input.basis) ? input.basis : "general";
  const caveats = boundedDbText(input.caveats, 1200);
  const sourcesJson = JSON.stringify(normalizeKnowledgeSources(input.sources));
  const rootId = boundedDbText(input.rootId, 128).trim();
  const profileId = boundedDbText(input.profileId, 128).trim();
  const protocol = boundedDbText(input.protocol, 64).trim();
  const model = boundedDbText(input.model, 120).trim();
  const usageJson = JSON.stringify(normalizeKnowledgeUsage(input.usage));
  const promptVersion = boundedDbText(input.promptVersion, 64).trim();
  const createdAt = typeof input.createdAt === "string" && !Number.isNaN(Date.parse(input.createdAt))
    ? input.createdAt.slice(0, 40)
    : nowIso();
  const expiresAt = typeof input.expiresAt === "string" && !Number.isNaN(Date.parse(input.expiresAt))
    ? input.expiresAt.slice(0, 40)
    : new Date(Date.parse(createdAt) + knowledgeAnswerRetentionMs()).toISOString();
  const params = [question, answer, basis, caveats, sourcesJson, rootId, profileId, protocol, model, usageJson, promptVersion, createdAt, expiresAt];
  const marks = params.map((_, index) => placeholder(index + 1));
  const columns = "question, answer, basis, caveats, sources_json, root_id, profile_id, protocol, model, usage_json, prompt_version, created_at, expires_at";
  const sql = client === "postgres"
    ? `INSERT INTO ai_knowledge_answer (${columns}) VALUES (${marks.join(", ")}) RETURNING id`
    : `INSERT INTO ai_knowledge_answer (${columns}) VALUES (${marks.join(", ")})`;
  const result = await execute(sql, params);
  return result.lastInsertId;
}

async function getAiKnowledgeAnswerById(id, now = nowIso()) {
  const p1 = placeholder(1);
  const row = await queryOne(
    `SELECT id, question, answer, basis, caveats, sources_json, root_id, profile_id, protocol, model, usage_json, prompt_version, created_at, expires_at
     FROM ai_knowledge_answer WHERE id = ${p1} LIMIT 1`,
    [id]
  );
  return row ? mapAiKnowledgeAnswerRow(row, now) : null;
}

async function listAiKnowledgeAnswers({ page = 1, pageSize = 20, keyword = "", rootId = "", now = nowIso() } = {}) {
  const normalizedPage = Number.isSafeInteger(Number(page)) && Number(page) > 0 ? Math.min(Number(page), 100000) : 1;
  const normalizedPageSize = Number.isSafeInteger(Number(pageSize)) && Number(pageSize) > 0 ? Math.min(Number(pageSize), 100) : 20;
  const normalizedKeyword = boundedDbText(keyword, 200).trim();
  const normalizedRootId = boundedDbText(rootId, 128).trim();
  const conditions = [];
  const params = [];
  let parameterIndex = 1;
  if (normalizedKeyword) {
    conditions.push(`(question LIKE ${placeholder(parameterIndex)} OR answer LIKE ${placeholder(parameterIndex + 1)})`);
    const query = `%${normalizedKeyword}%`;
    params.push(query, query);
    parameterIndex += 2;
  }
  if (normalizedRootId) {
    conditions.push(`root_id = ${placeholder(parameterIndex++)}`);
    params.push(normalizedRootId);
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const totalRow = await queryOne(`SELECT COUNT(*) AS count FROM ai_knowledge_answer ${whereClause}`, params);
  const offset = (normalizedPage - 1) * normalizedPageSize;
  const limitMarker = placeholder(parameterIndex++);
  const offsetMarker = placeholder(parameterIndex++);
  const rows = await queryAll(
    `SELECT id, question, answer, basis, caveats, sources_json, root_id, profile_id, protocol, model, usage_json, prompt_version, created_at, expires_at
     FROM ai_knowledge_answer ${whereClause}
     ORDER BY created_at DESC, id DESC LIMIT ${limitMarker} OFFSET ${offsetMarker}`,
    [...params, normalizedPageSize, offset]
  );
  const total = toNumber(totalRow && totalRow.count);
  return {
    items: rows.map((row) => mapAiKnowledgeAnswerRow(row, now)),
    page: normalizedPage,
    pageSize: normalizedPageSize,
    total,
    totalPages: total > 0 ? Math.ceil(total / normalizedPageSize) : 0
  };
}

async function deleteAiKnowledgeAnswer(id) {
  const p1 = placeholder(1);
  const result = await execute(`DELETE FROM ai_knowledge_answer WHERE id = ${p1}`, [id]);
  return result.changes;
}

async function deleteExpiredAiKnowledgeAnswers(now = nowIso()) {
  const p1 = placeholder(1);
  const result = await execute(`DELETE FROM ai_knowledge_answer WHERE expires_at <= ${p1}`, [now]);
  return result.changes;
}

async function ensureSettingJson(key, defaults) {
  const p1 = placeholder(1);
  const row = await queryOne(`SELECT setting_key FROM workstation_setting WHERE setting_key = ${p1} LIMIT 1`, [key]);
  if (row) {
    return;
  }
  await setSettingJson(key, defaults);
}

async function ensureStatusSettings() {
  const now = nowIso();
  await ensureSettingJson(STATUS_PROFILE_SETTING_KEY, defaultStatusProfile(now));
  await ensureSettingJson(MINECRAFT_STATUS_SETTING_KEY, defaultMinecraftStatus(now));
}

async function ensureAiProviderProfilesSetting() {
  await ensureSettingJson(AI_PROVIDER_PROFILES_SETTING_KEY, DEFAULT_AI_PROVIDER_PROFILES);
}

function normalizeAiKnowledgeSettings(value, updatedAt = "") {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    autoCleanup: typeof raw.autoCleanup === "boolean" ? raw.autoCleanup : DEFAULT_AI_KNOWLEDGE_SETTINGS.autoCleanup,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt.slice(0, 40) : updatedAt
  };
}

async function ensureAiKnowledgeSettings() {
  await ensureSettingJson(AI_KNOWLEDGE_SETTINGS_KEY, DEFAULT_AI_KNOWLEDGE_SETTINGS);
}

async function getAiKnowledgeSettings() {
  return normalizeAiKnowledgeSettings(
    await getSettingJson(AI_KNOWLEDGE_SETTINGS_KEY, DEFAULT_AI_KNOWLEDGE_SETTINGS)
  );
}

async function setAiKnowledgeSettings(value) {
  const next = normalizeAiKnowledgeSettings(value);
  next.updatedAt = nowIso();
  await setSettingJson(AI_KNOWLEDGE_SETTINGS_KEY, next);
  return next;
}

async function getStatusSettings() {
  const profile = normalizeStatusProfile(
    await getSettingJson(STATUS_PROFILE_SETTING_KEY, defaultStatusProfile())
  );
  const minecraft = normalizeMinecraftStatus(
    await getSettingJson(MINECRAFT_STATUS_SETTING_KEY, defaultMinecraftStatus())
  );
  return { profile, minecraft };
}

async function updateStatusProfileSettings(payload) {
  const current = (await getStatusSettings()).profile;
  const now = nowIso();
  const next = normalizeStatusProfile({
    ...current,
    enabled: payload.enabled,
    apiBaseUrl: payload.apiBaseUrl,
    timeoutMs: payload.timeoutMs,
    updatedAt: now
  });
  return setSettingJson(STATUS_PROFILE_SETTING_KEY, next);
}

async function updateMinecraftStatusSettings(payload) {
  const current = (await getStatusSettings()).minecraft;
  const now = nowIso();
  const next = normalizeMinecraftStatus({
    ...current,
    enabled: payload.enabled,
    updatedAt: now
  });
  return setSettingJson(MINECRAFT_STATUS_SETTING_KEY, next);
}

async function createFeedback(payload) {
  const now = nowIso();
  const params = [
    payload.type,
    payload.title,
    payload.content,
    payload.contact,
    JSON.stringify(payload.images),
    payload.accountUserId || "",
    payload.accountEmailSnapshot || "",
    payload.accountDisplayNameSnapshot || "",
    now,
    now
  ];
  const values = params.map((_, idx) => placeholder(idx + 1));
  const sql = client === "postgres"
    ? `INSERT INTO feedback (type, title, content, contact, images, status, account_user_id, account_email_snapshot, account_display_name_snapshot, created_at, updated_at)
       VALUES (${values[0]}, ${values[1]}, ${values[2]}, ${values[3]}, ${values[4]}, 'new', ${values[5]}, ${values[6]}, ${values[7]}, ${values[8]}, ${values[9]})
       RETURNING id`
    : `INSERT INTO feedback (type, title, content, contact, images, status, account_user_id, account_email_snapshot, account_display_name_snapshot, created_at, updated_at)
       VALUES (${values[0]}, ${values[1]}, ${values[2]}, ${values[3]}, ${values[4]}, 'new', ${values[5]}, ${values[6]}, ${values[7]}, ${values[8]}, ${values[9]})`;

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
    payload.accountUserId || "",
    payload.accountEmailSnapshot || "",
    payload.accountDisplayNameSnapshot || "",
    now,
    now
  ];
  const values = params.map((_, idx) => placeholder(idx + 1));
  const sql = client === "postgres"
    ? `INSERT INTO worktask (type, title, content, contact, priority, status, show_on_home, created_by_admin, expected_at, scheduled_at, assignee, tags, admin_note, public_reply, account_user_id, account_email_snapshot, account_display_name_snapshot, created_at, updated_at)
       VALUES (${values[0]}, ${values[1]}, ${values[2]}, ${values[3]}, ${values[4]}, 'new', FALSE, FALSE, ${values[5]}, NULL, NULL, ${values[6]}, '', '', ${values[7]}, ${values[8]}, ${values[9]}, ${values[10]}, ${values[11]})
       RETURNING id`
    : `INSERT INTO worktask (type, title, content, contact, priority, status, show_on_home, created_by_admin, expected_at, scheduled_at, assignee, tags, admin_note, public_reply, account_user_id, account_email_snapshot, account_display_name_snapshot, created_at, updated_at)
       VALUES (${values[0]}, ${values[1]}, ${values[2]}, ${values[3]}, ${values[4]}, 'new', 0, 0, ${values[5]}, NULL, NULL, ${values[6]}, '', '', ${values[7]}, ${values[8]}, ${values[9]}, ${values[10]}, ${values[11]})`;

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

async function createAccountSessionRecord({
  accountUserId,
  accountEmail,
  accountDisplayName,
  tokenHash,
  ip,
  userAgent,
  createdAt,
  expiresAt,
  lastSeenAt
}) {
  const params = [
    accountUserId,
    accountEmail,
    accountDisplayName || "",
    tokenHash,
    ip || "",
    String(userAgent || "").slice(0, 255),
    createdAt,
    expiresAt,
    lastSeenAt
  ];
  const marks = params.map((_, idx) => placeholder(idx + 1)).join(", ");
  await execute(
    `INSERT INTO account_session (account_user_id, account_email, account_display_name, token_hash, ip, user_agent, created_at, expires_at, last_seen_at)
     VALUES (${marks})`,
    params
  );
}

async function deleteAccountSessionByTokenHash(tokenHash) {
  const p1 = placeholder(1);
  await execute(`DELETE FROM account_session WHERE token_hash = ${p1}`, [tokenHash]);
}

async function findAccountSessionByTokenHash(tokenHash) {
  const p1 = placeholder(1);
  return queryOne(
    `SELECT id AS session_id, account_user_id, account_email, account_display_name, expires_at, last_seen_at
     FROM account_session
     WHERE token_hash = ${p1}
     LIMIT 1`,
    [tokenHash]
  );
}

async function deleteAccountSessionById(sessionId) {
  const p1 = placeholder(1);
  await execute(`DELETE FROM account_session WHERE id = ${p1}`, [sessionId]);
}

async function touchAccountSessionLastSeen(sessionId, isoTime) {
  const p1 = placeholder(1);
  const p2 = placeholder(2);
  await execute(`UPDATE account_session SET last_seen_at = ${p1} WHERE id = ${p2}`, [isoTime, sessionId]);
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

function mapFeedbackRow(row) {
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
    accountUserId: row.account_user_id || "",
    accountEmailSnapshot: row.account_email_snapshot || "",
    accountDisplayNameSnapshot: row.account_display_name_snapshot || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapWorktaskRow(row) {
  return {
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
    accountUserId: row.account_user_id || "",
    accountEmailSnapshot: row.account_email_snapshot || "",
    accountDisplayNameSnapshot: row.account_display_name_snapshot || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeAuditMetadata(metadata) {
  return sanitizeAuditMetadata(metadata);
}

function mapAdminAuditRow(row) {
  let metadata = {};
  try {
    const parsed = JSON.parse(typeof row.metadata_json === "string" ? row.metadata_json : "{}");
    metadata = normalizeAuditMetadata(parsed);
  } catch (_) {
    metadata = {};
  }
  return {
    id: toNumber(row.id),
    createdAt: row.created_at || "",
    actorUserId: row.actor_user_id == null ? null : toNumber(row.actor_user_id),
    actorUsername: row.actor_username || "",
    action: row.action || "",
    entityType: row.entity_type || "",
    entityId: row.entity_id == null ? null : toNumber(row.entity_id),
    requestId: row.request_id || "",
    result: row.result || "",
    metadata
  };
}

async function createAdminAudit({
  actorUserId = null,
  actorUsername = "",
  action = "",
  entityType = "",
  entityId = null,
  requestId = "",
  result = "failed",
  metadata = {},
  createdAt = nowIso()
} = {}) {
  const normalizedMetadata = normalizeAuditMetadata(metadata);
  const params = [
    typeof createdAt === "string" && createdAt ? createdAt.slice(0, 40) : nowIso(),
    Number.isSafeInteger(Number(actorUserId)) && Number(actorUserId) > 0 ? Number(actorUserId) : null,
    String(actorUsername || "").trim().slice(0, 64),
    String(action || "").trim().slice(0, 64),
    String(entityType || "").trim().slice(0, 32),
    Number.isSafeInteger(Number(entityId)) && Number(entityId) > 0 ? Number(entityId) : null,
    String(requestId || "").trim().slice(0, 120),
    ["success", "not_found", "rejected", "failed"].includes(result) ? result : "failed",
    JSON.stringify(normalizedMetadata)
  ];
  const marks = params.map((_, index) => placeholder(index + 1));
  const sql = client === "postgres"
    ? `INSERT INTO admin_audit (created_at, actor_user_id, actor_username, action, entity_type, entity_id, request_id, result, metadata_json)
       VALUES (${marks.join(", ")}) RETURNING id`
    : `INSERT INTO admin_audit (created_at, actor_user_id, actor_username, action, entity_type, entity_id, request_id, result, metadata_json)
       VALUES (${marks.join(", ")})`;
  const inserted = await execute(sql, params);
  return inserted.lastInsertId;
}

async function countExportRows(entityType, filters = {}) {
  if (entityType === "feedback") {
    const { whereClause, params } = buildFeedbackFilter(filters.status || "", filters.keyword || "");
    const row = await queryOne(`SELECT COUNT(*) AS count FROM feedback ${whereClause}`, params);
    return toNumber(row && row.count);
  }
  if (entityType === "worktask") {
    const { whereClause, params } = buildWorktaskFilter(filters.status || "", filters.keyword || "", filters.priority || "");
    const row = await queryOne(`SELECT COUNT(*) AS count FROM worktask ${whereClause}`, params);
    return toNumber(row && row.count);
  }
  throw new Error("Unsupported export entity type");
}

async function listFeedbackExportBatch(filters = {}, limit = 250, offset = 0) {
  const { whereClause, params, nextIndex } = buildFeedbackFilter(filters.status || "", filters.keyword || "");
  const safeLimit = Math.max(1, Math.min(250, toNumber(limit) || 250));
  const safeOffset = Math.max(0, toNumber(offset));
  const rows = await queryAll(
    `SELECT id, type, title, content, contact, images, status, show_on_home, admin_note, public_reply, account_user_id, account_email_snapshot, account_display_name_snapshot, created_at, updated_at
     FROM feedback ${whereClause}
     ORDER BY created_at DESC, id DESC
     LIMIT ${placeholder(nextIndex)} OFFSET ${placeholder(nextIndex + 1)}`,
    [...params, safeLimit, safeOffset]
  );
  return rows.map(mapFeedbackRow);
}

async function listWorktaskExportBatch(filters = {}, limit = 250, offset = 0) {
  const { whereClause, params, nextIndex } = buildWorktaskFilter(filters.status || "", filters.keyword || "", filters.priority || "");
  const safeLimit = Math.max(1, Math.min(250, toNumber(limit) || 250));
  const safeOffset = Math.max(0, toNumber(offset));
  const rows = await queryAll(
    `SELECT id, type, title, content, contact, priority, status, show_on_home, created_by_admin, admin_note, public_reply, expected_at, scheduled_at, assignee, tags, account_user_id, account_email_snapshot, account_display_name_snapshot, created_at, updated_at
     FROM worktask ${whereClause}
     ORDER BY created_at DESC, id DESC
     LIMIT ${placeholder(nextIndex)} OFFSET ${placeholder(nextIndex + 1)}`,
    [...params, safeLimit, safeOffset]
  );
  return rows.map(mapWorktaskRow);
}

async function listAdminAudits({
  action = "",
  entityType = "",
  entityId = null,
  actor = "",
  from = "",
  to = "",
  page = 1,
  pageSize = 20
} = {}) {
  const conditions = [];
  const params = [];
  let index = 1;
  const add = (column, value, operator = "=") => {
    conditions.push(`${column} ${operator} ${placeholder(index++)}`);
    params.push(value);
  };
  if (action) add("action", String(action).slice(0, 64));
  if (entityType) add("entity_type", String(entityType).slice(0, 32));
  if (entityId !== null && entityId !== undefined && entityId !== "") add("entity_id", Number(entityId));
  if (actor) add("actor_username", String(actor).slice(0, 64));
  if (from) add("created_at", String(from).slice(0, 40), ">=");
  if (to) add("created_at", String(to).slice(0, 40), "<=");
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const totalRow = await queryOne(`SELECT COUNT(*) AS count FROM admin_audit ${whereClause}`, params);
  const total = toNumber(totalRow && totalRow.count);
  const safePage = Math.max(1, toNumber(page) || 1);
  const safePageSize = Math.max(1, Math.min(100, toNumber(pageSize) || 20));
  const offset = (safePage - 1) * safePageSize;
  const rows = await queryAll(
    `SELECT id, created_at, actor_user_id, actor_username, action, entity_type, entity_id, request_id, result, metadata_json
     FROM admin_audit ${whereClause}
     ORDER BY created_at DESC, id DESC
     LIMIT ${placeholder(index)} OFFSET ${placeholder(index + 1)}`,
    [...params, safePageSize, offset]
  );
  return {
    items: rows.map(mapAdminAuditRow),
    page: safePage,
    pageSize: safePageSize,
    total,
    totalPages: total === 0 ? 1 : Math.ceil(total / safePageSize)
  };
}

async function getFeedbackById(id) {
  const p1 = placeholder(1);
  const row = await queryOne(
    `SELECT id, type, title, content, contact, images, status, show_on_home, admin_note, public_reply, account_user_id, account_email_snapshot, account_display_name_snapshot, created_at, updated_at
     FROM feedback WHERE id = ${p1} LIMIT 1`,
    [id]
  );
  return row ? mapFeedbackRow(row) : null;
}

async function getWorktaskById(id) {
  const p1 = placeholder(1);
  const row = await queryOne(
    `SELECT id, type, title, content, contact, priority, status, show_on_home, created_by_admin, admin_note, public_reply, expected_at, scheduled_at, assignee, tags, account_user_id, account_email_snapshot, account_display_name_snapshot, created_at, updated_at
     FROM worktask WHERE id = ${p1} LIMIT 1`,
    [id]
  );
  return row ? mapWorktaskRow(row) : null;
}

async function listAiSourceItems(limit = 100) {
  const safeLimit = Math.max(1, Math.min(100, toNumber(limit) || 100));
  const p1 = placeholder(1);
  const feedbackRows = await queryAll(
    `SELECT id, title, content, status, created_at
     FROM feedback ORDER BY created_at DESC, id DESC LIMIT ${p1}`,
    [safeLimit]
  );
  const worktaskRows = await queryAll(
    `SELECT id, title, content, status, priority, created_at
     FROM worktask ORDER BY created_at DESC, id DESC LIMIT ${p1}`,
    [safeLimit]
  );
  return [...feedbackRows.map((row) => ({
    entityType: "feedback",
    entityId: toNumber(row.id),
    title: row.title || "",
    content: row.content || "",
    status: row.status || "",
    priority: "",
    createdAt: row.created_at || ""
  })), ...worktaskRows.map((row) => ({
    entityType: "worktask",
    entityId: toNumber(row.id),
    title: row.title || "",
    content: row.content || "",
    status: row.status || "",
    priority: row.priority || "",
    createdAt: row.created_at || ""
  }))]
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    .slice(0, safeLimit)
    .map(({ createdAt, ...item }) => item);
}

function mapNotificationDeliveryRow(row) {
  return {
    id: toNumber(row.id),
    eventId: row.event_id,
    entityType: row.entity_type,
    entityId: toNumber(row.entity_id),
    provider: row.provider,
    target: row.target || "",
    status: row.status,
    attempts: toNumber(row.attempts),
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function enqueueNotificationDelivery({ eventId, entityType, entityId, provider, target = "" }) {
  const eventKey = String(eventId || "").trim();
  if (!eventKey || !entityType || !provider) {
    throw new Error("notification delivery requires eventId, entityType and provider");
  }
  const p1 = placeholder(1);
  const existing = await queryOne(
    `SELECT id FROM notification_delivery WHERE event_id = ${p1} LIMIT 1`,
    [eventKey]
  );
  if (existing) return toNumber(existing.id);

  const now = nowIso();
  const params = [eventKey, String(entityType).slice(0, 32), toNumber(entityId), String(provider).slice(0, 32), String(target || "").slice(0, 255), now, now, now];
  const marks = params.map((_, idx) => placeholder(idx + 1));
  const sql = client === "postgres"
    ? `INSERT INTO notification_delivery (event_id, entity_type, entity_id, provider, target, status, attempts, next_attempt_at, last_error, created_at, updated_at)
       VALUES (${marks[0]}, ${marks[1]}, ${marks[2]}, ${marks[3]}, ${marks[4]}, 'pending', 0, ${marks[5]}, '', ${marks[6]}, ${marks[7]}) RETURNING id`
    : `INSERT INTO notification_delivery (event_id, entity_type, entity_id, provider, target, status, attempts, next_attempt_at, last_error, created_at, updated_at)
       VALUES (${marks[0]}, ${marks[1]}, ${marks[2]}, ${marks[3]}, ${marks[4]}, 'pending', 0, ${marks[5]}, '', ${marks[6]}, ${marks[7]})`;
  const result = await execute(sql, params);
  return result.lastInsertId;
}

async function enqueueNotificationDeliveries({ entityType, entityId, providers = [] }) {
  const ids = [];
  for (const provider of providers) {
    const normalizedProvider = String(provider || "").trim().toLowerCase();
    if (!normalizedProvider) continue;
    const eventId = `${String(entityType).slice(0, 32)}:${toNumber(entityId)}:${normalizedProvider}`;
    ids.push(await enqueueNotificationDelivery({
      eventId,
      entityType,
      entityId,
      provider: normalizedProvider,
      target: normalizedProvider === "smtp" ? "configured-recipients" : "configured-endpoints"
    }));
  }
  return ids;
}

async function listDueNotificationDeliveries(limit = 20) {
  const p1 = placeholder(1);
  const p2 = placeholder(2);
  const safeLimit = Math.max(1, Math.min(100, toNumber(limit) || 20));
  const rows = await queryAll(
    `SELECT id, event_id, entity_type, entity_id, provider, target, status, attempts, next_attempt_at, last_error, created_at, updated_at
     FROM notification_delivery
     WHERE status IN ('pending', 'retrying') AND next_attempt_at <= ${p1}
     ORDER BY next_attempt_at ASC, id ASC
     LIMIT ${p2}`,
    [nowIso(), safeLimit]
  );
  return rows.map(mapNotificationDeliveryRow);
}

async function getNotificationDeliveryById(id) {
  const p1 = placeholder(1);
  const row = await queryOne(
    `SELECT id, event_id, entity_type, entity_id, provider, target, status, attempts, next_attempt_at, last_error, created_at, updated_at
     FROM notification_delivery WHERE id = ${p1} LIMIT 1`,
    [id]
  );
  return row ? mapNotificationDeliveryRow(row) : null;
}

async function listNotificationDeliveries({ status = "", limit = 100 } = {}) {
  const conditions = [];
  const params = [];
  let idx = 1;
  if (status) {
    conditions.push(`status = ${placeholder(idx++)}`);
    params.push(status);
  }
  const limitPlaceholder = placeholder(idx++);
  params.push(Math.max(1, Math.min(200, toNumber(limit) || 100)));
  const rows = await queryAll(
    `SELECT id, event_id, entity_type, entity_id, provider, target, status, attempts, next_attempt_at, last_error, created_at, updated_at
     FROM notification_delivery ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
     ORDER BY created_at DESC, id DESC LIMIT ${limitPlaceholder}`,
    params
  );
  return rows.map(mapNotificationDeliveryRow);
}

async function markNotificationDeliveryDelivered(id) {
  const p1 = placeholder(1);
  const p2 = placeholder(2);
  const result = await execute(
    `UPDATE notification_delivery SET status = 'delivered', last_error = '', updated_at = ${p1} WHERE id = ${p2}`,
    [nowIso(), id]
  );
  return result.changes;
}

async function recordNotificationDeliveryFailure(id, errorMessage, nextAttemptAt, maxAttempts = 3, nextTarget = null) {
  const current = await getNotificationDeliveryById(id);
  if (!current) return { changes: 0, status: "missing", attempts: 0 };
  const attempts = current.attempts + 1;
  const status = attempts >= maxAttempts ? "failed" : "retrying";
  const target = nextTarget == null
    ? current.target
    : String(nextTarget).replace(/\s+/g, " ").trim().slice(0, 255);
  const p1 = placeholder(1);
  const p2 = placeholder(2);
  const p3 = placeholder(3);
  const p4 = placeholder(4);
  const result = await execute(
    `UPDATE notification_delivery SET status = ${p1}, attempts = ${p2}, next_attempt_at = ${p3}, target = ${p4}, last_error = ${placeholder(5)}, updated_at = ${placeholder(6)} WHERE id = ${placeholder(7)}`,
    [status, attempts, nextAttemptAt || nowIso(), target, String(errorMessage || "投递失败").replace(/\s+/g, " ").slice(0, 500), nowIso(), id]
  );
  return { changes: result.changes, status, attempts };
}

async function retryNotificationDelivery(id) {
  const p1 = placeholder(1);
  const p2 = placeholder(2);
  const p3 = placeholder(3);
  const result = await execute(
    `UPDATE notification_delivery SET status = 'pending', attempts = 0, next_attempt_at = ${p1}, last_error = '', updated_at = ${p2} WHERE id = ${p3} AND status IN ('failed', 'retrying')`,
    [nowIso(), nowIso(), id]
  );
  return result.changes;
}

function mapPublicHighlight(row, kind) {
  const item = {
    id: toNumber(row.id),
    type: row.type,
    title: row.title,
    status: row.status,
    publicReply: row.public_reply || "",
    updatedAt: row.updated_at
  };
  if (kind === "worktask") {
    item.priority = row.priority;
    item.createdByAdmin = toBoolean(row.created_by_admin);
  }
  return item;
}

function mapAccountFeedbackRow(row) {
  return {
    id: toNumber(row.id),
    type: row.type,
    title: row.title,
    status: row.status,
    publicReply: row.public_reply || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapAccountWorktaskRow(row) {
  return {
    id: toNumber(row.id),
    type: row.type,
    title: row.title,
    priority: row.priority,
    status: row.status,
    publicReply: row.public_reply || "",
    expectedAt: row.expected_at || "",
    scheduledAt: row.scheduled_at || "",
    assignee: row.assignee || "",
    tags: row.tags || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
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
    `SELECT id, type, title, content, contact, images, status, show_on_home, admin_note, public_reply, account_user_id, account_email_snapshot, account_display_name_snapshot, created_at, updated_at
     FROM feedback
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
    [...params, pageSize, offset]
  );

  const items = rows.map(mapFeedbackRow);

  return {
    items,
    page,
    pageSize,
    total,
    summary,
    totalPages: total === 0 ? 1 : Math.ceil(total / pageSize)
  };
}

async function listFeedbackByAccountUser(accountUserId, limit = 100) {
  const p1 = placeholder(1);
  const p2 = placeholder(2);
  const rows = await queryAll(
    `SELECT id, type, title, status, public_reply, created_at, updated_at
     FROM feedback
     WHERE account_user_id = ${p1}
     ORDER BY created_at DESC
     LIMIT ${p2}`,
    [accountUserId, Math.max(1, Math.min(100, toNumber(limit) || 100))]
  );
  return {
    items: rows.map(mapAccountFeedbackRow),
    total: rows.length
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
    `SELECT id, type, title, content, contact, priority, status, show_on_home, created_by_admin, admin_note, public_reply, expected_at, scheduled_at, assignee, tags, account_user_id, account_email_snapshot, account_display_name_snapshot, created_at, updated_at
     FROM worktask
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
    [...params, pageSize, offset]
  );

  const items = rows.map(mapWorktaskRow);

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

async function listWorktaskByAccountUser(accountUserId, limit = 100) {
  const p1 = placeholder(1);
  const p2 = placeholder(2);
  const rows = await queryAll(
    `SELECT id, type, title, priority, status, public_reply, expected_at, scheduled_at, assignee, tags, created_at, updated_at
     FROM worktask
     WHERE account_user_id = ${p1}
     ORDER BY created_at DESC
     LIMIT ${p2}`,
    [accountUserId, Math.max(1, Math.min(100, toNumber(limit) || 100))]
  );
  return {
    items: rows.map(mapAccountWorktaskRow),
    total: rows.length
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

async function arrangeWorktask({ id, assignee, scheduledAt, status, assigneeProvided, scheduledAtProvided, statusProvided }) {
  const updates = [];
  const params = [];
  let idx = 1;

  const hasAssignee = assigneeProvided === undefined ? assignee !== undefined : Boolean(assigneeProvided);
  const hasScheduledAt = scheduledAtProvided === undefined ? scheduledAt !== undefined : Boolean(scheduledAtProvided);
  const hasStatus = statusProvided === undefined ? status !== undefined : Boolean(statusProvided);

  if (hasAssignee) {
    updates.push(`assignee = ${placeholder(idx++)}`);
    params.push(assignee || null);
  }
  if (hasScheduledAt) {
    updates.push(`scheduled_at = ${placeholder(idx++)}`);
    params.push(scheduledAt || null);
  }

  let nextStatus = hasStatus ? status : "";
  if (!hasStatus && ((hasAssignee && assignee) || (hasScheduledAt && scheduledAt))) {
    nextStatus = "scheduled";
  }
  if (nextStatus) {
    updates.push(`status = ${placeholder(idx++)}`);
    params.push(nextStatus);
  }

  if (updates.length === 0) {
    return 0;
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
    `SELECT id, type, title, status, public_reply, updated_at
     FROM feedback
     WHERE ${homeDisplayCondition()} AND status IN ('new', 'reviewed')
     ORDER BY updated_at DESC
     LIMIT ${p1}`,
    [limit]
  );
  const worktaskRows = await queryAll(
    `SELECT id, type, title, status, priority, created_by_admin, public_reply, updated_at
     FROM worktask
     WHERE ${homeDisplayCondition()} AND status IN ('new', 'scheduled', 'in_progress')
     ORDER BY updated_at DESC
     LIMIT ${p1}`,
    [limit]
  );

  return {
    feedbackItems: feedbackRows.map((row) => mapPublicHighlight(row, "feedback")),
    worktaskItems: worktaskRows.map((row) => mapPublicHighlight(row, "worktask"))
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
  sqliteSchemaStatements,
  mysqlSchemaStatements,
  postgresSchemaStatements,
  initializeDatabase,
  ensureBootstrapAdmin,
  cleanupExpiredSessions,
  nowIso,
  getHealthCounts,
  createFeedback,
  createWorktask,
  createWorktaskByAdmin,
  getAdminByUsername,
  getFeedbackById,
  getWorktaskById,
  listAiSourceItems,
  upsertAdminUser,
  createSessionRecord,
  deleteSessionByTokenHash,
  findSessionWithUserByTokenHash,
  deleteSessionById,
  touchSessionLastSeen,
  createAccountSessionRecord,
  deleteAccountSessionByTokenHash,
  findAccountSessionByTokenHash,
  deleteAccountSessionById,
  touchAccountSessionLastSeen,
  listFeedback,
  countExportRows,
  listFeedbackExportBatch,
  listWorktaskExportBatch,
  createAdminAudit,
  listAdminAudits,
  listFeedbackByAccountUser,
  updateFeedbackStatus,
  updateFeedbackHomeDisplay,
  updateFeedbackNoteReply,
  deleteFeedback,
  listWorktask,
  listWorktaskByAccountUser,
  updateWorktaskStatus,
  updateWorktaskHomeDisplay,
  updateWorktaskNoteReply,
  arrangeWorktask,
  deleteWorktask,
  getHomeHighlights,
  getStatusSettings,
  updateStatusProfileSettings,
  updateMinecraftStatusSettings,
  getAiProviderProfiles,
  setAiProviderProfiles,
  createAiSuggestion,
  getAiSuggestionById,
  listAiSuggestions,
  recordAiSuggestionDecision,
  deleteExpiredAiSuggestions,
  createAiKnowledgeAnswer,
  getAiKnowledgeAnswerById,
  listAiKnowledgeAnswers,
  deleteAiKnowledgeAnswer,
  deleteExpiredAiKnowledgeAnswers,
  getAiKnowledgeSettings,
  setAiKnowledgeSettings,
  enqueueNotificationDelivery,
  enqueueNotificationDeliveries,
  listDueNotificationDeliveries,
  getNotificationDeliveryById,
  listNotificationDeliveries,
  markNotificationDeliveryDelivered,
  recordNotificationDeliveryFailure,
  retryNotificationDelivery,
  closeDatabase
};
