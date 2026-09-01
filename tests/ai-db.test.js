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

    const answerId = await db.createAiKnowledgeAnswer({
      question: "如何登录？",
      answer: "请使用管理员账号登录。",
      basis: "document",
      caveats: "请核验当前部署配置。",
      sources: [{ sourceId: "s1" }],
      rootId: "guide",
      profileId: "profile-1",
      protocol: "openai-chat",
      model: "gpt-4o-mini",
      usage: { inputTokens: 12, outputTokens: 8, ignored: "drop" },
      promptVersion: "knowledge-v1",
      createdAt: now,
      expiresAt: "2026-09-27T00:00:00.000Z"
    });
    assert.ok(Number.isSafeInteger(answerId));
    const answer = await db.getAiKnowledgeAnswerById(answerId);
    assert.equal(answer.question, "如何登录？");
    assert.deepEqual(answer.sources, [{ sourceId: "s1" }]);
    assert.deepEqual(answer.usage, { inputTokens: 12, outputTokens: 8 });
    assert.equal(answer.promptVersion, "knowledge-v1");

    await db.createAiKnowledgeAnswer({
      question: "过期问题",
      answer: "旧回答",
      basis: "general",
      sources: [],
      createdAt: "2026-07-01T00:00:00.000Z",
      expiresAt: "2026-08-01T00:00:00.000Z"
    });
    const history = await db.listAiKnowledgeAnswers({
      page: 1,
      pageSize: 20,
      keyword: "登录",
      rootId: "guide"
    });
    assert.equal(history.total, 1);
    assert.equal(history.items[0].id, answerId);
    assert.equal(history.items[0].expired, false);

    const deleted = await db.deleteAiKnowledgeAnswer(answerId);
    assert.equal(deleted, 1);
    assert.equal(await db.getAiKnowledgeAnswerById(answerId), null);
    assert.equal(await db.deleteExpiredAiKnowledgeAnswers("2026-08-28T00:00:00.000Z"), 1);

    const settings = await db.getAiKnowledgeSettings();
    assert.equal(settings.autoCleanup, true);
    assert.equal(typeof settings.updatedAt, "string");
    const savedSettings = await db.setAiKnowledgeSettings({ autoCleanup: false, ignored: "drop" });
    assert.deepEqual(savedSettings, { autoCleanup: false, updatedAt: savedSettings.updatedAt });
    assert.equal((await db.getAiKnowledgeSettings()).autoCleanup, false);
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

test("knowledge answer schema is declared for every supported database", () => {
  for (const factoryName of ["sqliteSchemaStatements", "mysqlSchemaStatements", "postgresSchemaStatements"]) {
    assert.equal(typeof db[factoryName], "function", `${factoryName} should be exported for schema checks`);
    const statements = db[factoryName]();
    assert.ok(statements.some((statement) => statement.includes("ai_knowledge_answer")));
    assert.ok(statements.some((statement) => statement.includes("idx_ai_knowledge_answer_created_at")));
    assert.ok(statements.some((statement) => statement.includes("idx_ai_knowledge_answer_expires_at")));
  }
});
