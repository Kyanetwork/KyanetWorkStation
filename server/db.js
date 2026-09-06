const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const config = require("./config");
const { logger } = require("./logger");
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
    `CREATE TABLE IF NOT EXISTS ai_request_metric (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation TEXT NOT NULL,
      profile_id TEXT NOT NULL DEFAULT '',
      protocol TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      input_tokens INTEGER,
      output_tokens INTEGER,
      usage_present INTEGER NOT NULL DEFAULT 0,
      error_code TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS idx_ai_request_metric_created_at ON ai_request_metric(created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_ai_request_metric_operation_created ON ai_request_metric(operation, created_at DESC)",
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
    "CREATE INDEX IF NOT EXISTS idx_admin_audit_actor ON admin_audit(actor_user_id)",
    `CREATE TABLE IF NOT EXISTS project (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      public_basic INTEGER NOT NULL DEFAULT 0,
      public_milestones INTEGER NOT NULL DEFAULT 0,
      public_updated_at INTEGER NOT NULL DEFAULT 0,
      public_completion INTEGER NOT NULL DEFAULT 0,
      completion_mode TEXT NOT NULL DEFAULT 'auto',
      custom_completion INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS idx_project_status_updated ON project(status, updated_at DESC)",
    `CREATE TABLE IF NOT EXISTS project_milestone (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      target_date TEXT,
      is_completed INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES project(id) ON DELETE CASCADE
    )`,
    "CREATE INDEX IF NOT EXISTS idx_project_milestone_project ON project_milestone(project_id, status, sort_order, id)",
    `CREATE TABLE IF NOT EXISTS project_item (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      source_type TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      milestone_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(source_type, source_id),
      FOREIGN KEY(project_id) REFERENCES project(id) ON DELETE CASCADE,
      FOREIGN KEY(milestone_id) REFERENCES project_milestone(id) ON DELETE SET NULL
    )`,
    "CREATE INDEX IF NOT EXISTS idx_project_item_project ON project_item(project_id, source_type)",
    "CREATE INDEX IF NOT EXISTS idx_project_item_milestone ON project_item(project_id, milestone_id)"
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
    `CREATE TABLE IF NOT EXISTS ai_request_metric (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      operation VARCHAR(32) NOT NULL,
      profile_id VARCHAR(128) NOT NULL DEFAULT '',
      protocol VARCHAR(64) NOT NULL DEFAULT '',
      model VARCHAR(120) NOT NULL DEFAULT '',
      status VARCHAR(32) NOT NULL,
      duration_ms BIGINT NOT NULL,
      input_tokens BIGINT NULL,
      output_tokens BIGINT NULL,
      usage_present TINYINT(1) NOT NULL DEFAULT 0,
      error_code VARCHAR(64) NOT NULL DEFAULT '',
      created_at VARCHAR(40) NOT NULL,
      INDEX idx_ai_request_metric_created_at (created_at),
      INDEX idx_ai_request_metric_operation_created (operation, created_at)
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS project (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      public_key VARCHAR(36) NOT NULL UNIQUE,
      name VARCHAR(120) NOT NULL,
      description VARCHAR(2000) NOT NULL DEFAULT '',
      status VARCHAR(16) NOT NULL DEFAULT 'active',
      public_basic TINYINT(1) NOT NULL DEFAULT 0,
      public_milestones TINYINT(1) NOT NULL DEFAULT 0,
      public_updated_at TINYINT(1) NOT NULL DEFAULT 0,
      public_completion TINYINT(1) NOT NULL DEFAULT 0,
      completion_mode VARCHAR(16) NOT NULL DEFAULT 'auto',
      custom_completion INT NULL,
      created_at VARCHAR(40) NOT NULL,
      updated_at VARCHAR(40) NOT NULL,
      INDEX idx_project_status_updated (status, updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS project_milestone (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      project_id BIGINT NOT NULL,
      title VARCHAR(160) NOT NULL,
      description VARCHAR(2000) NOT NULL DEFAULT '',
      target_date VARCHAR(10) NULL,
      is_completed TINYINT(1) NOT NULL DEFAULT 0,
      sort_order INT NOT NULL DEFAULT 0,
      status VARCHAR(16) NOT NULL DEFAULT 'active',
      created_at VARCHAR(40) NOT NULL,
      updated_at VARCHAR(40) NOT NULL,
      INDEX idx_project_milestone_project (project_id, status, sort_order, id),
      CONSTRAINT fk_project_milestone_project FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS project_item (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      project_id BIGINT NOT NULL,
      source_type VARCHAR(32) NOT NULL,
      source_id BIGINT NOT NULL,
      milestone_id BIGINT NULL,
      created_at VARCHAR(40) NOT NULL,
      updated_at VARCHAR(40) NOT NULL,
      UNIQUE KEY uq_project_item_source (source_type, source_id),
      INDEX idx_project_item_project (project_id, source_type),
      INDEX idx_project_item_milestone (project_id, milestone_id),
      CONSTRAINT fk_project_item_project FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
      CONSTRAINT fk_project_item_milestone FOREIGN KEY (milestone_id) REFERENCES project_milestone(id) ON DELETE SET NULL
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
    `CREATE TABLE IF NOT EXISTS ai_request_metric (
      id BIGSERIAL PRIMARY KEY,
      operation TEXT NOT NULL,
      profile_id TEXT NOT NULL DEFAULT '',
      protocol TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      duration_ms BIGINT NOT NULL,
      input_tokens BIGINT,
      output_tokens BIGINT,
      usage_present BOOLEAN NOT NULL DEFAULT FALSE,
      error_code TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS idx_ai_request_metric_created_at ON ai_request_metric(created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_ai_request_metric_operation_created ON ai_request_metric(operation, created_at DESC)",
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
    "CREATE INDEX IF NOT EXISTS idx_admin_audit_actor ON admin_audit(actor_user_id)",
    `CREATE TABLE IF NOT EXISTS project (
      id BIGSERIAL PRIMARY KEY,
      public_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      public_basic BOOLEAN NOT NULL DEFAULT FALSE,
      public_milestones BOOLEAN NOT NULL DEFAULT FALSE,
      public_updated_at BOOLEAN NOT NULL DEFAULT FALSE,
      public_completion BOOLEAN NOT NULL DEFAULT FALSE,
      completion_mode TEXT NOT NULL DEFAULT 'auto',
      custom_completion INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS idx_project_status_updated ON project(status, updated_at DESC)",
    `CREATE TABLE IF NOT EXISTS project_milestone (
      id BIGSERIAL PRIMARY KEY,
      project_id BIGINT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      target_date TEXT,
      is_completed BOOLEAN NOT NULL DEFAULT FALSE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS idx_project_milestone_project ON project_milestone(project_id, status, sort_order, id)",
    `CREATE TABLE IF NOT EXISTS project_item (
      id BIGSERIAL PRIMARY KEY,
      project_id BIGINT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL,
      source_id BIGINT NOT NULL,
      milestone_id BIGINT REFERENCES project_milestone(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(source_type, source_id)
    )`,
    "CREATE INDEX IF NOT EXISTS idx_project_item_project ON project_item(project_id, source_type)",
    "CREATE INDEX IF NOT EXISTS idx_project_item_milestone ON project_item(project_id, milestone_id)"
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
  await ensureProjectSchema();
}

async function ensureProjectSchema() {
  const statements = client === "sqlite"
    ? sqliteSchemaStatements()
    : client === "mysql"
      ? mysqlSchemaStatements()
      : postgresSchemaStatements();
  const projectStatements = statements.filter((statement) => {
    const normalized = String(statement || "").toLowerCase();
    return normalized.includes("project") || normalized.includes("idx_project");
  });
  await executeMany(projectStatements);
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

async function recordAiSuggestionDecision(id, decision, fields = [], actor = "", now = nowIso()) {
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
  const decisionAt = typeof now === "string" && now ? now : nowIso();
  const result = await execute(
    `UPDATE ai_copilot_suggestion
     SET status = ${p1}, accepted_fields = ${p2}, decided_by = ${p3}, decided_at = ${p4}
     WHERE id = ${p5} AND status = 'available' AND expires_at > ${p6}`,
    [normalizedDecision, JSON.stringify(normalizedFields), String(actor || "").slice(0, 128), decisionAt, id, decisionAt]
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
  const createdAtTime = typeof input.createdAt === "string" ? Date.parse(input.createdAt) : NaN;
  const createdAt = Number.isFinite(createdAtTime) ? new Date(createdAtTime).toISOString() : nowIso();
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

const AI_METRIC_OPERATIONS = new Set(["copilot_suggest", "knowledge_ask", "provider_diagnostic"]);
const AI_METRIC_STATUSES = new Set(["success", "failed", "timeout"]);
const MAX_AI_METRIC_WINDOW_MS = 720 * 60 * 60 * 1000;

function normalizeMetricToken(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value !== "string" || !/^\d+$/u.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function mapAiRequestMetricSummaryRow(row) {
  const numberOrNull = (value) => value === null || value === undefined || value === "" ? null : toNumber(value);
  return {
    total: toNumber(row && row.total),
    success: toNumber(row && row.success),
    failed: toNumber(row && row.failed),
    timeout: toNumber(row && row.timeout),
    averageDurationMs: numberOrNull(row && row.average_duration_ms),
    inputTokens: numberOrNull(row && row.input_tokens),
    outputTokens: numberOrNull(row && row.output_tokens),
    unknownUsageCount: toNumber(row && row.unknown_usage_count)
  };
}

function mapAiRequestMetricGroupRow(row) {
  return {
    operation: String(row && row.operation || "").slice(0, 32),
    protocol: String(row && row.protocol || "").slice(0, 64),
    ...mapAiRequestMetricSummaryRow(row)
  };
}

async function createAiRequestMetric(input = {}) {
  const operation = typeof input.operation === "string" && AI_METRIC_OPERATIONS.has(input.operation)
    ? input.operation
    : "";
  const status = typeof input.status === "string" && AI_METRIC_STATUSES.has(input.status)
    ? input.status
    : "failed";
  if (!operation) throw new Error("Invalid AI metric operation");
  const durationCandidate = typeof input.durationMs === "number" ? input.durationMs : Number(input.durationMs);
  const durationMs = Number.isSafeInteger(durationCandidate) && durationCandidate >= 0
    ? Math.min(durationCandidate, 600000)
    : 0;
  const profileId = String(input.profileId || "").slice(0, 128);
  const protocol = String(input.protocol || "").slice(0, 64);
  const modelCandidate = String(input.model || "").slice(0, 120);
  const model = /^(?:https?:)?\/\//iu.test(modelCandidate) ? "" : modelCandidate;
  const errorCode = typeof input.errorCode === "string" && /^[A-Za-z0-9_.-]{0,64}$/u.test(input.errorCode)
    ? input.errorCode
    : "";
  const createdAt = typeof input.createdAt === "string" && !Number.isNaN(Date.parse(input.createdAt))
    ? input.createdAt.slice(0, 40)
    : nowIso();
  const params = [
    operation,
    profileId,
    protocol,
    model,
    status,
    durationMs,
    normalizeMetricToken(input.inputTokens),
    normalizeMetricToken(input.outputTokens),
    toDbBoolean(input.usagePresent === true),
    errorCode,
    createdAt
  ];
  const marks = params.map((_, index) => placeholder(index + 1));
  const columns = "operation, profile_id, protocol, model, status, duration_ms, input_tokens, output_tokens, usage_present, error_code, created_at";
  const sql = client === "postgres"
    ? `INSERT INTO ai_request_metric (${columns}) VALUES (${marks.join(", ")}) RETURNING id`
    : `INSERT INTO ai_request_metric (${columns}) VALUES (${marks.join(", ")})`;
  const result = await execute(sql, params);
  return result.lastInsertId;
}

function metricAggregateSql(where) {
  return `SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status = 'timeout' THEN 1 ELSE 0 END) AS timeout,
      AVG(duration_ms) AS average_duration_ms,
      SUM(input_tokens) AS input_tokens,
      SUM(output_tokens) AS output_tokens,
      SUM(CASE WHEN input_tokens IS NULL OR output_tokens IS NULL THEN 1 ELSE 0 END) AS unknown_usage_count
    FROM ai_request_metric WHERE ${where}`;
}

function normalizeAiMetricWindow({ from, to } = {}) {
  const fallbackTo = nowIso();
  const startValue = from === undefined || from === null
    ? new Date(Date.parse(fallbackTo) - 24 * 60 * 60 * 1000).toISOString()
    : from;
  const endValue = to === undefined || to === null ? fallbackTo : to;
  const startTime = typeof startValue === "string" && startValue.trim() ? Date.parse(startValue) : NaN;
  const endTime = typeof endValue === "string" && endValue.trim() ? Date.parse(endValue) : NaN;
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    const error = new Error("Invalid AI metric time window");
    error.code = "INVALID_PAYLOAD";
    throw error;
  }
  if (startTime >= endTime || endTime - startTime > MAX_AI_METRIC_WINDOW_MS) {
    const error = new Error("Invalid AI metric time window");
    error.code = "INVALID_PAYLOAD";
    throw error;
  }
  return {
    from: new Date(startTime).toISOString(),
    to: new Date(endTime).toISOString()
  };
}

async function listAiRequestMetricSummary({ from, to, maxGroups = 100 } = {}) {
  const window = normalizeAiMetricWindow({ from, to });
  const start = window.from;
  const end = window.to;
  const limit = Number.isSafeInteger(Number(maxGroups)) && Number(maxGroups) > 0 ? Math.min(Number(maxGroups), 100) : 100;
  const p1 = placeholder(1);
  const p2 = placeholder(2);
  const where = `created_at >= ${p1} AND created_at < ${p2}`;
  const totalRow = await queryOne(metricAggregateSql(where), [start, end]);
  const p3 = placeholder(3);
  const groups = await queryAll(
    `SELECT operation, protocol,
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN status = 'timeout' THEN 1 ELSE 0 END) AS timeout,
       AVG(duration_ms) AS average_duration_ms,
       SUM(input_tokens) AS input_tokens,
       SUM(output_tokens) AS output_tokens,
       SUM(CASE WHEN input_tokens IS NULL OR output_tokens IS NULL THEN 1 ELSE 0 END) AS unknown_usage_count
     FROM ai_request_metric WHERE ${where}
     GROUP BY operation, protocol
     ORDER BY total DESC, operation ASC, protocol ASC
     LIMIT ${p3}`,
    [start, end, limit]
  );
  return {
    ...mapAiRequestMetricSummaryRow(totalRow || {}),
    groups: groups.slice(0, 100).map(mapAiRequestMetricGroupRow)
  };
}

async function deleteExpiredAiRequestMetrics(cutoff = nowIso()) {
  const p1 = placeholder(1);
  const result = await execute(`DELETE FROM ai_request_metric WHERE created_at < ${p1}`, [cutoff]);
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
  if (result.changes > 0) {
    try {
      await cleanupProjectItemsForSource({ sourceType: "feedback", sourceId: id });
    } catch (error) {
      logger.warn({ event: "project.item.cleanup.error", sourceType: "feedback", sourceId: projectIdValue(id), errorCode: error && error.code ? String(error.code).slice(0, 64) : "CLEANUP_FAILED" }, "project item cleanup failed after feedback deletion");
    }
  }
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
  if (result.changes > 0) {
    try {
      await cleanupProjectItemsForSource({ sourceType: "worktask", sourceId: id });
    } catch (error) {
      logger.warn({ event: "project.item.cleanup.error", sourceType: "worktask", sourceId: projectIdValue(id), errorCode: error && error.code ? String(error.code).slice(0, 64) : "CLEANUP_FAILED" }, "project item cleanup failed after worktask deletion");
    }
  }
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

const PROJECT_STATUSES = new Set(["active", "archived"]);
const PROJECT_COMPLETION_MODES = new Set(["auto", "custom"]);
const PROJECT_SOURCE_TYPES = new Set(["feedback", "worktask"]);
const PROJECT_MILESTONE_STATUSES = new Set(["active", "revoked"]);

function projectError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function projectIdValue(value) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeProjectText(value, maxLength) {
  const text = value == null ? "" : String(value).trim();
  return Array.from(text).slice(0, maxLength).join("");
}

function projectBoolCondition(columnName) {
  return client === "postgres" ? `${columnName} = TRUE` : `${columnName} = 1`;
}

function mapProjectMilestoneRow(row) {
  return {
    id: toNumber(row.id),
    projectId: toNumber(row.project_id),
    title: normalizeProjectText(row.title, 160),
    description: normalizeProjectText(row.description, 2000),
    targetDate: row.target_date || "",
    isCompleted: toBoolean(row.is_completed),
    sortOrder: toNumber(row.sort_order),
    status: PROJECT_MILESTONE_STATUSES.has(row.status) ? row.status : "active",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

function mapProjectItemRow(row) {
  return {
    id: toNumber(row.id),
    projectId: toNumber(row.project_id),
    sourceType: PROJECT_SOURCE_TYPES.has(row.source_type) ? row.source_type : "",
    sourceId: toNumber(row.source_id),
    milestoneId: row.milestone_id == null ? null : toNumber(row.milestone_id),
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

function projectCompletion(activeTotal, activeCompleted, completionMode, customCompletion) {
  if (completionMode === "custom" && Number.isSafeInteger(customCompletion) && customCompletion >= 0 && customCompletion <= 100) {
    return customCompletion;
  }
  if (!activeTotal) return null;
  return Math.round((activeCompleted / activeTotal) * 100);
}

function mapProjectRow(row, stats = {}) {
  const completionMode = PROJECT_COMPLETION_MODES.has(row.completion_mode) ? row.completion_mode : "auto";
  const custom = row.custom_completion == null ? null : toNumber(row.custom_completion);
  const activeTotal = toNumber(stats.activeTotal == null ? row.active_milestone_count : stats.activeTotal);
  const activeCompleted = toNumber(stats.activeCompleted == null ? row.active_completed_count : stats.activeCompleted);
  const completion = projectCompletion(activeTotal, activeCompleted, completionMode, custom);
  return {
    id: toNumber(row.id),
    publicKey: normalizeProjectText(row.public_key, 64),
    name: normalizeProjectText(row.name, 120),
    description: normalizeProjectText(row.description, 2000),
    status: PROJECT_STATUSES.has(row.status) ? row.status : "active",
    publicBasic: toBoolean(row.public_basic),
    publicMilestones: toBoolean(row.public_milestones),
    publicUpdatedAt: toBoolean(row.public_updated_at),
    publicCompletion: toBoolean(row.public_completion),
    completionMode,
    customCompletion: completionMode === "custom" && Number.isSafeInteger(custom) ? custom : null,
    completion,
    milestoneCount: toNumber(stats.milestoneCount == null ? row.milestone_count : stats.milestoneCount),
    activeMilestoneCount: activeTotal,
    itemCount: toNumber(stats.itemCount == null ? row.item_count : stats.itemCount),
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

async function getProjectMilestoneStats(projectId) {
  const p1 = placeholder(1);
  const row = await queryOne(
    `SELECT
       COUNT(*) AS milestone_count,
       SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_milestone_count,
       SUM(CASE WHEN status = 'active' AND ${projectBoolCondition("is_completed")} THEN 1 ELSE 0 END) AS active_completed_count
     FROM project_milestone WHERE project_id = ${p1}`,
    [projectId]
  );
  const itemRow = await queryOne(`SELECT COUNT(*) AS item_count FROM project_item WHERE project_id = ${p1}`, [projectId]);
  return {
    milestoneCount: toNumber(row && row.milestone_count),
    activeTotal: toNumber(row && row.active_milestone_count),
    activeCompleted: toNumber(row && row.active_completed_count),
    itemCount: toNumber(itemRow && itemRow.item_count)
  };
}

async function getProjectById(id) {
  const projectId = projectIdValue(id);
  if (!projectId) return null;
  const p1 = placeholder(1);
  const row = await queryOne(
    `SELECT id, public_key, name, description, status, public_basic, public_milestones,
            public_updated_at, public_completion, completion_mode, custom_completion,
            created_at, updated_at
     FROM project WHERE id = ${p1} LIMIT 1`,
    [projectId]
  );
  if (!row) return null;
  return mapProjectRow(row, await getProjectMilestoneStats(projectId));
}

async function listProjects({ status = "active", keyword = "", page = 1, pageSize = 20 } = {}) {
  const normalizedStatus = status === "all" || PROJECT_STATUSES.has(status) ? status : "active";
  const normalizedKeyword = normalizeProjectText(keyword, 200);
  const safePage = Math.max(1, Math.min(100000, projectIdValue(page) || 1));
  const safePageSize = Math.max(1, Math.min(100, projectIdValue(pageSize) || 20));
  const conditions = [];
  const params = [];
  let index = 1;
  if (normalizedStatus !== "all") {
    conditions.push(`status = ${placeholder(index++)}`);
    params.push(normalizedStatus);
  }
  if (normalizedKeyword) {
    conditions.push(`(name LIKE ${placeholder(index)} OR description LIKE ${placeholder(index + 1)})`);
    params.push(`%${normalizedKeyword}%`, `%${normalizedKeyword}%`);
    index += 2;
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const totalRow = await queryOne(`SELECT COUNT(*) AS count FROM project ${whereClause}`, params);
  const offset = (safePage - 1) * safePageSize;
  const rows = await queryAll(
    `SELECT id, public_key, name, description, status, public_basic, public_milestones,
            public_updated_at, public_completion, completion_mode, custom_completion,
            created_at, updated_at
     FROM project ${whereClause}
     ORDER BY updated_at DESC, id DESC
     LIMIT ${placeholder(index)} OFFSET ${placeholder(index + 1)}`,
    [...params, safePageSize, offset]
  );
  const items = [];
  for (const row of rows) items.push(mapProjectRow(row, await getProjectMilestoneStats(toNumber(row.id))));
  const total = toNumber(totalRow && totalRow.count);
  return {
    items,
    page: safePage,
    pageSize: safePageSize,
    total,
    totalPages: total === 0 ? 1 : Math.ceil(total / safePageSize)
  };
}

async function createProject(input = {}) {
  const name = normalizeProjectText(input.name, 120);
  if (!name) throw projectError("INVALID_PAYLOAD", "项目名称不能为空");
  const description = normalizeProjectText(input.description, 2000);
  const status = PROJECT_STATUSES.has(input.status) ? input.status : "active";
  const completionMode = PROJECT_COMPLETION_MODES.has(input.completionMode) ? input.completionMode : "auto";
  const customCompletion = completionMode === "custom" && Number.isSafeInteger(Number(input.customCompletion))
    ? Math.max(0, Math.min(100, Number(input.customCompletion)))
    : null;
  const publicKey = crypto.randomUUID();
  const now = nowIso();
  const params = [
    publicKey, name, description, status,
    toDbBoolean(input.publicBasic === true),
    toDbBoolean(input.publicMilestones === true),
    toDbBoolean(input.publicUpdatedAt === true),
    toDbBoolean(input.publicCompletion === true),
    completionMode, customCompletion, now, now
  ];
  const marks = params.map((_, index) => placeholder(index + 1));
  const sql = client === "postgres"
    ? `INSERT INTO project (public_key, name, description, status, public_basic, public_milestones, public_updated_at, public_completion, completion_mode, custom_completion, created_at, updated_at)
       VALUES (${marks.join(", ")}) RETURNING id`
    : `INSERT INTO project (public_key, name, description, status, public_basic, public_milestones, public_updated_at, public_completion, completion_mode, custom_completion, created_at, updated_at)
       VALUES (${marks.join(", ")})`;
  const result = await execute(sql, params);
  return result.lastInsertId;
}

async function updateProject(idOrInput, patch = {}) {
  const input = idOrInput && typeof idOrInput === "object" ? idOrInput : { ...patch, id: idOrInput };
  const projectId = projectIdValue(input.id);
  if (!projectId) throw projectError("INVALID_PAYLOAD", "项目 id 不合法");
  const current = await getProjectById(projectId);
  if (!current) return 0;
  const updates = [];
  const params = [];
  let index = 1;
  const add = (column, value) => {
    updates.push(`${column} = ${placeholder(index++)}`);
    params.push(value);
  };
  if (Object.prototype.hasOwnProperty.call(input, "name")) {
    const name = normalizeProjectText(input.name, 120);
    if (!name) throw projectError("INVALID_PAYLOAD", "项目名称不能为空");
    add("name", name);
  }
  if (Object.prototype.hasOwnProperty.call(input, "description")) add("description", normalizeProjectText(input.description, 2000));
  for (const [field, column] of [["publicBasic", "public_basic"], ["publicMilestones", "public_milestones"], ["publicUpdatedAt", "public_updated_at"], ["publicCompletion", "public_completion"]]) {
    if (Object.prototype.hasOwnProperty.call(input, field)) add(column, toDbBoolean(input[field] === true));
  }
  if (Object.prototype.hasOwnProperty.call(input, "completionMode") || Object.prototype.hasOwnProperty.call(input, "customCompletion")) {
    const mode = PROJECT_COMPLETION_MODES.has(input.completionMode) ? input.completionMode : current.completionMode;
    if (!PROJECT_COMPLETION_MODES.has(mode)) throw projectError("INVALID_PAYLOAD", "completionMode 不合法");
    add("completion_mode", mode);
    const custom = mode === "custom" && Number.isSafeInteger(Number(input.customCompletion))
      ? Math.max(0, Math.min(100, Number(input.customCompletion)))
      : null;
    if (mode === "custom" && custom === null) throw projectError("INVALID_PAYLOAD", "custom 模式需要完成度");
    add("custom_completion", custom);
  }
  if (!updates.length) return 0;
  add("updated_at", nowIso());
  params.push(projectId);
  const result = await execute(`UPDATE project SET ${updates.join(", ")} WHERE id = ${placeholder(index)}`, params);
  return result.changes;
}

async function setProjectStatus(id, status) {
  const projectId = projectIdValue(id);
  if (!projectId) return 0;
  const existsPlaceholder = placeholder(1);
  const existing = await queryOne(`SELECT id FROM project WHERE id = ${existsPlaceholder} LIMIT 1`, [projectId]);
  if (!existing) return 0;
  const statusPlaceholder = placeholder(1);
  const timestampPlaceholder = placeholder(2);
  const idPlaceholder = placeholder(3);
  await execute(`UPDATE project SET status = ${statusPlaceholder}, updated_at = ${timestampPlaceholder} WHERE id = ${idPlaceholder}`, [status, nowIso(), projectId]);
  // Return existence rather than driver-specific affected-row semantics. MySQL
  // may report 0 when an idempotent update leaves every value unchanged.
  return 1;
}

async function archiveProject(id) {
  return setProjectStatus(id, "archived");
}

async function restoreProject(id) {
  return setProjectStatus(id, "active");
}

async function getProjectMilestoneById(id) {
  const milestoneId = projectIdValue(id);
  if (!milestoneId) return null;
  const p1 = placeholder(1);
  const row = await queryOne(
    `SELECT id, project_id, title, description, target_date, is_completed, sort_order, status, created_at, updated_at
     FROM project_milestone WHERE id = ${p1} LIMIT 1`,
    [milestoneId]
  );
  return row ? mapProjectMilestoneRow(row) : null;
}

async function createProjectMilestone(input = {}) {
  const projectId = projectIdValue(input.projectId);
  const project = await getProjectById(projectId);
  if (!project) throw projectError("NOT_FOUND", "项目不存在");
  if (project.status === "archived") throw projectError("PROJECT_STATE_CONFLICT", "归档项目不能新增里程碑");
  const title = normalizeProjectText(input.title, 160);
  if (!title) throw projectError("INVALID_PAYLOAD", "里程碑标题不能为空");
  const params = [
    projectId, title, normalizeProjectText(input.description, 2000),
    input.targetDate ? String(input.targetDate).trim().slice(0, 10) : null,
    toDbBoolean(input.isCompleted === true),
    Number.isSafeInteger(Number(input.sortOrder)) ? Math.max(0, Math.min(100000, Number(input.sortOrder))) : 0,
    nowIso(), nowIso()
  ];
  const marks = params.map((_, index) => placeholder(index + 1));
  const sql = client === "postgres"
    ? `INSERT INTO project_milestone (project_id, title, description, target_date, is_completed, sort_order, status, created_at, updated_at)
       VALUES (${marks[0]}, ${marks[1]}, ${marks[2]}, ${marks[3]}, ${marks[4]}, ${marks[5]}, 'active', ${marks[6]}, ${marks[7]}) RETURNING id`
    : `INSERT INTO project_milestone (project_id, title, description, target_date, is_completed, sort_order, status, created_at, updated_at)
       VALUES (${marks[0]}, ${marks[1]}, ${marks[2]}, ${marks[3]}, ${marks[4]}, ${marks[5]}, 'active', ${marks[6]}, ${marks[7]})`;
  const result = await execute(sql, params);
  return result.lastInsertId;
}

async function updateProjectMilestone(idOrInput, patch = {}) {
  const input = idOrInput && typeof idOrInput === "object" ? idOrInput : { ...patch, id: idOrInput };
  const milestoneId = projectIdValue(input.id);
  const current = await getProjectMilestoneById(milestoneId);
  if (!current) return 0;
  const updates = [];
  const params = [];
  let index = 1;
  const add = (column, value) => {
    updates.push(`${column} = ${placeholder(index++)}`);
    params.push(value);
  };
  if (Object.prototype.hasOwnProperty.call(input, "title")) {
    const title = normalizeProjectText(input.title, 160);
    if (!title) throw projectError("INVALID_PAYLOAD", "里程碑标题不能为空");
    add("title", title);
  }
  if (Object.prototype.hasOwnProperty.call(input, "description")) add("description", normalizeProjectText(input.description, 2000));
  if (Object.prototype.hasOwnProperty.call(input, "targetDate")) add("target_date", input.targetDate ? String(input.targetDate).trim().slice(0, 10) : null);
  if (Object.prototype.hasOwnProperty.call(input, "isCompleted")) add("is_completed", toDbBoolean(input.isCompleted === true));
  if (Object.prototype.hasOwnProperty.call(input, "sortOrder")) add("sort_order", Math.max(0, Math.min(100000, Number(input.sortOrder) || 0)));
  if (!updates.length) return 0;
  add("updated_at", nowIso());
  params.push(milestoneId);
  const result = await execute(`UPDATE project_milestone SET ${updates.join(", ")} WHERE id = ${placeholder(index)}`, params);
  return result.changes;
}

async function setProjectMilestoneStatus(id, status) {
  const milestoneId = projectIdValue(id);
  if (!PROJECT_MILESTONE_STATUSES.has(status)) throw projectError("INVALID_PAYLOAD", "里程碑状态不合法");
  const milestone = await getProjectMilestoneById(milestoneId);
  if (!milestone) return 0;
  const p1 = placeholder(1);
  const p2 = placeholder(2);
  const result = await execute(`UPDATE project_milestone SET status = ${p1}, updated_at = ${p2} WHERE id = ${placeholder(3)}`, [status, nowIso(), milestoneId]);
  if (status === "revoked") {
    const p3 = placeholder(1);
    try {
      await execute(`UPDATE project_item SET milestone_id = NULL, updated_at = ${p3} WHERE milestone_id = ${placeholder(2)}`, [nowIso(), milestoneId]);
    } catch (error) {
      logger.warn({
        event: "project.item.milestone_revoke_cleanup.error",
        milestoneId,
        errorCode: error && error.code ? String(error.code).slice(0, 64) : "CLEANUP_FAILED"
      }, "project milestone association cleanup failed");
      throw error;
    }
  }
  // Return existence rather than driver-specific affected-row semantics. Some
  // drivers report 0 when an idempotent status update writes the same value.
  return result.changes > 0 ? result.changes : 1;
}

async function revokeProjectMilestone(id) {
  return setProjectMilestoneStatus(id, "revoked");
}

async function restoreProjectMilestone(id) {
  return setProjectMilestoneStatus(id, "active");
}

async function getProjectItemBySource(sourceOrType, sourceIdValue) {
  const input = sourceOrType && typeof sourceOrType === "object"
    ? sourceOrType
    : { sourceType: sourceOrType, sourceId: sourceIdValue };
  const sourceType = String(input.sourceType || "").trim();
  const sourceId = projectIdValue(input.sourceId === undefined ? input.entityId : input.sourceId);
  if (!PROJECT_SOURCE_TYPES.has(sourceType) || !sourceId) return null;
  const p1 = placeholder(1);
  const p2 = placeholder(2);
  const row = await queryOne(
    `SELECT id, project_id, source_type, source_id, milestone_id, created_at, updated_at
     FROM project_item WHERE source_type = ${p1} AND source_id = ${p2} LIMIT 1`,
    [sourceType, sourceId]
  );
  return row ? mapProjectItemRow(row) : null;
}

async function projectSourceSummary(sourceType, sourceId) {
  const source = sourceType === "feedback" ? await getFeedbackById(sourceId) : await getWorktaskById(sourceId);
  if (!source) return null;
  const summary = {
    sourceType,
    sourceId: source.id,
    title: normalizeProjectText(source.title, 255),
    type: normalizeProjectText(source.type, 64),
    status: normalizeProjectText(source.status, 32),
    updatedAt: source.updatedAt || ""
  };
  if (sourceType === "worktask") {
    summary.priority = normalizeProjectText(source.priority, 32);
    summary.assignee = normalizeProjectText(source.assignee, 100);
    summary.scheduledAt = source.scheduledAt || "";
    summary.expectedAt = source.expectedAt || "";
  }
  return summary;
}

async function getProjectDetail(id) {
  const project = await getProjectById(id);
  if (!project) return null;
  const projectId = project.id;
  const p1 = placeholder(1);
  const milestoneRows = await queryAll(
    `SELECT id, project_id, title, description, target_date, is_completed, sort_order, status, created_at, updated_at
     FROM project_milestone WHERE project_id = ${p1} ORDER BY sort_order ASC, id ASC`,
    [projectId]
  );
  const itemRows = await queryAll(
    `SELECT id, project_id, source_type, source_id, milestone_id, created_at, updated_at
     FROM project_item WHERE project_id = ${p1} ORDER BY created_at DESC, id DESC`,
    [projectId]
  );
  const milestones = milestoneRows.map(mapProjectMilestoneRow);
  const validMilestoneIds = new Set(milestones.filter((item) => item.status === "active").map((item) => item.id));
  const items = [];
  for (const row of itemRows) {
    const item = mapProjectItemRow(row);
    if (!PROJECT_SOURCE_TYPES.has(item.sourceType) || !Number.isSafeInteger(item.sourceId) || item.sourceId <= 0) {
      continue;
    }
    const source = await projectSourceSummary(item.sourceType, item.sourceId);
    if (!source) {
      try {
        await cleanupProjectItemsForSource({ sourceType: item.sourceType, sourceId: item.sourceId });
      } catch (error) {
        logger.warn({
          event: "project.item.orphan_cleanup.error",
          sourceType: item.sourceType,
          sourceId: item.sourceId,
          errorCode: error && error.code ? String(error.code).slice(0, 64) : "CLEANUP_FAILED"
        }, "project item orphan cleanup failed");
      }
      continue;
    }
    if (item.milestoneId !== null && !validMilestoneIds.has(item.milestoneId)) {
      item.milestoneId = null;
      try {
        const p2 = placeholder(1);
        const p3 = placeholder(2);
        await execute(
          `UPDATE project_item SET milestone_id = NULL, updated_at = ${p2} WHERE id = ${p3}`,
          [nowIso(), item.id]
        );
      } catch (error) {
        logger.warn({
          event: "project.item.milestone_cleanup.error",
          itemId: item.id,
          errorCode: error && error.code ? String(error.code).slice(0, 64) : "CLEANUP_FAILED"
        }, "project item milestone cleanup failed");
      }
    }
    items.push({ ...item, ...source });
  }
  return { project: { ...project, itemCount: items.length }, milestones, items };
}

async function listProjectItemCandidates({ sourceType, keyword = "", page = 1, pageSize = 20 } = {}) {
  if (!PROJECT_SOURCE_TYPES.has(sourceType)) throw projectError("INVALID_PAYLOAD", "sourceType 不合法");
  const safePage = Math.max(1, Math.min(100000, projectIdValue(page) || 1));
  const safePageSize = Math.max(1, Math.min(100, projectIdValue(pageSize) || 20));
  const normalizedKeyword = normalizeProjectText(keyword, 200);
  const table = sourceType === "feedback" ? "feedback" : "worktask";
  const searchFields = sourceType === "feedback" ? ["title", "content"] : ["title", "content", "assignee", "tags"];
  const fields = sourceType === "feedback"
    ? "s.id, s.type, s.title, s.status, s.updated_at"
    : "s.id, s.type, s.title, s.priority, s.status, s.assignee, s.scheduled_at, s.expected_at, s.updated_at";
  const conditions = [];
  const params = [sourceType];
  let index = 2;
  if (normalizedKeyword) {
    conditions.push(`(${searchFields.map((field) => `s.${field} LIKE ${placeholder(index++)}`).join(" OR ")})`);
    params.push(...searchFields.map(() => `%${normalizedKeyword}%`));
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const join = `LEFT JOIN project_item pi ON pi.source_type = ${placeholder(1)} AND pi.source_id = s.id`;
  const totalRow = await queryOne(`SELECT COUNT(*) AS count FROM ${table} s ${join} ${whereClause}`, params);
  const offset = (safePage - 1) * safePageSize;
  const rows = await queryAll(
    `SELECT ${fields}, pi.project_id, pi.milestone_id
     FROM ${table} s ${join} ${whereClause}
     ORDER BY s.updated_at DESC, s.id DESC
     LIMIT ${placeholder(index)} OFFSET ${placeholder(index + 1)}`,
    [...params, safePageSize, offset]
  );
  const items = rows.map((row) => {
    const item = {
      sourceType,
      sourceId: toNumber(row.id),
      title: normalizeProjectText(row.title, 255),
      type: normalizeProjectText(row.type, 64),
      status: normalizeProjectText(row.status, 32),
      updatedAt: row.updated_at || "",
      projectId: row.project_id == null ? null : toNumber(row.project_id),
      milestoneId: row.milestone_id == null ? null : toNumber(row.milestone_id)
    };
    if (sourceType === "worktask") {
      item.priority = normalizeProjectText(row.priority, 32);
      item.assignee = normalizeProjectText(row.assignee, 100);
      item.scheduledAt = row.scheduled_at || "";
      item.expectedAt = row.expected_at || "";
    }
    return item;
  });
  const total = toNumber(totalRow && totalRow.count);
  return { items, page: safePage, pageSize: safePageSize, total, totalPages: total === 0 ? 1 : Math.ceil(total / safePageSize) };
}

async function getProjectMilestoneForAssignment(projectId, milestoneId) {
  if (milestoneId === null || milestoneId === undefined || milestoneId === "") return null;
  const milestone = await getProjectMilestoneById(milestoneId);
  if (!milestone || milestone.projectId !== projectId || milestone.status !== "active") {
    throw projectError("PROJECT_MILESTONE_CONFLICT", "里程碑不存在、已撤销或不属于该项目");
  }
  return milestone;
}

async function assignProjectItem(input = {}) {
  const projectId = projectIdValue(input.projectId);
  const sourceType = String(input.sourceType || "").trim();
  const sourceId = projectIdValue(input.sourceId === undefined ? input.entityId : input.sourceId);
  if (!projectId || !PROJECT_SOURCE_TYPES.has(sourceType) || !sourceId) throw projectError("INVALID_PAYLOAD", "项目来源参数不合法");
  const project = await getProjectById(projectId);
  if (!project) throw projectError("NOT_FOUND", "项目不存在");
  if (project.status === "archived") throw projectError("PROJECT_STATE_CONFLICT", "归档项目不能新增工作项绑定");
  if (!(await projectSourceSummary(sourceType, sourceId))) throw projectError("NOT_FOUND", "来源记录不存在");
  const existing = await getProjectItemBySource({ sourceType, sourceId });
  if (existing) throw projectError("PROJECT_ITEM_CONFLICT", "该来源已归属其他项目");
  const milestone = await getProjectMilestoneForAssignment(projectId, input.milestoneId);
  const now = nowIso();
  const params = [projectId, sourceType, sourceId, milestone ? milestone.id : null, now, now];
  const marks = params.map((_, index) => placeholder(index + 1));
  const sql = client === "postgres"
    ? `INSERT INTO project_item (project_id, source_type, source_id, milestone_id, created_at, updated_at) VALUES (${marks.join(", ")}) RETURNING id`
    : `INSERT INTO project_item (project_id, source_type, source_id, milestone_id, created_at, updated_at) VALUES (${marks.join(", ")})`;
  try {
    const result = await execute(sql, params);
    return await getProjectItemBySource({ sourceType, sourceId }) || { id: result.lastInsertId, projectId, sourceType, sourceId, milestoneId: milestone ? milestone.id : null, createdAt: now, updatedAt: now };
  } catch (error) {
    const errorMessage = String(error && error.message || "").toLowerCase();
    const isUniqueViolation = errorMessage.includes("unique")
      || String(error && error.code) === "23505"
      || String(error && error.code) === "er_dup_entry"
      || Number(error && error.errno) === 1062;
    if (isUniqueViolation) {
      throw projectError("PROJECT_ITEM_CONFLICT", "该来源已归属其他项目");
    }
    throw error;
  }
}

async function updateProjectItemMilestone(input = {}) {
  const projectId = projectIdValue(input.projectId);
  const sourceType = String(input.sourceType || "").trim();
  const sourceId = projectIdValue(input.sourceId === undefined ? input.entityId : input.sourceId);
  const current = await getProjectItemBySource({ sourceType, sourceId });
  if (!current) throw projectError("NOT_FOUND", "项目关联不存在");
  if (current.projectId !== projectId) throw projectError("PROJECT_ITEM_CONFLICT", "该来源不属于当前项目");
  const milestone = await getProjectMilestoneForAssignment(projectId, input.milestoneId);
  const p1 = placeholder(1);
  const p2 = placeholder(2);
  const p3 = placeholder(3);
  await execute(`UPDATE project_item SET milestone_id = ${p1}, updated_at = ${p2} WHERE id = ${p3}`, [milestone ? milestone.id : null, nowIso(), current.id]);
  return getProjectItemBySource({ sourceType, sourceId });
}

async function unassignProjectItem(input = {}) {
  const projectId = projectIdValue(input.projectId);
  const sourceType = String(input.sourceType || "").trim();
  const sourceId = projectIdValue(input.sourceId === undefined ? input.entityId : input.sourceId);
  const current = await getProjectItemBySource({ sourceType, sourceId });
  if (!current) throw projectError("NOT_FOUND", "项目关联不存在");
  if (current.projectId !== projectId) throw projectError("PROJECT_ITEM_CONFLICT", "该来源不属于当前项目");
  const p1 = placeholder(1);
  const result = await execute(`DELETE FROM project_item WHERE id = ${p1}`, [current.id]);
  return result.changes;
}

async function touchProjectUpdatedAt(projectId) {
  const updatedAt = nowIso();
  const p1 = placeholder(1);
  const p2 = placeholder(2);
  await execute(
    `UPDATE project SET updated_at = ${p1} WHERE id = ${p2}`,
    [updatedAt, projectId]
  );
  return updatedAt;
}

async function updateProjectItemStatus({ projectId, sourceType, sourceId, status } = {}) {
  const normalizedProjectId = projectIdValue(projectId);
  const normalizedSourceId = projectIdValue(sourceId);
  if (!normalizedProjectId || !PROJECT_SOURCE_TYPES.has(sourceType) || !normalizedSourceId) {
    throw projectError("INVALID_PAYLOAD", "项目来源状态参数不合法");
  }
  const project = await getProjectById(normalizedProjectId);
  if (!project) throw projectError("NOT_FOUND", "项目不存在");
  if (project.status !== "active") throw projectError("PROJECT_STATE_CONFLICT", "归档项目不能更新工作项状态");

  const relation = await getProjectItemBySource({ sourceType, sourceId: normalizedSourceId });
  if (!relation) throw projectError("NOT_FOUND", "项目关联不存在");
  if (relation.projectId !== normalizedProjectId) {
    throw projectError("PROJECT_ITEM_CONFLICT", "该来源不属于当前项目");
  }

  const source = sourceType === "feedback"
    ? await getFeedbackById(normalizedSourceId)
    : await getWorktaskById(normalizedSourceId);
  if (!source) {
    try {
      await cleanupProjectItemsForSource({ sourceType, sourceId: normalizedSourceId });
    } catch (error) {
      logger.warn({
        event: "project.item.orphan_cleanup.error",
        sourceType,
        sourceId: normalizedSourceId,
        errorCode: error && error.code ? String(error.code).slice(0, 64) : "CLEANUP_FAILED"
      }, "project item orphan cleanup failed during status update");
    }
    throw projectError("NOT_FOUND", "来源记录不存在");
  }

  const changed = source.status !== status;
  if (changed) {
    const changes = sourceType === "feedback"
      ? await updateFeedbackStatus(normalizedSourceId, status)
      : await updateWorktaskStatus(normalizedSourceId, status);
    if (changes === 0) throw projectError("NOT_FOUND", "来源记录不存在");
  }
  const projectUpdatedAt = changed
    ? await touchProjectUpdatedAt(normalizedProjectId)
    : project.updatedAt;
  return {
    projectItemId: relation.id,
    projectId: normalizedProjectId,
    sourceType,
    sourceId: normalizedSourceId,
    status,
    projectUpdatedAt
  };
}

async function cleanupProjectItemsForSource(sourceOrType, sourceIdValue) {
  const input = sourceOrType && typeof sourceOrType === "object"
    ? sourceOrType
    : { sourceType: sourceOrType, sourceId: sourceIdValue };
  const sourceType = String(input.sourceType || "").trim();
  const sourceId = projectIdValue(input.sourceId === undefined ? input.entityId : input.sourceId);
  if (!PROJECT_SOURCE_TYPES.has(sourceType) || !sourceId) return 0;
  const p1 = placeholder(1);
  const p2 = placeholder(2);
  const result = await execute(`DELETE FROM project_item WHERE source_type = ${p1} AND source_id = ${p2}`, [sourceType, sourceId]);
  return result.changes;
}

async function listPublicProjects() {
  const rows = await queryAll(
    `SELECT id, public_key, name, description
     FROM project WHERE status = 'active' AND ${projectBoolCondition("public_basic")}
     ORDER BY updated_at DESC, id DESC LIMIT 100`,
    []
  );
  return {
    items: rows.map((row) => ({
      publicKey: normalizeProjectText(row.public_key, 64),
      name: normalizeProjectText(row.name, 120),
      description: normalizeProjectText(row.description, 2000)
    }))
  };
}

async function getPublicProjectByKey(publicKey) {
  const key = normalizeProjectText(publicKey, 64);
  if (!key) return null;
  const p1 = placeholder(1);
  const row = await queryOne(
    `SELECT id, public_key, name, description, public_milestones, public_updated_at, public_completion, completion_mode, custom_completion, created_at, updated_at
     FROM project WHERE public_key = ${p1} AND status = 'active' AND ${projectBoolCondition("public_basic")} LIMIT 1`,
    [key]
  );
  if (!row) return null;
  const projectId = toNumber(row.id);
  const stats = await getProjectMilestoneStats(projectId);
  const result = {
    publicKey: normalizeProjectText(row.public_key, 64),
    name: normalizeProjectText(row.name, 120),
    description: normalizeProjectText(row.description, 2000)
  };
  if (toBoolean(row.public_milestones)) {
    const milestoneRows = await queryAll(
      `SELECT id, project_id, title, description, target_date, is_completed, sort_order, status, created_at, updated_at
       FROM project_milestone WHERE project_id = ${p1} AND status = 'active' ORDER BY sort_order ASC, id ASC`,
      [projectId]
    );
    result.milestones = milestoneRows.map((milestone) => {
      const mapped = mapProjectMilestoneRow(milestone);
      return { title: mapped.title, description: mapped.description, targetDate: mapped.targetDate, isCompleted: mapped.isCompleted };
    });
  }
  if (toBoolean(row.public_updated_at)) result.updatedAt = row.updated_at || "";
  if (toBoolean(row.public_completion)) {
    const completionMode = PROJECT_COMPLETION_MODES.has(row.completion_mode) ? row.completion_mode : "auto";
    const custom = row.custom_completion == null ? null : toNumber(row.custom_completion);
    const completion = projectCompletion(stats.activeTotal, stats.activeCompleted, completionMode, custom);
    if (completion !== null) result.completion = { value: completion };
  }
  return result;
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
  createAiRequestMetric,
  listAiRequestMetricSummary,
  deleteExpiredAiRequestMetrics,
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
  ensureProjectSchema,
  createProject,
  getProjectById,
  listProjects,
  updateProject,
  archiveProject,
  restoreProject,
  getProjectDetail,
  createProjectMilestone,
  getProjectMilestoneById,
  updateProjectMilestone,
  revokeProjectMilestone,
  restoreProjectMilestone,
  getProjectItemBySource,
  listProjectItemCandidates,
  assignProjectItem,
  updateProjectItemMilestone,
  unassignProjectItem,
  updateProjectItemStatus,
  listPublicProjects,
  getPublicProjectByKey,
  cleanupProjectItemsForSource,
  closeDatabase
};
