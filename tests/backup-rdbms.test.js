const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const scriptPath = path.resolve(__dirname, "..", "scripts", "backup-db-rdbms.js");

function runScript(envOverrides) {
  const env = { ...process.env, ...envOverrides };
  return spawnSync(process.execPath, [scriptPath], {
    env,
    encoding: "utf8",
    windowsHide: true
  });
}

test("backup-db-rdbms rejects unsupported db client", () => {
  const result = runScript({
    DB_CLIENT: "sqlite",
    DATABASE_URL: ""
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /only supports mysql\/postgres/i);
});

test("backup-db-rdbms requires DATABASE_URL", () => {
  const result = runScript({
    DB_CLIENT: "mysql",
    DATABASE_URL: ""
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /DATABASE_URL is required/i);
});
