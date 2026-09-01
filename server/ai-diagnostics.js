"use strict";

const config = require("./config");
const profiles = require("./ai-profiles");
const provider = require("./ai-provider");
const metrics = require("./ai-metrics");

const DIAGNOSTIC_PROMPT = "KyanetWorkStation provider diagnostic. Reply with exactly KWS_DIAGNOSTIC_OK and nothing else.";
const SENTINEL = "KWS_DIAGNOSTIC_OK";
const MAX_DURATION_MS = 600000;
const MAX_PROVIDER_REQUEST_ID = 128;
const ALLOWED_PROTOCOLS = new Set(["openai-chat", "openai-responses", "anthropic-messages"]);
const ALLOWED_REASONING_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);

function aiError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function safeText(value, maxLength) {
  const text = typeof value === "string" ? value : value == null ? "" : String(value);
  return Array.from(text).slice(0, maxLength).join("");
}

function safeRequestId(value) {
  const text = typeof value === "string" ? value : "";
  return text.length <= MAX_PROVIDER_REQUEST_ID && /^[A-Za-z0-9._:-]+$/u.test(text) ? text : "";
}

function endpointForProtocol(protocol) {
  return ({
    "openai-chat": "/chat/completions",
    "openai-responses": "/responses",
    "anthropic-messages": "/messages"
  })[protocol] || "";
}

function dependenciesFrom(value) {
  const deps = value && typeof value === "object" ? value : {};
  return {
    profiles: deps.profiles || profiles,
    provider: deps.provider || provider.requestProviderSuggestion,
    metrics: deps.metrics || metrics
  };
}

function profileDto(profile) {
  return {
    id: safeText(profile && profile.id, 128),
    name: safeText(profile && profile.name, 64),
    protocol: ALLOWED_PROTOCOLS.has(profile && profile.protocol) ? profile.protocol : "",
    model: safeText(profile && profile.model, 120)
  };
}

function boundedDuration(startedAt) {
  return Math.max(0, Math.min(MAX_DURATION_MS, Date.now() - startedAt));
}

function providerMetaOf(source) {
  const meta = source && typeof source.providerMeta === "object" ? source.providerMeta : source || {};
  const status = Number(meta.httpStatus);
  return {
    reachable: meta.reachable === true,
    httpStatus: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    responseWithinLimit: meta.responseWithinLimit !== false,
    responseJson: meta.responseJson === true || meta.jsonParsed === true,
    textExtracted: meta.textExtracted === true,
    usageReported: meta.usageReported === true || meta.usageReturned === true,
    endpoint: endpointForProtocol(meta.protocol) || safeText(meta.endpoint, 32),
    reasoningEffortSent: meta.reasoningEffortSent === true || meta.reasoningEffortApplied === true
  };
}

function usageOf(source) {
  const usage = source && source.usage && typeof source.usage === "object" ? source.usage : {};
  const normalize = (value) => {
    if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
    if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : null;
    if (typeof value !== "string" || !/^\d+$/u.test(value.trim())) return null;
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  };
  return {
    inputTokens: normalize(usage.inputTokens),
    outputTokens: normalize(usage.outputTokens)
  };
}

function resultDto(profile, meta, values) {
  const dtoProfile = profileDto(profile);
  const safeMeta = providerMetaOf(meta);
  const status = values.status || "failed";
  const warnings = Array.isArray(values.warnings)
    ? values.warnings.filter((item) => typeof item === "string").slice(0, 5)
    : [];
  const usage = usageOf(values.providerResult);
  if (!safeMeta.usageReported && status === "passed" && !warnings.includes("Provider 未返回 usage")) {
    warnings.push("Provider 未返回 usage");
  }
  return {
    status,
    outcome: status === "passed" ? "success" : status,
    profile: dtoProfile,
    profileId: dtoProfile.id,
    protocol: dtoProfile.protocol,
    model: dtoProfile.model,
    endpoint: endpointForProtocol(dtoProfile.protocol),
    checks: {
      reachable: safeMeta.reachable,
      responseJson: safeMeta.responseJson,
      textExtracted: safeMeta.textExtracted,
      probeMatched: values.probeMatched === true,
      usageReported: safeMeta.usageReported,
      responseWithinLimit: safeMeta.responseWithinLimit
    },
    reachable: safeMeta.reachable,
    httpStatus: safeMeta.httpStatus,
    responseWithinLimit: safeMeta.responseWithinLimit,
    responseJson: safeMeta.responseJson,
    textExtracted: safeMeta.textExtracted,
    probeMatched: values.probeMatched === true,
    usageReported: safeMeta.usageReported,
    usageReturned: safeMeta.usageReported,
    usage,
    providerRequestId: safeRequestId(values.providerResult && values.providerResult.providerRequestId),
    durationMs: values.durationMs,
    reasoningEffortApplied: safeMeta.reasoningEffortSent,
    reasoningEffortSent: safeMeta.reasoningEffortSent,
    errorCode: safeText(values.errorCode, 64),
    warnings,
    checkedAt: new Date().toISOString()
  };
}

