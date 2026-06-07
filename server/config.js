const path = require("path");

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

const config = {
  rootDir: ROOT_DIR,
  nodeEnv: NODE_ENV,
  isProduction: IS_PRODUCTION,
  dbClient: stringOrDefault(process.env.DB_CLIENT, "sqlite").toLowerCase(),
  databaseUrl: stringOrDefault(process.env.DATABASE_URL, ""),
  listenHost: stringOrDefault(process.env.LISTEN_HOST, "127.0.0.1"),
  port: parseIntOrDefault(process.env.PORT, 3000),
  trustProxy: parseIntOrDefault(process.env.TRUST_PROXY, 0),
  appBaseUrl: process.env.APP_BASE_URL || "http://127.0.0.1:3000",
  healthExposeCounts: parseBoolOrDefault(process.env.HEALTH_EXPOSE_COUNTS, false),
  allowHeaderlessAdminMutation: parseBoolOrDefault(process.env.ADMIN_ALLOW_HEADERLESS_MUTATION, false),
  logLevel: stringOrDefault(process.env.LOG_LEVEL, "info").toLowerCase(),
  logToFile: parseBoolOrDefault(process.env.LOG_TO_FILE, false),
  logDir: path.resolve(ROOT_DIR, process.env.LOG_DIR || "./logs"),
  accessLogEnabled: parseBoolOrDefault(process.env.ACCESS_LOG_ENABLED, true),
  accessLogSkipHealth: parseBoolOrDefault(process.env.ACCESS_LOG_SKIP_HEALTH, true),
  accessLogSlowMs: parseIntOrDefault(process.env.ACCESS_LOG_SLOW_MS, 800),
  dbPath: path.resolve(ROOT_DIR, process.env.DB_PATH || "./data/workstation.db"),
  cookieName: process.env.SESSION_COOKIE_NAME || "kws_sid",
  sessionTtlHours: parseIntOrDefault(process.env.SESSION_TTL_HOURS, 168),
  account: {
    baseUrl: stringOrDefault(process.env.KYANET_ACCOUNT_BASE_URL, "http://127.0.0.1:4000"),
    publicUrl: stringOrDefault(process.env.KYANET_ACCOUNT_PUBLIC_URL, "http://localhost:5173"),
    integrationSecret: process.env.KYANET_ACCOUNT_INTEGRATION_SECRET || "",
    policyCacheMs: parseIntOrDefault(process.env.KYANET_ACCOUNT_POLICY_CACHE_MS, 60000),
    requestTimeoutMs: parseIntOrDefault(process.env.KYANET_ACCOUNT_REQUEST_TIMEOUT_MS, 5000),
    cookieName: stringOrDefault(process.env.KYANET_ACCOUNT_COOKIE_NAME, "kws_account_sid"),
    sessionTtlHours: parseIntOrDefault(process.env.KYANET_ACCOUNT_SESSION_TTL_HOURS, 168)
  },
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
  meowStatusTimeoutMs: parseIntOrDefault(process.env.MEOWSTATUS_TIMEOUT_MS, 5000),
  meowStatusRefreshMs: parseIntOrDefault(process.env.MEOWSTATUS_REFRESH_MS, 10000),
  backupDir: path.resolve(ROOT_DIR, process.env.BACKUP_DIR || "./backups"),
  backupRetentionDays: parseIntOrDefault(process.env.BACKUP_RETENTION_DAYS, 30),
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


