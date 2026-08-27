const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const configPath = path.resolve(__dirname, "..", "server", "config.js");
const dbPath = path.resolve(__dirname, "..", "server", "db.js");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kws-notification-outbox-"));
const dbFile = path.join(tempDir, "workstation.db");
const previousEnv = {
  DB_CLIENT: process.env.DB_CLIENT,
  DB_PATH: process.env.DB_PATH
};
process.env.DB_CLIENT = "sqlite";
process.env.DB_PATH = dbFile;
delete require.cache[configPath];
delete require.cache[dbPath];
const db = require(dbPath);

test("notification outbox persists, retries, and marks delivery state", async () => {
  try {
    await db.initializeDatabase();
    const entityId = await db.createFeedback({
      type: "Bug",
      title: "outbox test",
      content: "outbox content",
      contact: "test@example.com",
      images: []
    });
    const ids = await db.enqueueNotificationDeliveries({
      entityType: "feedback",
      entityId,
      providers: ["smtp", "webhook"]
    });
    assert.equal(ids.length, 2);
    const pending = await db.listNotificationDeliveries({ status: "pending" });
    assert.equal(pending.length, 2);
    assert.deepEqual(new Set(pending.map((item) => item.provider)), new Set(["smtp", "webhook"]));
    const smtpDelivery = pending.find((item) => item.provider === "smtp");
    assert.equal(smtpDelivery.target, "configured-recipients");

    const failed = await db.recordNotificationDeliveryFailure(
      smtpDelivery.id,
      "provider unavailable",
      new Date(Date.now() - 1000).toISOString(),
      3
    );
    assert.equal(failed.status, "retrying");
    assert.equal(failed.attempts, 1);
    const retryChanges = await db.retryNotificationDelivery(smtpDelivery.id);
    assert.equal(retryChanges, 1);
    const webhookDelivery = pending.find((item) => item.provider === "webhook");
    const partialFailure = await db.recordNotificationDeliveryFailure(
      webhookDelivery.id,
      "Webhook 投递部分失败（成功 1，失败 1）",
      new Date(Date.now() - 1000).toISOString(),
      3,
      "webhook-endpoints:1"
    );
    assert.equal(partialFailure.status, "retrying");
    assert.equal((await db.getNotificationDeliveryById(webhookDelivery.id)).target, "webhook-endpoints:1");
    const due = await db.listDueNotificationDeliveries(10);
    assert.equal(due.length, 2);

    assert.equal(await db.markNotificationDeliveryDelivered(smtpDelivery.id), 1);
    const delivered = await db.getNotificationDeliveryById(smtpDelivery.id);
    assert.equal(delivered.status, "delivered");
    assert.equal(delivered.lastError, "");
    assert.equal(await db.retryNotificationDelivery(smtpDelivery.id), 0);
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
