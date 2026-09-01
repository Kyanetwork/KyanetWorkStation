(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.KwsAiModel = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  const PROTOCOLS = new Set(["openai-chat", "openai-responses", "anthropic-messages"]);
  const CATEGORIES = new Set(["Bug", "功能建议", "体验问题", "其他"]);
  const PRIORITIES = new Set(["low", "medium", "high", "urgent"]);
  const REASONING_EFFORTS = new Set(["", "low", "medium", "high", "xhigh", "max"]);
  const DECISION_FIELDS = new Set(["summary", "category", "priority", "tags", "replyDraft"]);

  function text(value) {
    return value == null ? "" : String(value);
  }

  function boundedText(value, maxLength) {
    return text(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, maxLength);
  }

  function boundedUnicodeText(value, maxLength) {
    return Array.from(text(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ""))
      .slice(0, maxLength)
      .join("");
  }

  function numberOr(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function normalizeProfile(input) {
    const source = input && typeof input === "object" ? input : {};
    const rawReasoningEffort = source.reasoningEffort ?? source.reasoning_effort;
    const reasoningEffort = typeof rawReasoningEffort === "string" && REASONING_EFFORTS.has(rawReasoningEffort.trim())
      ? rawReasoningEffort.trim()
      : "";
    return {
      id: boundedText(source.id, 80),
      name: boundedText(source.name, 64),
      protocol: PROTOCOLS.has(source.protocol) ? source.protocol : "",
      baseUrl: boundedText(source.baseUrl, 300),
      model: boundedText(source.model, 120),
      reasoningEffort,
      promptInstruction: typeof source.promptInstruction === "string"
        ? boundedUnicodeText(source.promptInstruction.trim(), 2000)
        : "",
      keyConfigured: source.keyConfigured === true,
      keyMask: source.keyConfigured === true ? "••••••••" : "",
      createdAt: boundedText(source.createdAt, 40),
      updatedAt: boundedText(source.updatedAt, 40)
    };
  }

  function normalizeStringList(value, maxItems, maxLength) {
    if (!Array.isArray(value)) return [];
    const result = [];
    for (const entry of value) {
      const normalized = boundedText(entry, maxLength).trim();
      if (!normalized || result.includes(normalized)) continue;
      result.push(normalized);
      if (result.length >= maxItems) break;
    }
    return result;
  }

  function normalizeSuggestion(input) {
    const source = input && typeof input === "object" ? input : {};
    const rawSuggestion = source.suggestion && typeof source.suggestion === "object" ? source.suggestion : {};
    const rawProvider = source.provider && typeof source.provider === "object" ? source.provider : {};
    const rawSimilar = Array.isArray(source.similarItems) ? source.similarItems : [];
    return {
      id: Number.isSafeInteger(Number(source.id)) ? Number(source.id) : 0,
      entityType: source.entityType === "worktask" ? "worktask" : "feedback",
      entityId: Number.isSafeInteger(Number(source.entityId)) ? Number(source.entityId) : 0,
      status: ["available", "accepted", "rejected", "expired"].includes(source.status) ? source.status : "available",
      provider: {
        profileId: boundedText(rawProvider.profileId, 80),
        name: boundedText(rawProvider.name, 64),
        protocol: PROTOCOLS.has(rawProvider.protocol) ? rawProvider.protocol : "",
        model: boundedText(rawProvider.model, 120)
      },
      generatedAt: boundedText(source.generatedAt, 40),
      expiresAt: boundedText(source.expiresAt, 40),
      suggestion: {
        summary: boundedText(rawSuggestion.summary, 600),
        category: CATEGORIES.has(rawSuggestion.category) ? rawSuggestion.category : "",
        priority: PRIORITIES.has(rawSuggestion.priority) ? rawSuggestion.priority : "",
        tags: normalizeStringList(rawSuggestion.tags, 8, 32),
        replyDraft: boundedText(rawSuggestion.replyDraft, 1000),
        rationale: boundedText(rawSuggestion.rationale, 600),
        missingInfo: normalizeStringList(rawSuggestion.missingInfo, 6, 120)
      },
      similarItems: rawSimilar.slice(0, 3).map((item) => {
        const raw = item && typeof item === "object" ? item : {};
        return {
          entityType: raw.entityType === "worktask" ? "worktask" : "feedback",
          entityId: Number.isSafeInteger(Number(raw.entityId)) ? Number(raw.entityId) : 0,
          title: boundedText(raw.title, 100),
          status: boundedText(raw.status, 32),
          priority: boundedText(raw.priority, 16),
          score: Math.max(0, Math.min(1, numberOr(raw.score, 0)))
        };
      }),
      usage: {
        inputTokens: Number.isSafeInteger(Number(source.usage && source.usage.inputTokens)) ? Number(source.usage.inputTokens) : null,
        outputTokens: Number.isSafeInteger(Number(source.usage && source.usage.outputTokens)) ? Number(source.usage.outputTokens) : null
      }
    };
  }

  function suggestionFormValues(suggestion, entityType) {
    const normalized = normalizeSuggestion(suggestion);
    const values = {};
    if (normalized.suggestion.category) values.type = normalized.suggestion.category;
    if (entityType === "worktask" && normalized.suggestion.priority) {
      values.priority = normalized.suggestion.priority;
    }
    if (entityType === "worktask" && normalized.suggestion.tags.length) {
      values.tags = normalized.suggestion.tags.join(", ");
    }
    if (normalized.suggestion.replyDraft) values.publicReply = normalized.suggestion.replyDraft;
    return values;
  }

  function isDecisionField(value) {
    return DECISION_FIELDS.has(value);
  }

  return {
    normalizeProfile,
    normalizeSuggestion,
    suggestionFormValues,
    isDecisionField
  };
});
