const path = require("path");
const { parseRoots: parseKnowledgeRoots } = require("./knowledge-base");

const ROOT_DIR = path.resolve(__dirname, "..");
const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PRODUCTION = NODE_ENV === "production";

function parseIntOrDefault(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolOrDefault(value, fallback) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function stringOrDefault(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function csvOrEmptyList(value) {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseKnowledgeBaseConfig(value) {
  const parsed = parseKnowledgeRoots(value);
  return {
    roots: parsed.roots,
    warnings: parsed.warnings,
    parseError: parsed.error || ""
  };
}

function isExplicitIntegerInvalid(rawValue, minimum, maximum) {
  if (rawValue === undefined || rawValue === null || rawValue === "") return false;
  const text = String(rawValue).trim();
  if (!/^\d+$/.test(text)) return true;
  const parsed = Number(text);
  return !Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum;
}

function isExplicitBooleanInvalid(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === "") return false;
  if (typeof rawValue === "boolean") return false;
  return !["1", "true", "yes", "on", "0", "false", "no", "off"]
    .includes(String(rawValue).trim().toLowerCase());
}

function validateHttpUrl(value, key, errors) {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${key} 必须配置为 http/https 地址`);
    return null;
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch (_) {
    errors.push(`${key} 必须配置为有效的 http/https 地址`);
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
    errors.push(`${key} 必须使用 http 或 https 协议`);
    return null;
  }
  if (parsed.username || parsed.password) {
    errors.push(`${key} 不得包含账号或密码`);
  }
  return parsed;
}

function validateRuntimeConfig(candidate = config) {
  const errors = [];
  const raw = candidate.rawInput || {};
  const supportedClients = new Set(["sqlite", "mysql", "postgres"]);
  const dbClient = String(candidate.dbClient || "").toLowerCase();

  if (!supportedClients.has(dbClient)) {
    errors.push("DB_CLIENT 必须是 sqlite、mysql 或 postgres");
  }
  if (dbClient === "sqlite") {
    if (typeof candidate.dbPath !== "string" || !candidate.dbPath.trim()) {
      errors.push("DB_PATH 必须是非空路径");
    }
  } else {
    if (typeof candidate.databaseUrl !== "string" || !candidate.databaseUrl.trim()) {
      errors.push("DATABASE_URL 在非 sqlite 数据库模式下必填");
    } else {
      try {
        const databaseUrl = new URL(candidate.databaseUrl);
        const expectedProtocols = dbClient === "mysql"
          ? ["mysql:", "mysql2:"]
          : ["postgres:", "postgresql:"];
        if (!expectedProtocols.includes(databaseUrl.protocol) || !databaseUrl.hostname || !databaseUrl.pathname.slice(1)) {
          errors.push(`DATABASE_URL 必须是有效的 ${dbClient} 连接串`);
        }
      } catch (_) {
        errors.push("DATABASE_URL 必须是有效的数据库连接串");
      }
    }
  }

  if (isExplicitIntegerInvalid(raw.port, 1, 65535) || !Number.isInteger(candidate.port) || candidate.port < 1 || candidate.port > 65535) {
    errors.push("PORT 必须是 1-65535 的整数");
  }
  if (isExplicitIntegerInvalid(raw.trustProxy, 0, 32) || !Number.isInteger(candidate.trustProxy) || candidate.trustProxy < 0 || candidate.trustProxy > 32) {
    errors.push("TRUST_PROXY 必须是 0-32 的非负整数");
  }
  if (typeof candidate.listenHost !== "string" || !candidate.listenHost.trim()) {
    errors.push("LISTEN_HOST 必须是非空主机名或地址");
  }
  validateHttpUrl(candidate.appBaseUrl, "APP_BASE_URL", errors);

  const positiveIntegerChecks = [
    ["SESSION_TTL_HOURS", candidate.sessionTtlHours, raw.sessionTtlHours, 1, 24 * 365 * 10],
    ["BCRYPT_ROUNDS", candidate.bcryptRounds, raw.bcryptRounds, 4, 31],
    ["RATE_LIMIT_SUBMIT_WINDOW_MS", candidate.rateLimit && candidate.rateLimit.submitWindowMs, raw.rateLimitSubmitWindowMs, 1000, 7 * 24 * 60 * 60 * 1000],
    ["RATE_LIMIT_SUBMIT_MAX", candidate.rateLimit && candidate.rateLimit.submitMax, raw.rateLimitSubmitMax, 1, 100000],
    ["RATE_LIMIT_LOGIN_WINDOW_MS", candidate.rateLimit && candidate.rateLimit.loginWindowMs, raw.rateLimitLoginWindowMs, 1000, 7 * 24 * 60 * 60 * 1000],
    ["RATE_LIMIT_LOGIN_MAX", candidate.rateLimit && candidate.rateLimit.loginMax, raw.rateLimitLoginMax, 1, 100000],
    ["RATE_LIMIT_ADMIN_WINDOW_MS", candidate.rateLimit && candidate.rateLimit.adminWindowMs, raw.rateLimitAdminWindowMs, 1000, 7 * 24 * 60 * 60 * 1000],
    ["RATE_LIMIT_ADMIN_MAX", candidate.rateLimit && candidate.rateLimit.adminMax, raw.rateLimitAdminMax, 1, 100000],
    ["MEOWSTATUS_TIMEOUT_MS", candidate.meowStatusTimeoutMs, raw.meowStatusTimeoutMs, 1000, 15000],
    ["MEOWSTATUS_REFRESH_MS", candidate.meowStatusRefreshMs, raw.meowStatusRefreshMs, 5000, 24 * 60 * 60 * 1000],
    ["BACKUP_RETENTION_DAYS", candidate.backupRetentionDays, raw.backupRetentionDays, 1, 3650],
    ["ADMIN_EXPORT_MAX_ROWS", candidate.adminExportMaxRows, raw.adminExportMaxRows, 100, 100000],
    ["AI_KNOWLEDGE_HISTORY_RETENTION_DAYS", candidate.aiKnowledge && candidate.aiKnowledge.historyRetentionDays, raw.aiKnowledgeHistoryRetentionDays, 1, 3650]
  ];
  for (const [key, value, rawValue, min, max] of positiveIntegerChecks) {
    if (isExplicitIntegerInvalid(rawValue, min, max) || !Number.isInteger(value) || value < min || value > max) {
      errors.push(`${key} 必须是 ${min}-${max} 的整数`);
    }
  }

  const booleanChecks = [
    ["HEALTH_EXPOSE_COUNTS", candidate.healthExposeCounts, raw.healthExposeCounts],
    ["ADMIN_ALLOW_HEADERLESS_MUTATION", candidate.allowHeaderlessAdminMutation, raw.allowHeaderlessAdminMutation],
    ["MEOWSTATUS_ENABLED", candidate.meowStatusEnabled, raw.meowStatusEnabled],
    ["SMTP_ENABLED", candidate.smtp && candidate.smtp.enabled, raw.smtpEnabled],
    ["SMTP_SECURE", candidate.smtp && candidate.smtp.secure, raw.smtpSecure],
    ["SMTP_REQUIRE_TLS", candidate.smtp && candidate.smtp.requireTls, raw.smtpRequireTls],
    ["WEBHOOK_ENABLED", candidate.webhook && candidate.webhook.enabled, raw.webhookEnabled]
  ];
  for (const [key, value, rawValue] of booleanChecks) {
    if (isExplicitBooleanInvalid(rawValue) || typeof value !== "boolean") {
      errors.push(`${key} 必须是 true/false 或 1/0`);
    }
  }

  if (candidate.meowStatusEnabled) {
    validateHttpUrl(candidate.meowStatusBaseUrl, "MEOWSTATUS_BASE_URL", errors);
  }
  if (candidate.smtp && candidate.smtp.enabled) {
    if (!candidate.smtp.host) errors.push("SMTP_HOST 在 SMTP_ENABLED=true 时必填");
    if (isExplicitIntegerInvalid(raw.smtpPort, 1, 65535) || !Number.isInteger(candidate.smtp.port) || candidate.smtp.port < 1 || candidate.smtp.port > 65535) {
      errors.push("SMTP_PORT 必须是 1-65535 的整数");
    }
    if (!candidate.smtp.from || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate.smtp.from)) {
      errors.push("SMTP_FROM 在 SMTP_ENABLED=true 时必须是有效邮箱");
    }
    if (!Array.isArray(candidate.smtp.to) || candidate.smtp.to.length === 0 || candidate.smtp.to.some((item) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item))) {
      errors.push("SMTP_TO 在 SMTP_ENABLED=true 时至少需要一个有效邮箱");
    }
  }
  if (candidate.webhook && candidate.webhook.enabled) {
    const providers = new Set(["generic", "wecom", "feishu", "lark", "dingtalk", "slack"]);
    if (!providers.has(candidate.webhook.provider)) {
      errors.push("WEBHOOK_PROVIDER 不是受支持的 provider");
    }
    if (!Array.isArray(candidate.webhook.urls) || candidate.webhook.urls.length === 0) {
      errors.push("WEBHOOK_URLS 在 WEBHOOK_ENABLED=true 时至少需要一个地址");
    } else {
      for (const url of candidate.webhook.urls) {
        validateHttpUrl(url, "WEBHOOK_URLS", errors);
      }
    }
    if (isExplicitIntegerInvalid(raw.webhookTimeoutMs, 1000, 15000) || !Number.isInteger(candidate.webhook.timeoutMs) || candidate.webhook.timeoutMs < 1000 || candidate.webhook.timeoutMs > 15000) {
      errors.push("WEBHOOK_TIMEOUT_MS 必须是 1000-15000 的整数");
    }
  }

  return { valid: errors.length === 0, errors };
}

const rawInput = {
  port: process.env.PORT,
  trustProxy: process.env.TRUST_PROXY,
  sessionTtlHours: process.env.SESSION_TTL_HOURS,
  bcryptRounds: process.env.BCRYPT_ROUNDS,
  rateLimitSubmitWindowMs: process.env.RATE_LIMIT_SUBMIT_WINDOW_MS,
  rateLimitSubmitMax: process.env.RATE_LIMIT_SUBMIT_MAX,
  rateLimitLoginWindowMs: process.env.RATE_LIMIT_LOGIN_WINDOW_MS,
  rateLimitLoginMax: process.env.RATE_LIMIT_LOGIN_MAX,
  rateLimitAdminWindowMs: process.env.RATE_LIMIT_ADMIN_WINDOW_MS,
  rateLimitAdminMax: process.env.RATE_LIMIT_ADMIN_MAX,
  meowStatusTimeoutMs: process.env.MEOWSTATUS_TIMEOUT_MS,
  meowStatusRefreshMs: process.env.MEOWSTATUS_REFRESH_MS,
  backupRetentionDays: process.env.BACKUP_RETENTION_DAYS,
  smtpPort: process.env.SMTP_PORT,
  webhookTimeoutMs: process.env.WEBHOOK_TIMEOUT_MS,
  adminExportMaxRows: process.env.ADMIN_EXPORT_MAX_ROWS,
  healthExposeCounts: process.env.HEALTH_EXPOSE_COUNTS,
  allowHeaderlessAdminMutation: process.env.ADMIN_ALLOW_HEADERLESS_MUTATION,
  meowStatusEnabled: process.env.MEOWSTATUS_ENABLED,
  smtpEnabled: process.env.SMTP_ENABLED,
  smtpSecure: process.env.SMTP_SECURE,
  smtpRequireTls: process.env.SMTP_REQUIRE_TLS,
  webhookEnabled: process.env.WEBHOOK_ENABLED,
  aiKnowledgeBaseDirs: process.env.AI_KNOWLEDGE_BASE_DIRS,
  aiKnowledgeHistoryRetentionDays: process.env.AI_KNOWLEDGE_HISTORY_RETENTION_DAYS
};

const knowledgeBaseConfig = parseKnowledgeBaseConfig(process.env.AI_KNOWLEDGE_BASE_DIRS);

const config = {
  rawInput,
  rootDir: ROOT_DIR,
  nodeEnv: NODE_ENV,
  isProduction: IS_PRODUCTION,
  dbClient: stringOrDefault(process.env.DB_CLIENT, "sqlite").toLowerCase(),
  databaseUrl: stringOrDefault(process.env.DATABASE_URL, ""),
  listenHost: stringOrDefault(process.env.LISTEN_HOST, "127.0.0.1"),
  port: parseIntOrDefault(process.env.PORT, 3000),
  trustProxy: parseIntOrDefault(process.env.TRUST_PROXY, 0),
  appBaseUrl: stringOrDefault(process.env.APP_BASE_URL, "http://127.0.0.1:3000"),
  healthExposeCounts: parseBoolOrDefault(process.env.HEALTH_EXPOSE_COUNTS, false),
  allowHeaderlessAdminMutation: parseBoolOrDefault(process.env.ADMIN_ALLOW_HEADERLESS_MUTATION, false),
  logLevel: stringOrDefault(process.env.LOG_LEVEL, "info").toLowerCase(),
  logToFile: parseBoolOrDefault(process.env.LOG_TO_FILE, false),
  logDir: path.resolve(ROOT_DIR, process.env.LOG_DIR || "./logs"),
  accessLogEnabled: parseBoolOrDefault(process.env.ACCESS_LOG_ENABLED, true),
  accessLogSkipHealth: parseBoolOrDefault(process.env.ACCESS_LOG_SKIP_HEALTH, true),
  accessLogSlowMs: parseIntOrDefault(process.env.ACCESS_LOG_SLOW_MS, 800),
  ai: {
    enabled: parseBoolOrDefault(process.env.AI_COPILOT_ENABLED, false),
    profileEncryptionKey: process.env.AI_PROFILE_ENCRYPTION_KEY || "",
    profileEncryptionKeyValid: /^[a-f0-9]{64}$/iu.test(process.env.AI_PROFILE_ENCRYPTION_KEY || "")
  },
  aiKnowledge: {
    roots: knowledgeBaseConfig.roots,
    warnings: knowledgeBaseConfig.warnings,
    parseError: knowledgeBaseConfig.parseError,
    cachePath: path.join(ROOT_DIR, "data", "ai-knowledge-index.json"),
    historyRetentionDays: parseIntOrDefault(process.env.AI_KNOWLEDGE_HISTORY_RETENTION_DAYS, 30)
  },
  dbPath: path.resolve(ROOT_DIR, process.env.DB_PATH || "./data/workstation.db"),
  cookieName: process.env.SESSION_COOKIE_NAME || "kws_sid",
  sessionTtlHours: parseIntOrDefault(process.env.SESSION_TTL_HOURS, 168),
  bcryptRounds: parseIntOrDefault(process.env.BCRYPT_ROUNDS, 12),
  adminBootstrapUsername: process.env.ADMIN_USERNAME || "",
  adminBootstrapPassword: process.env.ADMIN_PASSWORD || "",
  rateLimit: {
    submitWindowMs: parseIntOrDefault(process.env.RATE_LIMIT_SUBMIT_WINDOW_MS, 10 * 60 * 1000),
    submitMax: parseIntOrDefault(process.env.RATE_LIMIT_SUBMIT_MAX, 20),
    loginWindowMs: parseIntOrDefault(process.env.RATE_LIMIT_LOGIN_WINDOW_MS, 15 * 60 * 1000),
    loginMax: parseIntOrDefault(process.env.RATE_LIMIT_LOGIN_MAX, 10),
    adminWindowMs: parseIntOrDefault(process.env.RATE_LIMIT_ADMIN_WINDOW_MS, 60 * 1000),
    adminMax: parseIntOrDefault(process.env.RATE_LIMIT_ADMIN_MAX, 120)
  },
  displayTimezone: stringOrDefault(process.env.DISPLAY_TIMEZONE, "Asia/Shanghai"),
  displayLocale: stringOrDefault(process.env.DISPLAY_LOCALE, "zh-CN"),
  meowStatusBaseUrl: stringOrDefault(process.env.MEOWSTATUS_BASE_URL, "http://127.0.0.1:8080"),
  meowStatusEnabled: parseBoolOrDefault(process.env.MEOWSTATUS_ENABLED, false),
  meowStatusTimeoutMs: parseIntOrDefault(process.env.MEOWSTATUS_TIMEOUT_MS, 5000),
  meowStatusRefreshMs: parseIntOrDefault(process.env.MEOWSTATUS_REFRESH_MS, 10000),
  backupDir: path.resolve(ROOT_DIR, process.env.BACKUP_DIR || "./backups"),
  backupRetentionDays: parseIntOrDefault(process.env.BACKUP_RETENTION_DAYS, 30),
  adminExportMaxRows: parseIntOrDefault(process.env.ADMIN_EXPORT_MAX_ROWS, 10000),
  smtp: {
    enabled: parseBoolOrDefault(process.env.SMTP_ENABLED, false),
    host: stringOrDefault(process.env.SMTP_HOST, ""),
    port: parseIntOrDefault(process.env.SMTP_PORT, 587),
    secure: parseBoolOrDefault(process.env.SMTP_SECURE, false),
    requireTls: parseBoolOrDefault(process.env.SMTP_REQUIRE_TLS, true),
    user: stringOrDefault(process.env.SMTP_USER, ""),
    pass: process.env.SMTP_PASS || "",
    from: stringOrDefault(process.env.SMTP_FROM, ""),
    to: csvOrEmptyList(process.env.SMTP_TO || ""),
    subjectPrefix: stringOrDefault(process.env.SMTP_SUBJECT_PREFIX, "[KyanetWorkStation]")
  },
  webhook: {
    enabled: parseBoolOrDefault(process.env.WEBHOOK_ENABLED, false),
    provider: stringOrDefault(process.env.WEBHOOK_PROVIDER, "generic").toLowerCase(),
    urls: csvOrEmptyList(process.env.WEBHOOK_URLS || ""),
    secret: process.env.WEBHOOK_SECRET || "",
    keywords: csvOrEmptyList(process.env.WEBHOOK_KEYWORDS || ""),
    timeoutMs: parseIntOrDefault(process.env.WEBHOOK_TIMEOUT_MS, 5000),
    titlePrefix: stringOrDefault(process.env.WEBHOOK_TITLE_PREFIX, "[KyanetWorkStation]")
  }
};

module.exports = config;
module.exports.validateRuntimeConfig = validateRuntimeConfig;


