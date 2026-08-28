const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createNotificationHandoff,
  listNotificationHandoffs,
  retryNotificationHandoff,
  getNotificationHandoffPath
} = require("../server/notification-handoff");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kws-notification-handoff-"));
}

test("notification handoff journal persists a bounded redacted record", async () => {
  const tempDir = makeTempDir();
  const dbPath = path.join(tempDir, "workstation.db");
  try {
    const result = await createNotificationHandoff({
      dbPath,
      entityType: "feedback",
      entityId: 42,
      providers: ["smtp", "webhook", "unknown"],
      error: "POST https://user:password@example.test/hook?token=secret failed for recipient private@example.com; body=private-content"
    });
    assert.equal(result.persisted, true);
    assert.match(result.handoffId, /^[0-9a-f-]{36}$/i);
    assert.equal(getNotificationHandoffPath(dbPath), path.join(tempDir, "notification-handoff.jsonl"));

    const records = await listNotificationHandoffs({ dbPath });
    assert.equal(records.length, 1);
    assert.deepEqual(records[0].providers, ["smtp", "webhook"]);
    assert.equal(records[0].entityType, "feedback");
    assert.equal(records[0].entityId, 42);
    assert.equal(records[0].status, "pending");
    assert.equal(records[0].attempts, 0);
    assert.ok(records[0].lastError.length <= 240);

    const journal = fs.readFileSync(getNotificationHandoffPath(dbPath), "utf8");
    assert.doesNotMatch(journal, /password|token=secret|private@example\.com|private-content|https:\/\//iu);
    assert.doesNotMatch(journal, /contact|recipient|body/iu);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("notification handoff folds states, retries idempotently, and blocks resolved replay", async () => {
  const tempDir = makeTempDir();
  const dbPath = path.join(tempDir, "workstation.db");
  try {
    const created = await createNotificationHandoff({
      dbPath,
      entityType: "worktask",
      entityId: 7,
      providers: ["webhook"],
      error: "database unavailable"
    });
    let enqueueCalls = 0;
    const resolved = await retryNotificationHandoff({
      dbPath,
      handoffId: created.handoffId,
      enqueue: async (payload) => {
        enqueueCalls += 1;
        assert.deepEqual(payload, { entityType: "worktask", entityId: 7, providers: ["webhook"] });
        return [99];
      }
    });
    assert.equal(resolved.status, "resolved");
    assert.equal(enqueueCalls, 1);
    assert.equal((await listNotificationHandoffs({ dbPath }))[0].status, "resolved");

    const replay = await retryNotificationHandoff({
      dbPath,
      handoffId: created.handoffId,
      enqueue: async () => {
        enqueueCalls += 1;
        return [];
      }
    });
    assert.equal(replay.status, "resolved");
    assert.equal(enqueueCalls, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("notification handoff records retrying then failed state when enqueue remains unavailable", async () => {
  const tempDir = makeTempDir();
  const dbPath = path.join(tempDir, "workstation.db");
  try {
    const created = await createNotificationHandoff({
      dbPath,
      entityType: "feedback",
      entityId: 8,
      providers: ["smtp"],
      error: "initial failure"
    });
    const enqueue = async () => {
      throw new Error("smtp://user:pass@example.test rejected password=top-secret");
    };
    const first = await retryNotificationHandoff({ dbPath, handoffId: created.handoffId, enqueue });
    assert.equal(first.status, "retrying");
    assert.equal(first.attempts, 1);
    const second = await retryNotificationHandoff({ dbPath, handoffId: created.handoffId, enqueue });
    assert.equal(second.status, "retrying");
    assert.equal(second.attempts, 2);
    const third = await retryNotificationHandoff({ dbPath, handoffId: created.handoffId, enqueue });
    assert.equal(third.status, "failed");
    assert.equal(third.attempts, 3);
    const record = (await listNotificationHandoffs({ dbPath }))[0];
    assert.equal(record.status, "failed");
    assert.equal(record.attempts, 3);
    assert.doesNotMatch(record.lastError, /top-secret|smtp:\/\//iu);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("notification handoff ignores malformed journal lines and bounds the result", async () => {
  const tempDir = makeTempDir();
  const dbPath = path.join(tempDir, "workstation.db");
  try {
    const created = await createNotificationHandoff({
      dbPath,
      entityType: "feedback",
      entityId: 9,
      providers: ["webhook"],
      error: "ok"
    });
    fs.appendFileSync(getNotificationHandoffPath(dbPath), "not-json\n{}\n");
    const records = await listNotificationHandoffs({ dbPath, limit: 1 });
    assert.equal(records.length, 1);
    assert.equal(records[0].handoffId, created.handoffId);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("notification handoff collapses duplicate event records to the newest state", async () => {
  const tempDir = makeTempDir();
  const dbPath = path.join(tempDir, "workstation.db");
  try {
    const first = await createNotificationHandoff({
      dbPath,
      entityType: "feedback",
      entityId: 10,
      providers: ["smtp"],
      error: "first"
    });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = await createNotificationHandoff({
      dbPath,
      entityType: "feedback",
      entityId: 10,
      providers: ["smtp"],
      error: "second"
    });
    const records = await listNotificationHandoffs({ dbPath });
    assert.equal(records.length, 1);
    assert.equal(records[0].handoffId, second.handoffId);
    assert.notEqual(records[0].handoffId, first.handoffId);
    assert.equal(records[0].lastError, "second");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("notification handoff reports an unwritable journal without throwing", async () => {
  const tempDir = makeTempDir();
  const blockedParent = path.join(tempDir, "blocked");
  fs.writeFileSync(blockedParent, "not-a-directory");
  try {
    const result = await createNotificationHandoff({
      dbPath: path.join(blockedParent, "workstation.db"),
      entityType: "feedback",
      entityId: 11,
      providers: ["webhook"],
      error: "journal unavailable"
    });
    assert.equal(result.persisted, false);
    assert.ok(result.error);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
