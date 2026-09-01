const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  normalizeProfile,
  normalizeSuggestion,
  suggestionFormValues
} = require("../public/admin/ai-model");

test("AI profile projection never exposes key material", () => {
  const profile = normalizeProfile({
    id: "profile-1",
    name: "OpenAI",
    protocol: "openai-chat",
    baseUrl: "https://api.example.test/v1",
    model: "model-a",
    apiKey: "sk-super-secret",
    keyEnvelope: { ciphertext: "secret-ciphertext" },
    keyConfigured: true,
    keyMask: "••••••••"
  });

  assert.equal(profile.id, "profile-1");
  assert.equal(profile.keyConfigured, true);
  assert.equal(profile.keyMask, "••••••••");
  assert.equal(profile.apiKey, undefined);
  assert.equal(profile.keyEnvelope, undefined);
  assert.doesNotMatch(JSON.stringify(profile), /sk-super-secret|secret-ciphertext/);
});

test("AI profile projection normalizes bounded reasoning and prompt instruction fields", () => {
  const profile = normalizeProfile({
    id: "profile-1",
    name: "OpenAI",
    protocol: "openai-responses",
    baseUrl: "https://api.example.test/v1",
    model: "model-a",
    reasoningEffort: "xhigh",
    promptInstruction: `  ${"😀".repeat(2500)}  `
  });

  assert.equal(profile.reasoningEffort, "xhigh");
  assert.equal([...profile.promptInstruction].length, 2000);
  assert.equal(profile.promptInstruction.startsWith("😀"), true);

  const unsupported = normalizeProfile({ reasoningEffort: "unsupported", promptInstruction: 42 });
  assert.equal(unsupported.reasoningEffort, "");
  assert.equal(unsupported.promptInstruction, "");
});

test("AI suggestion projection bounds untrusted fields and maps form values", () => {
  const suggestion = normalizeSuggestion({
    id: 4,
    entityType: "worktask",
    entityId: 9,
    status: "available",
    suggestion: {
      summary: "a".repeat(900),
      category: "Bug",
      priority: "urgent",
      tags: ["登录", "登录", "x".repeat(90)],
      replyDraft: "公开回复",
      rationale: "依据",
      missingInfo: ["缺少版本"]
    },
    similarItems: [{ entityType: "feedback", entityId: 2, title: "相似", status: "new", priority: "", score: 0.4 }],
    provider: { profileId: "p1", name: "OpenAI", protocol: "openai-chat", model: "m" }
  });

  assert.equal(suggestion.suggestion.summary.length, 600);
  assert.deepEqual(suggestion.suggestion.tags, ["登录", "x".repeat(32)]);
  assert.equal(suggestion.suggestion.priority, "urgent");
  assert.equal(suggestion.similarItems.length, 1);
  assert.deepEqual(suggestionFormValues(suggestion, "worktask"), {
    type: "Bug",
    priority: "urgent",
    tags: "登录, xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    publicReply: "公开回复"
  });
});

test("AI suggestion projection ignores unsupported categories and fields", () => {
  const suggestion = normalizeSuggestion({
    status: "unknown",
    suggestion: { category: "shell-command", priority: "root", tags: "not-array", unknown: "value" },
    provider: { apiKey: "secret" }
  });

  assert.equal(suggestion.status, "available");
  assert.equal(suggestion.suggestion.category, "");
  assert.equal(suggestion.suggestion.priority, "");
  assert.deepEqual(suggestion.suggestion.tags, []);
  assert.equal(suggestion.provider.apiKey, undefined);
});

test("admin UI sends the server key field and loads AI state for authenticated sessions", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "..", "public", "admin", "admin.js"), "utf8");
  assert.match(source, /key:\s*document\.getElementById\("aiProfileApiKey"\)\.value/);
  assert.doesNotMatch(source, /apiKey:\s*document\.getElementById\("aiProfileApiKey"\)\.value/);
  assert.match(source, /await loadAiStatus\(\)\.catch/);
  assert.match(source, /btn\.dataset\.action === "ai-suggest"/);
  assert.match(source, /btn\.dataset\.action === "ai-decision"/);
  assert.match(source, /if \(!aiModel\.isDecisionField\(field\)\) return ""/);
  assert.match(source, /options\.loading \? " disabled"/);
  assert.match(source, /options\.decision === false/);
});
