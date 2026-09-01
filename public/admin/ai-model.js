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
        inputTokens: normalizeToken(source.usage && source.usage.inputTokens),
        outputTokens: normalizeToken(source.usage && source.usage.outputTokens)
      }
    };
  }

  function normalizeToken(value) {
    if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
    if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : null;
    if (typeof value !== "string" || !/^\d+$/u.test(value.trim())) return null;
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  }

  function safeNonNegativeInteger(value, fallback) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
  }

  function safeHttpStatus(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 100 && number <= 599 ? number : null;
  }

  function safeDuration(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.min(600000, number) : null;
  }

  function normalizeDiagnostic(input) {
    const source = input && typeof input === "object" ? input : {};
    const rawProfile = source.profile && typeof source.profile === "object" ? source.profile : source;
    const rawChecks = source.checks && typeof source.checks === "object" ? source.checks : {};
    const rawUsage = source.usage && typeof source.usage === "object" ? source.usage : {};
    const status = ["passed", "failed", "timeout"].includes(source.status) ? source.status : "failed";
    return {
      status,
      profile: {
        id: boundedText(rawProfile.id, 128),
        name: boundedText(rawProfile.name, 64),
        protocol: PROTOCOLS.has(rawProfile.protocol) ? rawProfile.protocol : "",
        model: boundedText(rawProfile.model, 120)
      },
      endpoint: ["/chat/completions", "/responses", "/messages"].includes(source.endpoint) ? source.endpoint : "",
      checks: {
        reachable: rawChecks.reachable === true,
        responseJson: rawChecks.responseJson === true || rawChecks.jsonParsed === true,
        textExtracted: rawChecks.textExtracted === true,
        probeMatched: rawChecks.probeMatched === true,
        usageReported: rawChecks.usageReported === true || rawChecks.usageReturned === true,
        responseWithinLimit: rawChecks.responseWithinLimit !== false
      },
      httpStatus: safeHttpStatus(source.httpStatus),
      durationMs: safeDuration(source.durationMs),
      usage: {
        inputTokens: normalizeToken(rawUsage.inputTokens),
        outputTokens: normalizeToken(rawUsage.outputTokens)
      },
      providerRequestId: boundedText(source.providerRequestId, 128),
      reasoningEffortApplied: source.reasoningEffortApplied === true || source.reasoningEffortSent === true,
      errorCode: boundedText(source.errorCode, 64),
      warnings: normalizeStringList(source.warnings, 5, 160),
      checkedAt: boundedText(source.checkedAt, 40)
    };
  }

  function normalizeMetrics(input) {
    const source = input && typeof input === "object" ? input : {};
    const integer = (value) => safeNonNegativeInteger(value, 0);
    const aggregate = {
      total: integer(source.total),
      success: integer(source.success),
      failed: integer(source.failed),
      timeout: integer(source.timeout),
      averageDurationMs: source.averageDurationMs === null || source.averageDurationMs === undefined
        ? null
        : safeDuration(source.averageDurationMs),
      inputTokens: source.inputTokens === null || source.inputTokens === undefined ? null : normalizeToken(source.inputTokens),
      outputTokens: source.outputTokens === null || source.outputTokens === undefined ? null : normalizeToken(source.outputTokens),
      unknownUsageCount: integer(source.unknownUsageCount)
    };
    return {
      from: boundedText(source.from, 40),
      to: boundedText(source.to, 40),
      ...aggregate,
      groups: Array.isArray(source.groups) ? source.groups.slice(0, 100).map((group) => ({
        operation: ["copilot_suggest", "knowledge_ask", "provider_diagnostic"].includes(group && group.operation) ? group.operation : "",
        protocol: boundedText(group && group.protocol, 64),
        ...((() => {
          const value = group && typeof group === "object" ? group : {};
          return {
            total: integer(value.total),
            success: integer(value.success),
            failed: integer(value.failed),
            timeout: integer(value.timeout),
            averageDurationMs: value.averageDurationMs === null || value.averageDurationMs === undefined ? null : safeDuration(value.averageDurationMs),
            inputTokens: value.inputTokens === null || value.inputTokens === undefined ? null : integer(value.inputTokens),
            outputTokens: value.outputTokens === null || value.outputTokens === undefined ? null : integer(value.outputTokens),
            unknownUsageCount: integer(value.unknownUsageCount)
          };
        })())
      })).filter((group) => group.operation) : []
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
    normalizeDiagnostic,
    normalizeMetrics,
    suggestionFormValues,
    isDecisionField
  };
});
