const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateFeedbackPayload,
  validateAdminLoginPayload,
  validateHomeDisplayPayload,
  validateSmtpTestPayload,
  validateWorktaskArrangePayload,
  validateNotificationHandoffRetryPayload,
  validateStatusProfileSettingsPayload,
  validateAiProfilePayload,
  validateAiProfileActivePayload,
  validateAiProfileDeletePayload,
  validateAiProfileDiagnosePayload,
  validateAiMetricsQueryPayload,
  validateAiSuggestPayload,
  validateAiSuggestionsQueryPayload,
  validateAiSuggestionDecisionPayload
} = require("../server/validation");

const {
  validateFeedbackExportPayload,
  validateWorktaskExportPayload,
  validateAuditListPayload
} = require("../server/validation");

test("validateFeedbackPayload accepts valid payload", () => {
  const result = validateFeedbackPayload({
    type: "Bug",
    title: "登录按钮样式错位",
    content: "在窄屏下按钮会换行，建议调整",
    contact: "tester@example.com",
    images: ["https://example.com/a.png"]
  });

  assert.equal(result.valid, true);
  assert.equal(result.data.type, "Bug");
  assert.equal(result.data.images.length, 1);
});

test("validateFeedbackPayload rejects invalid type", () => {
  const result = validateFeedbackPayload({
    type: "Unknown",
    title: "x",
    content: "y",
    contact: "z"
  });

  assert.equal(result.valid, false);
});

test("validateAdminLoginPayload validates required fields", () => {
  const result = validateAdminLoginPayload({
    username: "admin",
    password: "a-strong-password"
  });
  assert.equal(result.valid, true);
});

test("validateHomeDisplayPayload parses numeric boolean", () => {
  const result = validateHomeDisplayPayload({
    id: 12,
    showOnHome: 1
  });
  assert.equal(result.valid, true);
  assert.equal(result.data.showOnHome, true);
});

