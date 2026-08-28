const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const configPath = path.resolve(__dirname, "..", "server", "config.js");
const dbPath = path.resolve(__dirname, "..", "server", "db.js");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kws-ai-sources-"));
const previousEnv = { DB_CLIENT: process.env.DB_CLIENT, DB_PATH: process.env.DB_PATH };
process.env.DB_CLIENT = "sqlite";
process.env.DB_PATH = path.join(tempDir, "workstation.db");
delete require.cache[configPath];
delete require.cache[dbPath];
const db = require(dbPath);

test("AI source query returns bounded metadata from both entity tables", async () => {
  try {
    await db.initializeDatabase();
    await db.createFeedback({ type: "Bug", title: "Feedback source", content: "feedback body", contact: "private@example.com", images: [] });
    await db.createWorktask({ type: "任务安排", title: "Worktask source", content: "worktask body", contact: "private@example.com", priority: "high", expectedAt: "", tags: "tag" });
    const rows = await db.listAiSourceItems(100);
    assert.equal(rows.length, 2);
    assert.deepEqual(Object.keys(rows[0]).sort(), ["content", "entityId", "entityType", "priority", "status", "title"].sort());
    assert.equal(rows.some((row) => row.entityType === "feedback" && row.title === "Feedback source"), true);
    assert.equal(rows.some((row) => row.entityType === "worktask" && row.priority === "high"), true);
  } finally {
    await db.closeDatabase();
    delete require.cache[configPath];
    delete require.cache[dbPath];
    if (previousEnv.DB_CLIENT === undefined) delete process.env.DB_CLIENT;
    else process.env.DB_CLIENT = previousEnv.DB_CLIENT;
    if (previousEnv.DB_PATH === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = previousEnv.DB_PATH;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
