"use strict";

const config = require("./config");
const db = require("./db");
const { logger } = require("./logger");

const METRIC_OPERATIONS = new Set(["copilot_suggest", "knowledge_ask", "provider_diagnostic"]);
const METRIC_STATUSES = new Set(["success", "failed", "timeout"]);
const MAX_PROFILE_ID = 128;
const MAX_PROTOCOL = 64;
const MAX_MODEL = 120;
const MAX_ERROR_CODE = 64;
const MAX_DURATION_MS = 600000;
const MAX_GROUPS = 100;

function safeText(value, maxLength) {
  const text = typeof value === "string" ? value : value == null ? "" : String(value);
  return Array.from(text).slice(0, maxLength).join("");
}

function normalizeToken(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value !== "string" || !/^\d+$/u.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeMetric(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const operation = METRIC_OPERATIONS.has(source.operation) ? source.operation : "";
  const statusValue = source.status || source.outcome;
  const status = METRIC_STATUSES.has(statusValue) ? statusValue : "failed";
  const durationValue = typeof source.durationMs === "number" ? source.durationMs : Number(source.durationMs);
  const durationMs = Number.isSafeInteger(durationValue) && durationValue >= 0
    ? Math.min(durationValue, MAX_DURATION_MS)
    : 0;
  const usage = source.usage && typeof source.usage === "object" && !Array.isArray(source.usage)
    ? source.usage
    : source;
  const errorCode = typeof source.errorCode === "string" && /^[A-Za-z0-9_.-]{0,64}$/u.test(source.errorCode)
    ? source.errorCode
    : "";
  const modelCandidate = safeText(source.model, MAX_MODEL);
  return {
    operation,
    profileId: safeText(source.profileId, MAX_PROFILE_ID),
    protocol: safeText(source.protocol, MAX_PROTOCOL),
    model: /^(?:https?:)?\/\//iu.test(modelCandidate) ? "" : modelCandidate,
    status,
    durationMs,
    inputTokens: normalizeToken(usage.inputTokens),
    outputTokens: normalizeToken(usage.outputTokens),
    usagePresent: source.usagePresent === true || source.usageReported === true,
    errorCode,
    createdAt: typeof source.createdAt === "string" && !Number.isNaN(Date.parse(source.createdAt))
      ? source.createdAt.slice(0, 40)
      : new Date().toISOString()
  };
}

function statusForError(error) {
  return error && error.code === "AI_TIMEOUT" ? "timeout" : "failed";
}

function dependenciesFrom(value) {
  const deps = value && typeof value === "object" ? value : {};
  return {
    db: deps.db || db,
    logger: deps.logger || logger
  };
}

async function recordAiRequestMetricSafely(input = {}, dependencies) {
  const deps = dependenciesFrom(dependencies);
  const metric = normalizeMetric(input);
  if (!metric.operation) return false;
  try {
    if (!deps.db || typeof deps.db.createAiRequestMetric !== "function") return false;
    await deps.db.createAiRequestMetric(metric);
    return true;
  } catch (_) {
    try {
      deps.logger.warn({
        event: "ai.metrics.write.error",
        operation: metric.operation,
        status: metric.status,
        errorCode: metric.errorCode || "AI_METRICS_WRITE_FAILED"
      }, "AI metric write failed");
    } catch (_) {
      // Metrics are deliberately best effort; logging is best effort too.
    }
    return false;
  }
}

function normalizeAggregateNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeAggregate(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const integer = (value) => {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
  };
  const average = normalizeAggregateNumber(source.averageDurationMs, null);
  return {
    total: integer(source.total),
    success: integer(source.success),
    failed: integer(source.failed),
    timeout: integer(source.timeout),
    averageDurationMs: average === null ? null : Math.max(0, Math.min(MAX_DURATION_MS, average)),
    inputTokens: source.inputTokens === null || source.inputTokens === undefined ? null : normalizeToken(source.inputTokens),
    outputTokens: source.outputTokens === null || source.outputTokens === undefined ? null : normalizeToken(source.outputTokens),
    unknownUsageCount: integer(source.unknownUsageCount)
  };
}

function normalizeGroup(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  return {
    operation: METRIC_OPERATIONS.has(source.operation) ? source.operation : "",
    protocol: safeText(source.protocol, MAX_PROTOCOL),
    ...normalizeAggregate(source)
  };
}

function metricWindow({ from, to } = {}) {
  const end = typeof to === "string" && !Number.isNaN(Date.parse(to)) ? new Date(to).toISOString() : new Date().toISOString();
  const start = typeof from === "string" && !Number.isNaN(Date.parse(from))
    ? new Date(from).toISOString()
    : new Date(Date.parse(end) - 24 * 60 * 60 * 1000).toISOString();
  if (start >= end) {
    const error = new Error("AI metrics 时间窗口无效");
    error.code = "INVALID_PAYLOAD";
    throw error;
  }
  return { from: start, to: end };
}

async function summarizeAiRequestMetrics({ from, to, dependencies } = {}) {
  const window = metricWindow({ from, to });
  const deps = dependenciesFrom(dependencies);
  if (!deps.db || typeof deps.db.listAiRequestMetricSummary !== "function") {
    const error = new Error("AI metrics summary unavailable");
    error.code = "AI_METRICS_UNAVAILABLE";
    throw error;
  }
  let raw;
  try {
    raw = await deps.db.listAiRequestMetricSummary({ ...window, maxGroups: MAX_GROUPS });
  } catch (_) {
    const error = new Error("AI metrics summary unavailable");
    error.code = "AI_METRICS_UNAVAILABLE";
    throw error;
  }
  const source = raw && typeof raw === "object" ? raw : {};
  const groups = Array.isArray(source.groups)
    ? source.groups.slice(0, MAX_GROUPS).map(normalizeGroup).filter((group) => group.operation)
    : [];
  return {
    ...window,
    ...normalizeAggregate(source),
    groups
  };
}

async function cleanupExpiredMetrics(cutoff, dependencies) {
  const deps = dependenciesFrom(dependencies);
  if (!deps.db || typeof deps.db.deleteExpiredAiRequestMetrics !== "function") return 0;
  return deps.db.deleteExpiredAiRequestMetrics(cutoff);
}

function retentionDays() {
  const value = config.aiMetricsRetentionDays;
  return Number.isSafeInteger(value) && value >= 1 && value <= 3650 ? value : 30;
}

async function cleanupExpiredMetricsIfEnabled(now = new Date().toISOString(), dependencies) {
  if (config.aiMetricsAutoCleanup !== true) return 0;
  const nowTime = Date.parse(now);
  const baseTime = Number.isFinite(nowTime) ? nowTime : Date.now();
  const cutoff = new Date(baseTime - retentionDays() * 24 * 60 * 60 * 1000).toISOString();
  return cleanupExpiredMetrics(cutoff, dependencies);
}

module.exports = {
  METRIC_OPERATIONS,
  METRIC_STATUSES,
  MAX_GROUPS,
  normalizeMetric,
  normalizeToken,
  statusForError,
  recordAiRequestMetricSafely,
  summarizeAiRequestMetrics,
  cleanupExpiredMetrics,
  cleanupExpiredMetricsIfEnabled,
  retentionDays
};
