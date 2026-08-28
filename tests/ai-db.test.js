const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const configPath = path.resolve(__dirname, "..", "server", "config.js");
const dbPath = path.resolve(__dirname, "..", "server", "db.js");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kws-ai-db-"));
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

test("AI profiles and suggestions persist with expiry filtering and decision audit", async () => {
  const now = "2026-08-28T00:00:00.000Z";
  try {
    await db.initializeDatabase();
    const profiles = {
      version: 1,
      activeProfileId: "profile-1",
      profiles: [{
        id: "profile-1",
        name: "OpenAI",
        protocol: "openai-chat",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        keyEnvelope: {
          version: 1,
          algorithm: "aes-256-gcm",
          keyId: "kws-ai-v1",
          iv: "AA==",
          ciphertext: "AA==",
          authTag: "AA=="
        }
      }]
    };
    await db.setAiProviderProfiles(profiles);
    assert.deepEqual(await db.getAiProviderProfiles(), profiles);

    const entityId = await db.createFeedback({
      type: "Bug",
      title: "AI suggestion source",
      content: "source content",
      contact: "private@example.com",
      images: []
    });
    const activeId = await db.createAiSuggestion({
      entityType: "feedback",
      entityId,
      profileId: "profile-1",
      protocol: "openai-chat",
      model: "gpt-4o-mini",
      result: { summary: "summary", category: "Bug" },
      acceptedFields: [],
      createdAt: now,
      expiresAt: "2026-09-04T00:00:00.000Z"
    });
    await db.createAiSuggestion({
      entityType: "feedback",
      entityId,
      profileId: "profile-1",
      protocol: "openai-chat",
      model: "gpt-4o-mini",
      result: { summary: "expired" },
      createdAt: "2026-08-20T00:00:00.000Z",
      expiresAt: "2026-08-27T00:00:00.000Z"
    });

    const listed = await db.listAiSuggestions({ entityType: "feedback", entityId, now });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, activeId);
    assert.equal(listed[0].resultJson.summary, "summary");
    assert.equal(await db.getAiSuggestionById(activeId).then((row) => row.status), "available");

    assert.equal(await db.recordAiSuggestionDecision(activeId, "accepted", ["replyDraft", "unknown"], "admin"), 1);
    const decided = await db.getAiSuggestionById(activeId);
    assert.equal(decided.status, "accepted");
    assert.deepEqual(decided.acceptedFields, ["replyDraft"]);
    assert.equal(decided.decidedBy, "admin");
    assert.equal((await db.getFeedbackById(entityId)).status, "new");
    assert.equal((await db.getFeedbackById(entityId)).publicReply, "");

    assert.equal(await db.deleteExpiredAiSuggestions(now), 1);
    assert.equal(await db.getAiSuggestionById(activeId).then((row) => row.status), "accepted");
    assert.equal((await db.listAiSuggestions({ entityType: "feedback", entityId, now })).length, 1);
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