test("validateSmtpTestPayload supports comma and semicolon split", () => {
  const result = validateSmtpTestPayload({
    to: "a@example.com; b@example.com, c@example.com"
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.data.to, ["a@example.com", "b@example.com", "c@example.com"]);
});

test("validateWorktaskArrangePayload preserves explicit clear operations", () => {
  const assignee = validateWorktaskArrangePayload({ id: 12, assignee: null });
  const schedule = validateWorktaskArrangePayload({ id: 12, scheduledAt: "" });
  assert.equal(assignee.valid, true);
  assert.equal(assignee.data.assigneeProvided, true);
  assert.equal(assignee.data.assignee, "");
  assert.equal(schedule.valid, true);
  assert.equal(schedule.data.scheduledAtProvided, true);
  assert.equal(schedule.data.scheduledAt, "");
});

test("validateWorktaskArrangePayload rejects an empty update object", () => {
  const result = validateWorktaskArrangePayload({ id: 12 });
  assert.equal(result.valid, false);
});

test("validateNotificationHandoffRetryPayload accepts only UUID handoff ids", () => {
  const valid = validateNotificationHandoffRetryPayload({ handoffId: "00000000-0000-0000-0000-000000000000" });
  const invalid = validateNotificationHandoffRetryPayload({ handoffId: "not-a-uuid" });
  assert.equal(valid.valid, true);
  assert.equal(valid.data.handoffId, "00000000-0000-0000-0000-000000000000");
  assert.equal(invalid.valid, false);
});

test("validateStatusProfileSettingsPayload rejects embedded URL credentials", () => {
  const result = validateStatusProfileSettingsPayload({
    enabled: true,
    apiBaseUrl: "https://user:pass@example.test",
    timeoutMs: 5000
  });
  assert.equal(result.valid, false);
});

test("validateAiProfilePayload accepts a supported profile and normalizes its URL", () => {
  const result = validateAiProfilePayload({
    name: "OpenAI",
    protocol: "openai-chat",
    baseUrl: "https://api.openai.com/v1/",
    model: "gpt-4o-mini",
    key: "sk-test-key"
  });

  assert.equal(result.valid, true);
  assert.equal(result.data.baseUrl, "https://api.openai.com/v1");
  assert.equal(result.data.key, "sk-test-key");
});

test("validateAiProfilePayload rejects unsupported protocols and unsafe base URLs", () => {
  for (const baseUrl of [
    "ftp://provider.example/v1",
    "https://user:pass@provider.example/v1",
    "https://provider.example/v1?api_key=secret",
    "https://provider.example/v1#fragment",
    "https:///v1"
  ]) {
    const result = validateAiProfilePayload({
      name: "Provider",
      protocol: "unknown",
      baseUrl,
      model: "model",
      key: "key"
    });
    assert.equal(result.valid, false);
  }
});

test("validateAiProfilePayload permits an empty key only for an update", () => {
  const update = validateAiProfilePayload({
    id: "profile-1",
    name: "Provider",
    protocol: "anthropic-messages",
    baseUrl: "https://api.anthropic.com",
    model: "claude-3-5-sonnet",
    key: ""
  });
  const create = validateAiProfilePayload({
    name: "Provider",
    protocol: "anthropic-messages",
    baseUrl: "https://api.anthropic.com",
    model: "claude-3-5-sonnet",
    key: ""
  });

  assert.equal(update.valid, true);
  assert.equal(create.valid, false);
});

test("validateAiProfilePayload rejects explicit null optional fields", () => {
  const base = {
    name: "Provider",
    protocol: "openai-chat",
    baseUrl: "https://provider.example",
    model: "model",
    key: "key"
  };

  const nullReasoning = validateAiProfilePayload({ ...base, reasoningEffort: null });
  const nullPrompt = validateAiProfilePayload({ ...base, promptInstruction: null });
  const omitted = validateAiProfilePayload(base);

  assert.equal(nullReasoning.valid, false);
  assert.equal(nullPrompt.valid, false);
  assert.equal(omitted.valid, true);
  assert.equal(omitted.data.reasoningEffort, "");
  assert.equal(omitted.data.promptInstruction, "");
});

test("validateAiProfileActivePayload and delete payload normalize profile ids", () => {
  const active = validateAiProfileActivePayload({ profileId: " profile-1 " });
  const activeAlias = validateAiProfileActivePayload({ id: " profile-2 " });
  const clear = validateAiProfileActivePayload({ profileId: "" });
  const deletion = validateAiProfileDeletePayload({ id: " profile-1 " });

  assert.equal(active.valid, true);
  assert.equal(active.data.profileId, "profile-1");
  assert.equal(activeAlias.valid, true);
  assert.equal(activeAlias.data.profileId, "profile-2");
  assert.equal(clear.valid, true);
  assert.equal(clear.data.profileId, "");
  assert.equal(deletion.valid, true);
  assert.equal(deletion.data.profileId, "profile-1");
});

test("AI profile validators reject non-string identifiers instead of treating them as omitted", () => {
  const profile = validateAiProfilePayload({
    id: 123,
    name: "Provider",
    protocol: "openai-chat",
    baseUrl: "https://provider.example",
    model: "model",
    key: "key"
  });
  const active = validateAiProfileActivePayload({ profileId: 123 });

  assert.equal(profile.valid, false);
  assert.equal(active.valid, false);
});

test("AI diagnostic and metrics validators keep identifiers and time windows bounded", () => {
  const diagnose = validateAiProfileDiagnosePayload({ profileId: " profile-1 " });
  const invalidDiagnose = validateAiProfileDiagnosePayload({ profileId: "" });
  const metrics = validateAiMetricsQueryPayload({ hours: "168" });
  const defaultMetrics = validateAiMetricsQueryPayload({});
  const invalidMetrics = validateAiMetricsQueryPayload({ hours: "721" });

  assert.equal(diagnose.valid, true);
  assert.equal(diagnose.data.profileId, "profile-1");
  assert.equal(invalidDiagnose.valid, false);
  assert.deepEqual(metrics.data, { hours: 168 });
  assert.deepEqual(defaultMetrics.data, { hours: 24 });
  assert.equal(invalidMetrics.valid, false);
});

test("AI suggestion validators enforce entity and decision allow-lists", () => {
  const suggest = validateAiSuggestPayload({ entityType: "worktask", entityId: "42" });
  const query = validateAiSuggestionsQueryPayload({ entityType: "feedback", entityId: "7" });
  const decision = validateAiSuggestionDecisionPayload({
    suggestionId: "9",
    decision: "accepted",
    fields: ["replyDraft", "replyDraft"]
  });
  const invalidDecision = validateAiSuggestionDecisionPayload({ suggestionId: 9, decision: "accepted", fields: ["unknown"] });
  const invalid = validateAiSuggestPayload({ entityType: "account", entityId: 1 });

  assert.equal(suggest.valid, true);
  assert.deepEqual(suggest.data, { entityType: "worktask", entityId: 42 });
  assert.equal(query.valid, true);
  assert.deepEqual(query.data, { entityType: "feedback", entityId: 7 });
  assert.deepEqual(decision.data.fields, ["replyDraft"]);
  assert.equal(invalidDecision.valid, true);
  assert.deepEqual(invalidDecision.data.fields, []);
  assert.equal(invalid.valid, false);
});

test("export validators preserve list filters and reject unsupported values", () => {
  const feedback = validateFeedbackExportPayload({ status: "reviewed", keyword: " bug " });
  const worktask = validateWorktaskExportPayload({ status: "scheduled", priority: "URGENT", keyword: " deploy " });
  const invalidFeedback = validateFeedbackExportPayload({ status: "unknown" });
  const invalidWorktask = validateWorktaskExportPayload({ priority: "unknown" });

  assert.equal(feedback.valid, true);
  assert.deepEqual(feedback.data, { status: "reviewed", keyword: "bug" });
  assert.equal(worktask.valid, true);
  assert.deepEqual(worktask.data, { status: "scheduled", priority: "urgent", keyword: "deploy" });
  assert.equal(invalidFeedback.valid, false);
  assert.equal(invalidWorktask.valid, false);
});

test("audit validator normalizes filters, caps page size, and rejects invalid ids and time ranges", () => {
  const valid = validateAuditListPayload({
    action: "feedback.status",
    entityType: "feedback",
    entityId: "42",
    actor: "admin",
    from: "2026-08-01T00:00:00.000Z",
    to: "2026-08-31T23:59:59.999Z",
    page: "2",
    pageSize: "999"
  });
  const invalidId = validateAuditListPayload({ entityId: "not-an-id" });
  const invalidRange = validateAuditListPayload({ from: "2026-09-01T00:00:00.000Z", to: "2026-08-01T00:00:00.000Z" });
  const invalidPageType = validateAuditListPayload({ page: [2] });

  assert.equal(valid.valid, true);
  assert.equal(valid.data.entityId, 42);
  assert.equal(valid.data.page, 2);
  assert.equal(valid.data.pageSize, 100);
  assert.equal(invalidId.valid, false);
  assert.equal(invalidRange.valid, false);
  assert.equal(invalidPageType.valid, false);
});

test("audit validator accepts knowledge assistant entity type", () => {
  const result = validateAuditListPayload({
    entityType: "ai_knowledge",
    action: "ai.knowledge.reindex"
  });

  assert.equal(result.valid, true);
  assert.equal(result.data.entityType, "ai_knowledge");
});
