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
