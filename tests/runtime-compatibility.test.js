const test = require("node:test");
const assert = require("node:assert/strict");

const packageManifest = require("../package.json");
const betterSqlite3Manifest = require("better-sqlite3/package.json");
const BetterSqlite3 = require("better-sqlite3");

test("Node 24 release baseline declares and installs better-sqlite3 13", () => {
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
  if (nodeMajor !== 24) return;

  assert.match(
    packageManifest.dependencies["better-sqlite3"],
    /^\^13\.\d+\.\d+$/,
    "Node 24 must use the tested better-sqlite3 13.x dependency range"
  );
  assert.match(
    betterSqlite3Manifest.version,
    /^13\.\d+\.\d+$/,
    "installed better-sqlite3 must match the Node 24 dependency baseline"
  );

  const database = new BetterSqlite3(":memory:");
  try {
    assert.equal(database.prepare("SELECT 1 AS value").get().value, 1);
  } finally {
    database.close();
  }
});