async function recordMetric(deps, input) {
  try {
    if (deps.metrics && typeof deps.metrics.recordAiRequestMetricSafely === "function") {
      await deps.metrics.recordAiRequestMetricSafely(input);
    }
  } catch (_) {
    // Diagnostic result must not be changed by optional metrics persistence.
  }
}

async function diagnoseProfile({ profileId, requestId = "", signal, dependencies } = {}) {
  const deps = dependenciesFrom(dependencies);
  if (!config.ai.enabled) throw aiError("AI_UNAVAILABLE", "AI Copilot 未启用");
  const normalizedId = typeof profileId === "string" ? profileId.trim() : "";
  if (!normalizedId) throw aiError("INVALID_PAYLOAD", "profile id 不合法");
  const getSnapshot = deps.profiles.getProfileSnapshot || deps.profiles.getActiveProfileSnapshot;
  const profile = await getSnapshot.call(deps.profiles, normalizedId);
  if (!profile || profile.id !== normalizedId) throw aiError("NOT_FOUND", "AI profile 不存在");

  const startedAt = Date.now();
  let providerResult = null;
  let providerError = null;
  let providerAttempted = false;
  let meta = { endpoint: endpointForProtocol(profile.protocol), reasoningEffortSent: false };
  try {
    let apiKey;
    try {
      apiKey = deps.profiles.decryptProfileApiKey(profile);
    } catch (error) {
      if (error && error.code === "AI_KEY_UNAVAILABLE") throw error;
      throw aiError("AI_KEY_UNAVAILABLE", "AI profile 密钥不可用");
    }
    providerAttempted = true;
    providerResult = await deps.provider({
      profile: { ...profile, apiKey },
      prompt: DIAGNOSTIC_PROMPT,
      requestId,
      signal
    });
    meta = providerMetaOf(providerResult);
    const text = providerResult && typeof providerResult.text === "string" ? providerResult.text : "";
    meta.reachable = providerResult && providerResult.reachable !== undefined ? meta.reachable : true;
    meta.responseJson = providerResult && providerResult.responseJson !== undefined ? meta.responseJson : true;
    meta.textExtracted = providerResult && providerResult.textExtracted !== undefined ? meta.textExtracted : Boolean(text);
    meta.usageReported = providerResult && providerResult.usageReported !== undefined
      ? meta.usageReported
      : Boolean(providerResult && providerResult.usage && typeof providerResult.usage === "object" && !Array.isArray(providerResult.usage));
    meta.reasoningEffortSent = providerResult && providerResult.reasoningEffortSent !== undefined
      ? meta.reasoningEffortSent
      : profile.protocol === "openai-responses" && ALLOWED_REASONING_EFFORTS.has(profile.reasoningEffort);
    const matched = text === SENTINEL;
    const status = matched ? "passed" : "failed";
    const errorCode = matched ? "" : "AI_INVALID_RESPONSE";
    const result = resultDto(profile, meta, {
      providerResult,
      status,
      probeMatched: matched,
      errorCode,
      durationMs: boundedDuration(startedAt)
    });
    await recordMetric(deps, {
      operation: "provider_diagnostic",
      profileId: profile.id,
      protocol: profile.protocol,
      model: profile.model,
      status: status === "passed" ? "success" : "failed",
      durationMs: result.durationMs,
      usage: result.usage,
      usagePresent: result.usageReported,
      errorCode: result.errorCode
    });
    return result;
  } catch (error) {
    if (!providerAttempted || !error || !["AI_TIMEOUT", "AI_PROVIDER_FAILED", "AI_INVALID_RESPONSE"].includes(error.code)) {
      throw error;
    }
    providerError = error;
    meta = providerMetaOf(error);
    const status = error.code === "AI_TIMEOUT" ? "timeout" : "failed";
    const result = resultDto(profile, meta, {
      providerResult,
      status,
      probeMatched: false,
      errorCode: error.code,
      durationMs: boundedDuration(startedAt)
    });
    await recordMetric(deps, {
      operation: "provider_diagnostic",
      profileId: profile.id,
      protocol: profile.protocol,
      model: profile.model,
      status,
      durationMs: result.durationMs,
      usage: result.usage,
      usagePresent: result.usageReported,
      errorCode: result.errorCode
    });
    return result;
  } finally {
    // Keep a local reference for debuggability without ever serializing the
    // upstream error or response body.
    void providerError;
  }
}

module.exports = {
  DIAGNOSTIC_PROMPT,
  SENTINEL,
  endpointForProtocol,
  diagnoseProfile
};
