const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const configPath = path.resolve(__dirname, "..", "server", "config.js");

function loadConfigWithEnv(overrides) {
  const keys = Object.keys(overrides);
  const previous = {};
  for (const key of keys) {
    previous[key] = process.env[key];
    if (overrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = String(overrides[key]);
    }
  }

  delete require.cache[configPath];
  const config = require(configPath);
  delete require.cache[configPath];

  for (const key of keys) {
    if (previous[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous[key];
    }
  }

  return config;
}

test("trustProxy defaults to 0 when TRUST_PROXY is not set", () => {
  const config = loadConfigWithEnv({
    NODE_ENV: "production",
    TRUST_PROXY: undefined
  });
  assert.equal(config.trustProxy, 0);
});

test("trustProxy follows explicit TRUST_PROXY value", () => {
  const config = loadConfigWithEnv({
    NODE_ENV: "development",
    TRUST_PROXY: "1"
  });
  assert.equal(config.trustProxy, 1);
});

test("healthExposeCounts defaults to false", () => {
  const config = loadConfigWithEnv({
    HEALTH_EXPOSE_COUNTS: undefined
  });
  assert.equal(config.healthExposeCounts, false);
});

test("healthExposeCounts parses true values", () => {
  const config = loadConfigWithEnv({
    HEALTH_EXPOSE_COUNTS: "true"
  });
  assert.equal(config.healthExposeCounts, true);
});

test("MeowStatus is disabled by default and runtime defaults pass preflight", () => {
  const config = loadConfigWithEnv({
    MEOWSTATUS_ENABLED: undefined,
    DB_CLIENT: "sqlite",
    DB_PATH: "./data/test.db"
  });
  assert.equal(config.meowStatusEnabled, false);
  assert.equal(config.validateRuntimeConfig(config).valid, true);
});

test("runtime preflight reports invalid port without exposing secrets", () => {
  const config = loadConfigWithEnv({
    PORT: "0",
    ADMIN_PASSWORD: "do-not-leak-this-secret"
  });
  const result = config.validateRuntimeConfig(config);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((message) => message.startsWith("PORT ")));
  assert.equal(result.errors.some((message) => message.includes("do-not-leak-this-secret")), false);
});

test("runtime preflight requires valid enabled provider configuration", () => {
  const config = loadConfigWithEnv({
    SMTP_ENABLED: "true",
    SMTP_HOST: "",
    SMTP_FROM: "bad-address",
    SMTP_TO: "",
    WEBHOOK_ENABLED: "true",
    WEBHOOK_URLS: ""
  });
  const result = config.validateRuntimeConfig(config);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((message) => message.includes("SMTP_HOST")));
  assert.ok(result.errors.some((message) => message.includes("SMTP_FROM")));
  assert.ok(result.errors.some((message) => message.includes("WEBHOOK_URLS")));
});

test("allowHeaderlessAdminMutation defaults to false", () => {
  const config = loadConfigWithEnv({
    ADMIN_ALLOW_HEADERLESS_MUTATION: undefined
  });
  assert.equal(config.allowHeaderlessAdminMutation, false);
});

test("allowHeaderlessAdminMutation parses true values", () => {
  const config = loadConfigWithEnv({
    ADMIN_ALLOW_HEADERLESS_MUTATION: "1"
  });
  assert.equal(config.allowHeaderlessAdminMutation, true);
});

test("log config defaults are applied", () => {
  const config = loadConfigWithEnv({
    LOG_LEVEL: undefined,
    LOG_TO_FILE: undefined,
    LOG_DIR: undefined,
    ACCESS_LOG_ENABLED: undefined,
    ACCESS_LOG_SKIP_HEALTH: undefined,
    ACCESS_LOG_SLOW_MS: undefined
  });

  assert.equal(config.logLevel, "info");
  assert.equal(config.logToFile, false);
  assert.match(config.logDir, /logs/i);
  assert.equal(config.accessLogEnabled, true);
  assert.equal(config.accessLogSkipHealth, true);
  assert.equal(config.accessLogSlowMs, 800);
});

test("log config custom values are parsed", () => {
  const config = loadConfigWithEnv({
    LOG_LEVEL: "warn",
    LOG_TO_FILE: "true",
    LOG_DIR: "./runtime-logs",
    ACCESS_LOG_ENABLED: "false",
    ACCESS_LOG_SKIP_HEALTH: "false",
    ACCESS_LOG_SLOW_MS: "1500"
  });

  assert.equal(config.logLevel, "warn");
  assert.equal(config.logToFile, true);
  assert.match(config.logDir, /runtime-logs/i);
  assert.equal(config.accessLogEnabled, false);
  assert.equal(config.accessLogSkipHealth, false);
  assert.equal(config.accessLogSlowMs, 1500);
});

test("AI Copilot is disabled by default and does not expose a valid key", () => {
  const config = loadConfigWithEnv({
    AI_COPILOT_ENABLED: undefined,
    AI_PROFILE_ENCRYPTION_KEY: undefined
  });

  assert.equal(config.ai.enabled, false);
  assert.equal(config.ai.profileEncryptionKeyValid, false);
});

test("AI Copilot recognizes a 64-character hexadecimal encryption key", () => {
  const config = loadConfigWithEnv({
    AI_COPILOT_ENABLED: "true",
    AI_PROFILE_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  });

  assert.equal(config.ai.enabled, true);
  assert.equal(config.ai.profileEncryptionKeyValid, true);
  assert.equal(config.ai.profileEncryptionKey.length, 64);
});

test("invalid AI encryption key never appears in runtime validation errors", () => {
  const secret = "not-a-provider-secret";
  const config = loadConfigWithEnv({
    AI_COPILOT_ENABLED: "true",
    AI_PROFILE_ENCRYPTION_KEY: secret,
    DB_CLIENT: "sqlite",
    DB_PATH: "./data/test.db"
  });

  const result = config.validateRuntimeConfig(config);
  assert.equal(result.errors.some((message) => message.includes(secret)), false);
});
