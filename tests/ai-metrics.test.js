const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeMetric,
  recordAiRequestMetricSafely,
  summarizeAiRequestMetrics,
  cleanupExpiredMetrics,
  statusForError
} = require("../server/ai-metrics");

test("AI metric normalization keeps unknown usage null and rejects unbounded fields", () => {
  const metric = normalizeMetric({
    operation: "copilot_suggest",
    profileId: "profile-1",
    protocol: "openai-chat",
    model: "gpt-5.6",
    status: "success",
    durationMs: 42,
    usage: { inputTokens: null, outputTokens: "" },
    usagePresent: true,
    errorCode: "",
    createdAt: "2026-09-01T00:00:00.000Z",
    prompt: "must not be retained",
    baseUrl: "https://secret.example"
  });

  assert.deepEqual(metric, {
    operation: "copilot_suggest",
    profileId: "profile-1",
    protocol: "openai-chat",
    model: "gpt-5.6",
    status: "success",
    durationMs: 42,
    inputTokens: null,
    outputTokens: null,
    usagePresent: true,
    errorCode: "",
    createdAt: "2026-09-01T00:00:00.000Z"
  });

  for (const value of [null, "", true, 1.5, -1, Number.MAX_SAFE_INTEGER + 1]) {
    const result = normalizeMetric({ operation: "knowledge_ask", status: "failed", usage: { inputTokens: value, outputTokens: value } });
    assert.equal(result.inputTokens, null);
    assert.equal(result.outputTokens, null);
  }
});

test("AI metric writes are best effort and classify timeout errors", async () => {
  const writes = [];
  const db = {
    createAiRequestMetric: async (metric) => { writes.push(metric); return 11; }
  };
  assert.equal(await recordAiRequestMetricSafely({
    operation: "provider_diagnostic",
    status: "timeout",
    durationMs: 9,
    errorCode: "AI_TIMEOUT"
  }, { db, logger: { warn() {} } }), true);
  assert.equal(writes[0].status, "timeout");
  assert.equal(statusForError({ code: "AI_TIMEOUT" }), "timeout");
  assert.equal(statusForError({ code: "AI_PROVIDER_FAILED" }), "failed");

  assert.equal(await recordAiRequestMetricSafely({ operation: "copilot_suggest", status: "success" }, {
    db: { createAiRequestMetric: async () => { throw new Error("database secret"); } },
    logger: { warn(payload) { assert.equal(payload.event, "ai.metrics.write.error"); assert.equal(Object.hasOwn(payload, "error"), false); } }
  }), false);
});

test("AI metric summary is bounded to safe aggregate DTOs", async () => {
  const summary = await summarizeAiRequestMetrics({
    from: "2026-09-01T00:00:00.000Z",
    to: "2026-09-02T00:00:00.000Z",
    dependencies: {
      db: {
        listAiRequestMetricSummary: async () => ({
          total: 5,
          success: 3,
          failed: 1,
          timeout: 1,
          averageDurationMs: 15.7,
          inputTokens: "12",
          outputTokens: null,
          unknownUsageCount: 2,
          groups: Array.from({ length: 200 }, (_, index) => ({
            operation: index % 2 ? "knowledge_ask" : "copilot_suggest",
            protocol: "openai-chat",
            total: 1,
            success: 1,
            failed: 0,
            timeout: 0,
            averageDurationMs: 1,
            inputTokens: 1,
            outputTokens: 1,
            unknownUsageCount: 0
          }))
        })
      }
    }
  });
  assert.equal(summary.total, 5);
  assert.equal(summary.averageDurationMs, 15.7);
  assert.equal(summary.outputTokens, null);
  assert.equal(summary.groups.length, 100);
});

test("AI metric cleanup delegates safely with the retention cutoff", async () => {
  let cutoff = "";
  const deleted = await cleanupExpiredMetrics("2026-08-01T00:00:00.000Z", {
    db: { deleteExpiredAiRequestMetrics: async (value) => { cutoff = value; return 3; } }
  });
  assert.equal(deleted, 3);
  assert.equal(cutoff, "2026-08-01T00:00:00.000Z");
});
