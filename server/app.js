require("dotenv").config();

const path = require("path");
const express = require("express");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");

const config = require("./config");
const { validateRuntimeConfig } = config;
const { logger, requestLoggerMiddleware } = require("./logger");
const { notifyNewFeedback, notifyNewWorktask, sendSmtpTestMail } = require("./notify");
const { notifyWebhookNewFeedback, notifyWebhookNewWorktask, sendWebhookTestMessage } = require("./webhook");
const {
  initializeDatabase,
  ensureBootstrapAdmin,
  cleanupExpiredSessions,
  nowIso,
  getHealthCounts,
  createFeedback,
  createWorktask,
  createWorktaskByAdmin,
  getAdminByUsername,
  getFeedbackById,
  getWorktaskById,
  listFeedback,
  countExportRows,
  listFeedbackExportBatch,
  listWorktaskExportBatch,
  listAdminAudits,
  updateFeedbackStatus,
  updateFeedbackHomeDisplay,
  updateFeedbackNoteReply,
  deleteFeedback,
  listWorktask,
  updateWorktaskStatus,
  updateWorktaskHomeDisplay,
  updateWorktaskNoteReply,
  arrangeWorktask,
  deleteWorktask,
  getHomeHighlights,
  getStatusSettings,
  updateStatusProfileSettings,
  updateMinecraftStatusSettings,
  enqueueNotificationDeliveries,
  listNotificationDeliveries,
  retryNotificationDelivery,
  markNotificationDeliveryDelivered,
  recordNotificationDeliveryFailure,
  listDueNotificationDeliveries
} = require("./db");
const { fetchMeowStatusDashboard } = require("./meowstatus");
const {
  saveProfile,
  setActiveProfile,
  deleteProfile,
  getAiProfileStatus
} = require("./ai-profiles");
const { diagnoseProfile } = require("./ai-diagnostics");
const {
  summarizeAiRequestMetrics,
  cleanupExpiredMetricsIfEnabled
} = require("./ai-metrics");
const {
  generateSuggestion,
  listSuggestions,
  recordSuggestionDecision,
  getCopilotPromptInstructionMetadata
} = require("./ai-copilot");
const {
  getKnowledgeStatus,
  reindexKnowledge,
  askKnowledge,
  listKnowledgeHistory,
  deleteKnowledgeAnswer,
  cleanupKnowledgeHistory,
  cleanupKnowledgeHistoryIfEnabled,
  getKnowledgeSettings,
  setKnowledgeSettings
} = require("./ai-knowledge");
const {
  createNotificationHandoff,
  listNotificationHandoffs,
  retryNotificationHandoff,
  sanitizeError: sanitizeNotificationError
} = require("./notification-handoff");
const { sendError } = require("./errors");
const {
  buildSessionCookieOptions,
  clearSessionCookie,
  createSessionForUser,
  destroySessionByCookieToken,
  requireAdminSession
} = require("./auth");
const {
  validateFeedbackPayload,
  validateWorktaskPayload,
  validateAdminWorktaskCreatePayload,
  validateAdminLoginPayload,
  validateListPayload,
  validateWorktaskListPayload,
  validateFeedbackExportPayload,
  validateWorktaskExportPayload,
  validateAuditListPayload,
  validateStatusPayload,
  validateWorktaskStatusPayload,
  validateWorktaskArrangePayload,
  validateDeletePayload,
  validateNotificationHandoffRetryPayload,
  validateHomeDisplayPayload,
  validateNoteReplyPayload,
  validateSmtpTestPayload,
  validateWebhookTestPayload,
  validateStatusProfileSettingsPayload,
  validateMinecraftStatusSettingsPayload,
  validateAiProfilePayload,
  validateAiProfileActivePayload,
  validateAiProfileDeletePayload,
  validateAiProfileDiagnosePayload,
  validateAiMetricsQueryPayload,
  validateAiSuggestPayload,
  validateAiSuggestionsQueryPayload,
  validateAiSuggestionDecisionPayload,
  validateAiKnowledgeAskPayload,
  validateAiKnowledgeHistoryQueryPayload,
  validateAiKnowledgeAnswerDeletePayload,
  validateAiKnowledgeSettingsPayload
} = require("./validation");
const {
  FEEDBACK_EXPORT_COLUMNS,
  WORKTASK_EXPORT_COLUMNS,
  writeCsvExport
} = require("./admin-export");
const { recordAdminAuditSafely } = require("./admin-audit");
const {
  createRequireSameOriginForAdminMutation,
  requireJsonForAdminMutation
} = require("./security");

const app = express();
app.set("trust proxy", config.trustProxy);

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"]
    }
  }
}));
app.use(requestLoggerMiddleware);
app.use(express.json({ limit: "200kb" }));
app.use(express.urlencoded({ extended: false, limit: "200kb" }));
app.use(cookieParser());

const submitLimiter = rateLimit({
  windowMs: config.rateLimit.submitWindowMs,
  max: config.rateLimit.submitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: {
      code: "RATE_LIMITED",
      message: "提交过于频繁，请稍后再试"
    }
  }
});

const loginLimiter = rateLimit({
  windowMs: config.rateLimit.loginWindowMs,
  max: config.rateLimit.loginMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: {
      code: "RATE_LIMITED",
      message: "登录尝试过于频繁，请稍后再试"
    }
  }
});

const adminLimiter = rateLimit({
  windowMs: config.rateLimit.adminWindowMs,
  max: config.rateLimit.adminMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: {
      code: "RATE_LIMITED",
      message: "管理请求过于频繁，请稍后再试"
    }
  }
});

const aiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: {
      code: "AI_RATE_LIMITED",
      message: "AI 建议请求过于频繁，请稍后再试"
    }
  }
});

const aiKnowledgeLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: {
      code: "AI_RATE_LIMITED",
      message: "知识问答请求过于频繁，请稍后再试"
    }
  }
});

const aiDiagnosticsLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: {
      code: "AI_RATE_LIMITED",
      message: "Provider 诊断请求过于频繁，请稍后再试"
    }
  }
});

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function configuredNotificationProviders() {
  const providers = [];
  if (config.smtp.enabled) providers.push("smtp");
  if (config.webhook.enabled) providers.push("webhook");
  return providers;
}

function sendAiProfileError(res, error) {
  const code = error && error.code;
  if (code === "AI_KEY_UNAVAILABLE") {
    return sendError(res, 503, code, "AI profile 密钥不可用，请检查部署密钥配置");
  }
  if (code === "AI_PROFILE_CONFLICT") {
    return sendError(res, 409, code, "AI profile 名称或数量冲突");
  }
  if (code === "NOT_FOUND") {
    return sendError(res, 404, code, "AI profile 不存在");
  }
  if (code === "INVALID_PAYLOAD") {
    return sendError(res, 400, code, "AI profile 配置不合法");
  }
  throw error;
}

function sendAiError(res, error) {
  const code = error && error.code;
  if (code === "INVALID_PAYLOAD") return sendError(res, 400, code, "AI 建议请求不合法");
  if (code === "NOT_FOUND") return sendError(res, 404, code, "业务记录或 AI 建议不存在");
  if (code === "AI_UNAVAILABLE" || code === "AI_KEY_UNAVAILABLE") {
    return sendError(res, 503, code, "AI Copilot 当前不可用，请检查开关、active profile 和部署密钥");
  }
  if (code === "AI_BUSY") return sendError(res, 429, code, "AI 建议请求正在处理，请稍后再试");
  if (code === "AI_TIMEOUT") return sendError(res, 504, code, "AI provider 请求超时，请稍后重试");
  if (code === "AI_PROVIDER_FAILED" || code === "AI_INVALID_RESPONSE") {
    return sendError(res, 502, code, "AI provider 暂时无法提供有效建议");
  }
  if (code === "AI_METRICS_UNAVAILABLE") {
    return sendError(res, 503, code, "AI 指标暂时不可用，请稍后重试");
  }
  if (code === "KNOWLEDGE_CONFIG_INVALID" || code === "KNOWLEDGE_REINDEX_FAILED" || code === "AI_KNOWLEDGE_PERSIST_FAILED") {
    return sendError(res, 503, code, "知识助手当前不可用，请检查知识库配置或数据库状态");
  }
  if (code === "KNOWLEDGE_BUSY") return sendError(res, 429, code, "知识库正在重建，请稍后再试");
  if (code === "AI_SUGGESTION_CONFLICT") return sendError(res, 409, code, "AI 建议已过期或已经处理");
  throw error;
}

async function queueNotifications(entityType, entityId) {
  const providers = configuredNotificationProviders();
  if (!providers.length) return [];
  try {
    return await enqueueNotificationDeliveries({ entityType, entityId, providers });
  } catch (error) {
    let handoff = { persisted: false, error: "handoff creation failed" };
    try {
      handoff = await createNotificationHandoff({
        dbPath: config.dbPath,
        entityType,
        entityId,
        providers,
        error
      });
    } catch (handoffError) {
      handoff.error = sanitizeNotificationError(handoffError);
    }
    logger.error({
      event: "notification.outbox.enqueue.error",
      entityType,
      entityId,
      providers,
      handoffPersisted: handoff.persisted,
      error: sanitizeNotificationError(error)
    }, "notification outbox enqueue failed");
    if (!handoff.persisted) {
      logger.error({
        event: "notification.handoff.persistence.error",
        entityType,
        entityId,
        providers,
        error: handoff.error || "unknown persistence error"
      }, "notification handoff persistence failed; manual compensation required");
    }
    return [];
  }
}

async function recordAdminAction(req, action, entityType, entityId, result = "success", metadata = {}) {
  return recordAdminAuditSafely({
    req,
    action,
    entityType,
    entityId,
    result,
    metadata
  });
}

function auditResultForError(error) {
  return error && error.code === "NOT_FOUND" ? "not_found" : "failed";
}

function exportAuditMetadata(filters, total, maxRows) {
  const metadata = {
    rowCount: total,
    maxRows,
    hasKeyword: Boolean(filters.keyword)
  };
  if (filters.status) metadata.status = filters.status;
  if (filters.priority) metadata.priority = filters.priority;
  return metadata;
}

async function handleAdminCsvExport(req, res, {
  entityType,
  filters,
  filename,
  columns,
  fetchBatch
}) {
  const total = await countExportRows(entityType, filters);
  const metadata = exportAuditMetadata(filters, total, config.adminExportMaxRows);
  if (total > config.adminExportMaxRows) {
    await recordAdminAction(req, `${entityType}.export`, entityType, null, "rejected", metadata);
    return sendError(
      res,
      413,
      "EXPORT_LIMIT_EXCEEDED",
      `导出结果超过当前上限 ${config.adminExportMaxRows} 条，请缩小筛选范围后重试`
    );
  }

  try {
    return await writeCsvExport({
      res,
      total,
      maxRows: config.adminExportMaxRows,
      filename,
      columns,
      fetchBatch,
      recordProgress: async (event) => {
        if (event && (event.result === "success" || event.result === "failed")) {
          await recordAdminAction(req, `${entityType}.export`, entityType, null, event.result, {
            ...metadata,
            rowCount: event.rowCount
          });
        }
      }
    });
  } catch (error) {
    if (error && error.code === "EXPORT_LIMIT_EXCEEDED") {
      await recordAdminAction(req, `${entityType}.export`, entityType, null, "rejected", metadata);
      if (!res.headersSent) {
        return sendError(res, 413, error.code, `导出结果超过当前上限 ${config.adminExportMaxRows} 条，请缩小筛选范围后重试`);
      }
      return undefined;
    }
    if (res.headersSent) {
      logger.warn({
        event: "admin.export.stream.error",
        requestId: req.requestId,
        entityType,
        errorCode: error && error.code ? String(error.code).slice(0, 64) : "EXPORT_STREAM_FAILED"
      }, "admin CSV export stream failed");
      return undefined;
    }
    throw error;
  }
}

async function deliverNotification(delivery) {
  const record = delivery.entityType === "feedback"
    ? await getFeedbackById(delivery.entityId)
    : await getWorktaskById(delivery.entityId);
  if (!record) {
    return recordNotificationDeliveryFailure(delivery.id, "业务记录不存在", new Date(Date.now() + 60 * 60 * 1000).toISOString(), 1);
  }

  let result;
  if (delivery.provider === "smtp") {
    result = delivery.entityType === "feedback"
      ? await notifyNewFeedback({ id: delivery.entityId, ...record })
      : await notifyNewWorktask({ id: delivery.entityId, source: record.createdByAdmin ? "admin" : "user", ...record });
  } else if (delivery.provider === "webhook") {
    result = delivery.entityType === "feedback"
      ? await notifyWebhookNewFeedback({ id: delivery.entityId, ...record, notificationTarget: delivery.target })
      : await notifyWebhookNewWorktask({ id: delivery.entityId, source: record.createdByAdmin ? "admin" : "user", ...record, notificationTarget: delivery.target });
  } else {
    result = { sent: true, ok: false, error: "不支持的通知 provider" };
  }

  const isWebhookPartialFailure = delivery.provider === "webhook" && result &&
    typeof result.failCount === "number" && result.failCount > 0;
  const success = result && result.sent !== false && result.ok !== false && !isWebhookPartialFailure;
  if (success) {
    await markNotificationDeliveryDelivered(delivery.id);
    logger.info({ event: "notification.delivery.success", deliveryId: delivery.id, provider: delivery.provider }, "notification delivered");
    return { status: "delivered" };
  }

  const attempt = delivery.attempts + 1;
  const backoffMs = Math.min(60 * 60 * 1000, 1000 * 2 ** Math.min(attempt, 10));
  const message = isWebhookPartialFailure
    ? `Webhook 投递部分失败（成功 ${result.okCount}，失败 ${result.failCount}）${result.failures && result.failures[0] && result.failures[0].error ? `：${result.failures[0].error}` : ""}`
    : (result && (result.error || result.reason) ? String(result.error || result.reason) : "通知投递失败");
  const failedWebhookIndexes = isWebhookPartialFailure && Array.isArray(result.failures)
    ? [...new Set(result.failures
      .map((failure) => Number(failure && failure.index))
      .filter((index) => Number.isSafeInteger(index) && index >= 0))]
    : [];
  const retryTarget = failedWebhookIndexes.length
    ? `webhook-endpoints:${failedWebhookIndexes.join(",")}`
    : null;
  const outcome = await recordNotificationDeliveryFailure(
    delivery.id,
    message,
    new Date(Date.now() + backoffMs).toISOString(),
    3,
    retryTarget || null
  );
  logger.warn({
    event: "notification.delivery.failure",
    deliveryId: delivery.id,
    provider: delivery.provider,
    status: outcome.status,
    attempts: outcome.attempts,
    partial: isWebhookPartialFailure,
    okCount: isWebhookPartialFailure ? result.okCount : undefined,
    failCount: isWebhookPartialFailure ? result.failCount : undefined,
    retryTarget: retryTarget || undefined,
    error: message.slice(0, 240)
  }, "notification delivery failed");
  return outcome;
}

let notificationWorkerRunning = false;
async function processNotificationOutbox() {
  if (notificationWorkerRunning) return;
  notificationWorkerRunning = true;
  try {
    const due = await listDueNotificationDeliveries(20);
    for (const delivery of due) {
      await deliverNotification(delivery);
    }
  } catch (error) {
    logger.error({
      event: "notification.worker.error",
      error: error && error.message ? error.message : String(error)
    }, "notification worker failed");
  } finally {
    notificationWorkerRunning = false;
  }
}

const requireSameOriginForAdminMutation = createRequireSameOriginForAdminMutation({
  appBaseUrl: config.appBaseUrl,
  allowHeaderlessAdminMutation: config.allowHeaderlessAdminMutation,
  trustProxy: config.trustProxy,
  sendError
});

app.get("/api/health", asyncHandler(async (req, res) => {
  const payload = {
    ok: true,
    service: "kyanet-workstation",
    time: nowIso()
  };

  if (config.healthExposeCounts) {
    const counts = await getHealthCounts();
    payload.feedbackCount = counts.feedbackCount;
    payload.worktaskCount = counts.worktaskCount;
  }

  res.json(payload);
}));

app.get("/api/public/config", (req, res) => {
  res.json({
    ok: true,
    data: {
      displayTimezone: config.displayTimezone,
      displayLocale: config.displayLocale,
      meowStatusRefreshMs: config.meowStatusRefreshMs
    }
  });
});

app.get("/api/public/highlights", asyncHandler(async (req, res) => {
  const data = await getHomeHighlights(6);
  res.json({
    ok: true,
    data
  });
}));

app.get("/api/public/meowstatus", asyncHandler(async (req, res) => {
  const settings = await getStatusSettings();
  const data = {
    state: "disabled",
    settings: {
      profileEnabled: config.meowStatusEnabled && settings.profile.enabled,
      minecraftEnabled: config.meowStatusEnabled && settings.minecraft.enabled
    },
    profile: null,
    minecraftWidgets: [],
    error: ""
  };

  if (!config.meowStatusEnabled || (!settings.profile.enabled && !settings.minecraft.enabled)) {
    return res.json({ ok: true, data });
  }

  try {
    const dashboard = await fetchMeowStatusDashboard({
      baseUrl: settings.profile.apiBaseUrl,
      timeoutMs: settings.profile.timeoutMs
    });
    if (settings.profile.enabled) {
      data.profile = dashboard.profile;
    }
    if (settings.minecraft.enabled) {
      data.minecraftWidgets = dashboard.minecraftWidgets;
    }
    data.state = "ok";
  } catch (error) {
    data.state = "unavailable";
    data.error = error && error.message ? error.message : "MeowStatus 状态加载失败";
  }

  return res.json({ ok: true, data });
}));

app.post("/api/feedback", submitLimiter, asyncHandler(async (req, res) => {
  const validation = validateFeedbackPayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }

  const data = validation.data;
  const id = await createFeedback(data);
  await queueNotifications("feedback", id);
  return res.status(201).json({
    ok: true,
    data: { id }
  });
}));

app.post("/api/worktask", submitLimiter, asyncHandler(async (req, res) => {
  const validation = validateWorktaskPayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }

  const data = validation.data;
  const id = await createWorktask(data);
  await queueNotifications("worktask", id);
  return res.status(201).json({
    ok: true,
    data: { id }
  });
}));

app.post("/api/admin/login",
  requireSameOriginForAdminMutation,
  requireJsonForAdminMutation,
  loginLimiter,
  asyncHandler(async (req, res) => {
  const validation = validateAdminLoginPayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }

  const { username, password } = validation.data;
  const admin = await getAdminByUsername(username);
  if (!admin) {
    return sendError(res, 401, "AUTH_FAILED", "用户名或密码错误");
  }

  const matched = bcrypt.compareSync(password, admin.password_hash);
  if (!matched) {
    return sendError(res, 401, "AUTH_FAILED", "用户名或密码错误");
  }

  const token = await createSessionForUser(admin, req);
  res.cookie(config.cookieName, token, buildSessionCookieOptions());

  return res.json({
    ok: true,
    data: { username: admin.username }
  });
}));

app.use("/api/admin", requireSameOriginForAdminMutation);
app.use("/api/admin", requireJsonForAdminMutation);
app.use("/api/admin", adminLimiter);

app.get("/api/admin/me", requireAdminSession, (req, res) => {
  res.json({
    ok: true,
    data: { username: req.adminUser.username }
  });
});

app.post("/api/admin/logout", requireAdminSession, asyncHandler(async (req, res) => {
  await destroySessionByCookieToken(req.adminToken);
  clearSessionCookie(res);
  res.json({ ok: true });
}));

app.post("/api/admin/feedback/export", requireAdminSession, asyncHandler(async (req, res) => {
  const validation = validateFeedbackExportPayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }
  const date = new Date().toISOString().slice(0, 10);
  return handleAdminCsvExport(req, res, {
    entityType: "feedback",
    filters: validation.data,
    filename: `feedback_export_${date}.csv`,
    columns: FEEDBACK_EXPORT_COLUMNS,
    fetchBatch: (limit, offset) => listFeedbackExportBatch(validation.data, limit, offset)
  });
}));

app.post("/api/admin/worktask/export", requireAdminSession, asyncHandler(async (req, res) => {
  const validation = validateWorktaskExportPayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }
  const date = new Date().toISOString().slice(0, 10);
  return handleAdminCsvExport(req, res, {
    entityType: "worktask",
    filters: validation.data,
    filename: `worktask_export_${date}.csv`,
    columns: WORKTASK_EXPORT_COLUMNS,
    fetchBatch: (limit, offset) => listWorktaskExportBatch(validation.data, limit, offset)
  });
}));

app.post("/api/admin/audit/list", requireAdminSession, asyncHandler(async (req, res) => {
  const validation = validateAuditListPayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }
  const data = await listAdminAudits(validation.data);
  return res.json({ ok: true, data });
}));

app.get("/api/admin/ai/status", requireAdminSession, asyncHandler(async (req, res) => {
  const data = await getAiProfileStatus();
  return res.json({ ok: true, data });
}));

app.post("/api/admin/ai/profiles/diagnose", requireAdminSession, aiDiagnosticsLimiter, asyncHandler(async (req, res) => {
  const validation = validateAiProfileDiagnosePayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }
  const requestAbortController = new AbortController();
  const abortOnClose = () => requestAbortController.abort();
  req.once("close", abortOnClose);
  try {
    const data = await diagnoseProfile({
      profileId: validation.data.profileId,
      requestId: req.requestId,
      actor: req.adminUser.username,
      signal: requestAbortController.signal
    });
    await recordAdminAction(req, "ai.profile.diagnose", "ai_profile", null, data.status === "passed" ? "success" : "failed", {
      profileId: data.profileId,
      protocol: data.protocol,
      model: data.model,
      status: data.status,
      outcome: data.outcome,
      reachable: data.checks && data.checks.reachable === true,
      responseJson: data.checks && data.checks.responseJson === true,
      textExtracted: data.checks && data.checks.textExtracted === true,
      probeMatched: data.checks && data.checks.probeMatched === true,
      responseWithinLimit: data.checks && data.checks.responseWithinLimit === true,
      usageReported: data.checks && data.checks.usageReported === true,
      durationMs: data.durationMs,
      reasoningEffortApplied: data.reasoningEffortApplied === true,
      providerRequestIdPresent: Boolean(data.providerRequestId),
      errorCode: data.errorCode || ""
    });
    return res.json({ ok: true, data });
  } catch (error) {
    await recordAdminAction(req, "ai.profile.diagnose", "ai_profile", null, auditResultForError(error), {
      profileId: validation.data.profileId,
      errorCode: error && error.code ? error.code : "AI_DIAGNOSTIC_FAILED"
    });
    if (error && error.code === "NOT_FOUND") {
      return sendAiProfileError(res, error);
    }
    return sendAiError(res, error);
  } finally {
    req.removeListener("close", abortOnClose);
  }
}));

app.get("/api/admin/ai/metrics", requireAdminSession, asyncHandler(async (req, res) => {
  const validation = validateAiMetricsQueryPayload(req.query || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }
  const to = nowIso();
  const from = new Date(Date.parse(to) - validation.data.hours * 60 * 60 * 1000).toISOString();
  try {
    const data = await summarizeAiRequestMetrics({ from, to });
    return res.json({ ok: true, data });
  } catch (error) {
    return sendAiError(res, error);
  }
}));

app.post("/api/admin/ai/profiles", requireAdminSession, asyncHandler(async (req, res) => {
  const validation = validateAiProfilePayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }
  try {
    const data = await saveProfile(validation.data);
    await recordAdminAction(req, "ai.profile.save", "ai_profile", null, "success", {
      profileId: data.id,
      protocol: data.protocol,
      model: data.model,
      keyConfigured: data.keyConfigured,
      reasoningEffort: data.reasoningEffort,
      ...getCopilotPromptInstructionMetadata(validation.data.promptInstruction)
    });
    return res.json({ ok: true, data });
  } catch (error) {
    await recordAdminAction(req, "ai.profile.save", "ai_profile", null, auditResultForError(error), {
      profileId: validation.data.id,
      protocol: validation.data.protocol,
      model: validation.data.model,
      reasoningEffort: validation.data.reasoningEffort,
      ...getCopilotPromptInstructionMetadata(validation.data.promptInstruction),
      errorCode: error && error.code ? error.code : "AI_PROFILE_WRITE_FAILED"
    });
    return sendAiProfileError(res, error);
  }
}));

app.post("/api/admin/ai/profiles/active", requireAdminSession, asyncHandler(async (req, res) => {
  const validation = validateAiProfileActivePayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }
  try {
    const data = await setActiveProfile(validation.data.profileId);
    await recordAdminAction(req, "ai.profile.active", "ai_profile", null, "success", {
      profileId: validation.data.profileId,
      active: Boolean(validation.data.profileId)
    });
    return res.json({ ok: true, data });
  } catch (error) {
    await recordAdminAction(req, "ai.profile.active", "ai_profile", null, auditResultForError(error), {
      profileId: validation.data.profileId,
      errorCode: error && error.code ? error.code : "AI_PROFILE_WRITE_FAILED"
    });
    return sendAiProfileError(res, error);
  }
}));

app.post("/api/admin/ai/profiles/delete", requireAdminSession, asyncHandler(async (req, res) => {
  const validation = validateAiProfileDeletePayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }
  try {
    const data = await deleteProfile(validation.data.profileId);
    await recordAdminAction(req, "ai.profile.delete", "ai_profile", null, "success", {
      profileId: validation.data.profileId
    });
    return res.json({ ok: true, data });
  } catch (error) {
    await recordAdminAction(req, "ai.profile.delete", "ai_profile", null, auditResultForError(error), {
      profileId: validation.data.profileId,
      errorCode: error && error.code ? error.code : "AI_PROFILE_WRITE_FAILED"
    });
    return sendAiProfileError(res, error);
  }
}));

app.post("/api/admin/ai/suggest", requireAdminSession, aiLimiter, asyncHandler(async (req, res) => {
  const validation = validateAiSuggestPayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }
  const requestAbortController = new AbortController();
  const abortOnClose = () => requestAbortController.abort();
  req.once("close", abortOnClose);
  try {
    const data = await generateSuggestion({
      ...validation.data,
      requestId: req.requestId,
      actor: req.adminUser.username,
      signal: requestAbortController.signal
    });
    return res.json({ ok: true, data });
  } catch (error) {
    return sendAiError(res, error);
  } finally {
    req.removeListener("close", abortOnClose);
  }
}));

app.get("/api/admin/ai/suggestions", requireAdminSession, asyncHandler(async (req, res) => {
  const validation = validateAiSuggestionsQueryPayload({
    entityType: req.query && req.query.entityType,
    entityId: req.query && req.query.entityId
  });
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }
  try {
    const data = await listSuggestions(validation.data);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendAiError(res, error);
  }
}));

app.post("/api/admin/ai/suggestions/decision", requireAdminSession, asyncHandler(async (req, res) => {
  const validation = validateAiSuggestionDecisionPayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }
  try {
    const data = await recordSuggestionDecision({
      ...validation.data,
      actor: req.adminUser.username
    });
    await recordAdminAction(req, "ai.suggestion.decision", "ai_suggestion", validation.data.suggestionId, "success", {
      suggestionId: validation.data.suggestionId,
      decision: validation.data.decision,
      fields: validation.data.fields
    });
    return res.json({ ok: true, data });
  } catch (error) {
    await recordAdminAction(req, "ai.suggestion.decision", "ai_suggestion", validation.data.suggestionId, auditResultForError(error), {
      suggestionId: validation.data.suggestionId,
      decision: validation.data.decision,
      fields: validation.data.fields,
      errorCode: error && error.code ? error.code : "AI_SUGGESTION_DECISION_FAILED"
    });
    return sendAiError(res, error);
  }
}));

app.get("/api/admin/ai/knowledge/status", requireAdminSession, asyncHandler(async (req, res) => {
  try {
    const data = await getKnowledgeStatus();
    return res.json({ ok: true, data });
  } catch (error) {
    return sendAiError(res, error);
  }
}));

app.post("/api/admin/ai/knowledge/reindex", requireAdminSession, asyncHandler(async (req, res) => {
  try {
    const data = await reindexKnowledge();
    await recordAdminAction(req, "ai.knowledge.reindex", "ai_knowledge", null, "success", {
      indexedFiles: data.summary && data.summary.indexedFiles,
      chunkCount: data.summary && data.summary.chunkCount,
      warningCount: Array.isArray(data.warnings) ? data.warnings.length : 0
    });
    return res.json({
      ok: true,
      data: {
        version: data.version,
        builtAt: data.builtAt,
        summary: data.summary,
        warnings: data.warnings
      }
    });
  } catch (error) {
    await recordAdminAction(req, "ai.knowledge.reindex", "ai_knowledge", null, auditResultForError(error), {
      errorCode: error && error.code ? error.code : "KNOWLEDGE_REINDEX_FAILED"
    });
    return sendAiError(res, error);
  }
}));

app.post("/api/admin/ai/knowledge/ask", requireAdminSession, aiKnowledgeLimiter, asyncHandler(async (req, res) => {
  const validation = validateAiKnowledgeAskPayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }
  const requestAbortController = new AbortController();
  const abortOnClose = () => requestAbortController.abort();
  req.once("close", abortOnClose);
  try {
    const data = await askKnowledge({
      ...validation.data,
      requestId: req.requestId,
      actor: req.adminUser.username,
      signal: requestAbortController.signal
    });
    await recordAdminAction(req, "ai.knowledge.ask", "ai_knowledge", data.id, "success", {
      answerId: data.id,
      rootId: validation.data.rootId,
      basis: data.basis,
      sourceCount: Array.isArray(data.sources) ? data.sources.length : 0
    });
    return res.json({ ok: true, data });
  } catch (error) {
    await recordAdminAction(req, "ai.knowledge.ask", "ai_knowledge", null, auditResultForError(error), {
      rootId: validation.data.rootId,
      errorCode: error && error.code ? error.code : "AI_KNOWLEDGE_FAILED"
    });
    return sendAiError(res, error);
  } finally {
    req.removeListener("close", abortOnClose);
  }
}));

app.get("/api/admin/ai/knowledge/history", requireAdminSession, asyncHandler(async (req, res) => {
  const validation = validateAiKnowledgeHistoryQueryPayload(req.query || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }
  try {
    const data = await listKnowledgeHistory(validation.data);
    return res.json({ ok: true, data });
  } catch (error) {
    return sendAiError(res, error);
  }
}));

app.post("/api/admin/ai/knowledge/history/delete", requireAdminSession, asyncHandler(async (req, res) => {
  const validation = validateAiKnowledgeAnswerDeletePayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }
  try {
    const deleted = await deleteKnowledgeAnswer(validation.data.id);
    if (!deleted) {
      await recordAdminAction(req, "ai.knowledge.history.delete", "ai_knowledge", validation.data.id, "not_found", {
        answerId: validation.data.id
      });
      return sendError(res, 404, "NOT_FOUND", "知识问答记录不存在");
    }
    await recordAdminAction(req, "ai.knowledge.history.delete", "ai_knowledge", validation.data.id, "success", {
      answerId: validation.data.id
    });
    return res.json({ ok: true, data: { deleted: 1 } });
  } catch (error) {
    await recordAdminAction(req, "ai.knowledge.history.delete", "ai_knowledge", validation.data.id, auditResultForError(error), {
      answerId: validation.data.id,
      errorCode: error && error.code ? error.code : "AI_KNOWLEDGE_DELETE_FAILED"
    });
    return sendAiError(res, error);
  }
}));

app.post("/api/admin/ai/knowledge/history/cleanup", requireAdminSession, asyncHandler(async (req, res) => {
  try {
    const deleted = await cleanupKnowledgeHistory(undefined, nowIso());
    await recordAdminAction(req, "ai.knowledge.history.cleanup", "ai_knowledge", null, "success", { deleted });
    return res.json({ ok: true, data: { deleted } });
  } catch (error) {
    await recordAdminAction(req, "ai.knowledge.history.cleanup", "ai_knowledge", null, "failed", {
      errorCode: error && error.code ? error.code : "AI_KNOWLEDGE_CLEANUP_FAILED"
    });
    return sendAiError(res, error);
  }
}));

app.post("/api/admin/ai/knowledge/settings", requireAdminSession, asyncHandler(async (req, res) => {
  const validation = validateAiKnowledgeSettingsPayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }
  try {
    const data = await setKnowledgeSettings(validation.data);
    await recordAdminAction(req, "ai.knowledge.settings", "ai_knowledge", null, "success", {
      autoCleanup: data.autoCleanup
    });
    return res.json({ ok: true, data });
  } catch (error) {
    await recordAdminAction(req, "ai.knowledge.settings", "ai_knowledge", null, auditResultForError(error), {
      autoCleanup: validation.data.autoCleanup,
      errorCode: error && error.code ? error.code : "AI_KNOWLEDGE_SETTINGS_FAILED"
    });
    return sendAiError(res, error);
  }
}));

app.get("/api/admin/status/settings", requireAdminSession, asyncHandler(async (req, res) => {
  const data = await getStatusSettings();
  res.json({ ok: true, data });
}));

app.post("/api/admin/status/profile", requireAdminSession, asyncHandler(async (req, res) => {
  const validation = validateStatusProfileSettingsPayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }

  const data = await updateStatusProfileSettings(validation.data);
  await recordAdminAction(req, "status.profile.update", "status", null, "success", {
    enabled: validation.data.enabled,
    timeoutMs: validation.data.timeoutMs
  });
  return res.json({ ok: true, data });
}));

app.post("/api/admin/status/minecraft", requireAdminSession, asyncHandler(async (req, res) => {
  const validation = validateMinecraftStatusSettingsPayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }

  const data = await updateMinecraftStatusSettings(validation.data);
  await recordAdminAction(req, "status.minecraft.update", "status", null, "success", {
    enabled: validation.data.enabled
  });
  return res.json({ ok: true, data });
}));

app.post("/api/admin/notify/smtp-test", requireAdminSession, asyncHandler(async (req, res) => {
  const validation = validateSmtpTestPayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }

  try {
    const result = await sendSmtpTestMail({
      to: validation.data.to,
      operator: req.adminUser.username
    });
    if (!result.sent) {
      await recordAdminAction(req, "notify.smtp_test", "notification", null, "failed", {
        provider: "smtp",
        errorCode: "SMTP_NOT_READY"
      });
      return sendError(res, 400, "SMTP_NOT_READY", "SMTP 未启用或配置不完整，请检查 .env 配置");
    }
    await recordAdminAction(req, "notify.smtp_test", "notification", null, "success", {
      provider: "smtp",
      recipientCount: Array.isArray(result.to) ? result.to.length : 0
    });
    return res.json({
      ok: true,
      data: {
        recipients: result.to
      }
    });
  } catch (error) {
    await recordAdminAction(req, "notify.smtp_test", "notification", null, "failed", {
      provider: "smtp",
      errorCode: error && error.code ? error.code : "SMTP_SEND_FAILED"
    });
    logger.error({
      route: "/api/admin/notify/smtp-test",
      error: error && error.message ? error.message : String(error)
    }, "smtp test failed");
    return sendError(res, 502, "SMTP_SEND_FAILED", "SMTP 发送失败，请检查账号、授权码和服务器连通性");
  }
}));

app.post("/api/admin/notify/webhook-test", requireAdminSession, asyncHandler(async (req, res) => {
  const validation = validateWebhookTestPayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }

  try {
    const result = await sendWebhookTestMessage({
      operator: req.adminUser.username,
      content: validation.data.content
    });

    if (!result.sent) {
      await recordAdminAction(req, "notify.webhook_test", "notification", null, "failed", {
        provider: "webhook",
        errorCode: "WEBHOOK_NOT_READY"
      });
      return sendError(res, 400, "WEBHOOK_NOT_READY", "Webhook 未启用或配置不完整，请检查 .env 配置");
    }
    if (result.okCount === 0 && result.failCount > 0) {
      await recordAdminAction(req, "notify.webhook_test", "notification", null, "failed", {
        provider: "webhook",
        okCount: result.okCount,
        failCount: result.failCount,
        errorCode: "WEBHOOK_SEND_FAILED"
      });
      const firstError = result.failures[0] && result.failures[0].error ? result.failures[0].error : "Webhook 推送失败";
      return sendError(res, 502, "WEBHOOK_SEND_FAILED", firstError);
    }

    await recordAdminAction(req, "notify.webhook_test", "notification", null, "success", {
      provider: "webhook",
      okCount: result.okCount,
      failCount: result.failCount
    });
    return res.json({
      ok: true,
      data: {
        okCount: result.okCount,
        failCount: result.failCount,
        firstError: result.failures[0] ? result.failures[0].error : ""
      }
    });
  } catch (error) {
    await recordAdminAction(req, "notify.webhook_test", "notification", null, "failed", {
      provider: "webhook",
      errorCode: error && error.code ? error.code : "WEBHOOK_SEND_FAILED"
    });
    logger.error({
      route: "/api/admin/notify/webhook-test",
      error: error && error.message ? error.message : String(error)
    }, "webhook test failed");
    return sendError(res, 502, "WEBHOOK_SEND_FAILED", "Webhook 发送失败，请检查 URL、密钥或网络连通性");
  }
}));

app.get("/api/admin/notifications", requireAdminSession, asyncHandler(async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
  const data = await listNotificationDeliveries({ status });
  return res.json({ ok: true, data });
}));

app.post("/api/admin/notifications/retry", requireAdminSession, asyncHandler(async (req, res) => {
  const id = Number.parseInt(req.body && req.body.id, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return sendError(res, 400, "INVALID_PAYLOAD", "id 不合法");
  }
  const changes = await retryNotificationDelivery(id);
  if (changes === 0) {
    await recordAdminAction(req, "notification.retry", "notification", id, "not_found", {
      deliveryId: id
    });
    return sendError(res, 404, "NOT_FOUND", "通知记录不存在");
  }
  await recordAdminAction(req, "notification.retry", "notification", id, "success", {
    deliveryId: id
  });
  // Manual retry only schedules the durable delivery attempt. Do not make the
  // admin request wait on every due provider target or its network timeout.
  processNotificationOutbox().catch((error) => {
    logger.error({
      event: "notification.worker.error",
      error: error && error.message ? error.message : String(error)
    }, "notification worker failed");
  });
  return res.json({ ok: true });
}));

app.get("/api/admin/notification-handoffs", requireAdminSession, asyncHandler(async (req, res) => {
  const rawLimit = Number.parseInt(req.query && req.query.limit, 10);
  const limit = Number.isSafeInteger(rawLimit) && rawLimit > 0 ? rawLimit : undefined;
  const data = await listNotificationHandoffs({ dbPath: config.dbPath, limit });
  return res.json({ ok: true, data });
}));

app.post("/api/admin/notification-handoffs/retry", requireAdminSession, asyncHandler(async (req, res) => {
  const validation = validateNotificationHandoffRetryPayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }
  const handoffId = validation.data.handoffId;

  const result = await retryNotificationHandoff({
    dbPath: config.dbPath,
    handoffId,
    enqueue: ({ entityType, entityId, providers }) => enqueueNotificationDeliveries({ entityType, entityId, providers })
  });
  if (result.status === "missing") {
    await recordAdminAction(req, "notification_handoff.retry", "notification_handoff", null, "not_found", {
      handoffId
    });
    return sendError(res, 404, "NOT_FOUND", "补偿记录不存在");
  }
  await recordAdminAction(req, "notification_handoff.retry", "notification_handoff", null, result.persisted === false ? "failed" : "success", {
    handoffId,
    attempts: Number.isSafeInteger(result.attempts) && result.attempts >= 0 ? result.attempts : 0,
    persisted: result.persisted !== false,
    replayed: Boolean(result.replayed),
    errorCode: result.persisted === false ? "HANDOFF_PERSISTENCE_FAILED" : ""
  });
  if (result.persisted === false) {
    logger.error({
      event: "notification.handoff.persistence.error",
      handoffId,
      status: result.status
    }, "notification handoff state was not persisted");
  }
  if (result.status === "resolved" && !result.replayed) {
    processNotificationOutbox().catch((error) => {
      logger.error({
        event: "notification.worker.error",
        error: sanitizeNotificationError(error)
      }, "notification worker failed");
    });
  }
  return res.json({
    ok: true,
    data: {
      handoffId: result.handoffId,
      status: result.status,
      attempts: result.attempts,
      persisted: result.persisted !== false
    }
  });
}));

app.post("/api/admin/feedback/list", requireAdminSession, asyncHandler(async (req, res) => {
  const validation = validateListPayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }
  const data = await listFeedback(validation.data);
  res.json({ ok: true, data });
}));

app.post("/api/admin/feedback/status", requireAdminSession, asyncHandler(async (req, res) => {
  const validation = validateStatusPayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }

  const { id, status } = validation.data;
  const changes = await updateFeedbackStatus(id, status);
  if (changes === 0) {
    await recordAdminAction(req, "feedback.status", "feedback", id, "not_found", { status });
    return sendError(res, 404, "NOT_FOUND", "反馈记录不存在");
  }
  await recordAdminAction(req, "feedback.status", "feedback", id, "success", { status });
  return res.json({ ok: true });
}));

app.post("/api/admin/feedback/delete", requireAdminSession, asyncHandler(async (req, res) => {
  const validation = validateDeletePayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }

  const changes = await deleteFeedback(validation.data.id);
  if (changes === 0) {
    await recordAdminAction(req, "feedback.delete", "feedback", validation.data.id, "not_found");
    return sendError(res, 404, "NOT_FOUND", "反馈记录不存在");
  }
  await recordAdminAction(req, "feedback.delete", "feedback", validation.data.id, "success");
  return res.json({ ok: true });
}));

app.post("/api/admin/feedback/home-display", requireAdminSession, asyncHandler(async (req, res) => {
  const validation = validateHomeDisplayPayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }

  const changes = await updateFeedbackHomeDisplay(validation.data.id, validation.data.showOnHome);
  if (changes === 0) {
    await recordAdminAction(req, "feedback.home_display", "feedback", validation.data.id, "not_found", {
      showOnHome: validation.data.showOnHome
    });
    return sendError(res, 404, "NOT_FOUND", "反馈记录不存在");
  }
  await recordAdminAction(req, "feedback.home_display", "feedback", validation.data.id, "success", {
    showOnHome: validation.data.showOnHome
  });
  return res.json({ ok: true });
}));

app.post("/api/admin/feedback/note-reply", requireAdminSession, asyncHandler(async (req, res) => {
  const validation = validateNoteReplyPayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }

  const changes = await updateFeedbackNoteReply(
    validation.data.id,
    validation.data.adminNote,
    validation.data.publicReply
  );
  if (changes === 0) {
    await recordAdminAction(req, "feedback.note_reply", "feedback", validation.data.id, "not_found", {
      fields: ["adminNote", "publicReply"],
      adminNoteLength: validation.data.adminNote.length,
      publicReplyLength: validation.data.publicReply.length
    });
    return sendError(res, 404, "NOT_FOUND", "反馈记录不存在");
  }
  await recordAdminAction(req, "feedback.note_reply", "feedback", validation.data.id, "success", {
    fields: ["adminNote", "publicReply"],
    adminNoteLength: validation.data.adminNote.length,
    publicReplyLength: validation.data.publicReply.length
  });
  return res.json({ ok: true });
}));

app.post("/api/admin/worktask/list", requireAdminSession, asyncHandler(async (req, res) => {
  const validation = validateWorktaskListPayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }

  const data = await listWorktask(validation.data);
  res.json({ ok: true, data });
}));

app.post("/api/admin/worktask/create", requireAdminSession, asyncHandler(async (req, res) => {
  const validation = validateAdminWorktaskCreatePayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }

  const id = await createWorktaskByAdmin(validation.data);
  await queueNotifications("worktask", id);
  await recordAdminAction(req, "worktask.create", "worktask", id, "success", {
    priority: validation.data.priority,
    status: validation.data.status || "new",
    showOnHome: validation.data.showOnHome,
    fields: ["expectedAt", "scheduledAt", "assignee", "tags", "adminNote", "publicReply"]
  });
  return res.status(201).json({
    ok: true,
    data: { id }
  });
}));

app.post("/api/admin/worktask/status", requireAdminSession, asyncHandler(async (req, res) => {
  const validation = validateWorktaskStatusPayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }

  const { id, status } = validation.data;
  const changes = await updateWorktaskStatus(id, status);
  if (changes === 0) {
    await recordAdminAction(req, "worktask.status", "worktask", id, "not_found", { status });
    return sendError(res, 404, "NOT_FOUND", "WorkTask 记录不存在");
  }
  await recordAdminAction(req, "worktask.status", "worktask", id, "success", { status });
  return res.json({ ok: true });
}));

app.post("/api/admin/worktask/arrange", requireAdminSession, asyncHandler(async (req, res) => {
  const validation = validateWorktaskArrangePayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }

  const changes = await arrangeWorktask(validation.data);
  if (changes === 0) {
    await recordAdminAction(req, "worktask.arrange", "worktask", validation.data.id, "not_found", {
      assigneeProvided: validation.data.assigneeProvided,
      scheduledAtProvided: validation.data.scheduledAtProvided,
      statusProvided: validation.data.statusProvided
    });
    return sendError(res, 404, "NOT_FOUND", "WorkTask 记录不存在");
  }
  await recordAdminAction(req, "worktask.arrange", "worktask", validation.data.id, "success", {
    assigneeProvided: validation.data.assigneeProvided,
    scheduledAtProvided: validation.data.scheduledAtProvided,
    statusProvided: validation.data.statusProvided,
    cleared: Boolean((validation.data.assigneeProvided && !validation.data.assignee) || (validation.data.scheduledAtProvided && !validation.data.scheduledAt))
  });
  return res.json({ ok: true });
}));

app.post("/api/admin/worktask/delete", requireAdminSession, asyncHandler(async (req, res) => {
  const validation = validateDeletePayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }

  const changes = await deleteWorktask(validation.data.id);
  if (changes === 0) {
    await recordAdminAction(req, "worktask.delete", "worktask", validation.data.id, "not_found");
    return sendError(res, 404, "NOT_FOUND", "WorkTask 记录不存在");
  }
  await recordAdminAction(req, "worktask.delete", "worktask", validation.data.id, "success");
  return res.json({ ok: true });
}));

app.post("/api/admin/worktask/home-display", requireAdminSession, asyncHandler(async (req, res) => {
  const validation = validateHomeDisplayPayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }

  const changes = await updateWorktaskHomeDisplay(validation.data.id, validation.data.showOnHome);
  if (changes === 0) {
    await recordAdminAction(req, "worktask.home_display", "worktask", validation.data.id, "not_found", {
      showOnHome: validation.data.showOnHome
    });
    return sendError(res, 404, "NOT_FOUND", "WorkTask 记录不存在");
  }
  await recordAdminAction(req, "worktask.home_display", "worktask", validation.data.id, "success", {
    showOnHome: validation.data.showOnHome
  });
  return res.json({ ok: true });
}));

app.post("/api/admin/worktask/note-reply", requireAdminSession, asyncHandler(async (req, res) => {
  const validation = validateNoteReplyPayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }

  const changes = await updateWorktaskNoteReply(
    validation.data.id,
    validation.data.adminNote,
    validation.data.publicReply
  );
  if (changes === 0) {
    await recordAdminAction(req, "worktask.note_reply", "worktask", validation.data.id, "not_found", {
      fields: ["adminNote", "publicReply"],
      adminNoteLength: validation.data.adminNote.length,
      publicReplyLength: validation.data.publicReply.length
    });
    return sendError(res, 404, "NOT_FOUND", "WorkTask 记录不存在");
  }
  await recordAdminAction(req, "worktask.note_reply", "worktask", validation.data.id, "success", {
    fields: ["adminNote", "publicReply"],
    adminNoteLength: validation.data.adminNote.length,
    publicReplyLength: validation.data.publicReply.length
  });
  return res.json({ ok: true });
}));

app.use(express.static(path.resolve(__dirname, "..", "public")));

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return sendError(res, 404, "NOT_FOUND", "接口不存在");
  }
  return res.status(404).send("Not Found");
});

app.use((err, req, res, next) => {
  const reqLogger = req && req.log ? req.log : logger;
  reqLogger.error({
    event: "request.error",
    requestId: req && req.requestId ? req.requestId : "",
    error: err && err.message ? err.message : String(err)
  }, "unhandled request error");
  if (res.headersSent) {
    return next(err);
  }
  return sendError(res, 500, "INTERNAL_ERROR", "服务器内部错误");
});

async function startServer() {
  const configCheck = validateRuntimeConfig(config);
  if (!configCheck.valid) {
    const error = new Error(`运行配置无效：${configCheck.errors.join("；")}`);
    error.code = "INVALID_RUNTIME_CONFIG";
    throw error;
  }
  await initializeDatabase();
  const bootstrapResult = await ensureBootstrapAdmin();
  if (bootstrapResult.created) {
    logger.info("bootstrap admin user created from environment variables");
  }
  if (!bootstrapResult.created && bootstrapResult.reason === "missing_bootstrap_credentials") {
    logger.warn("admin_user is empty. Set ADMIN_USERNAME and ADMIN_PASSWORD or run npm run init-admin");
  }

  await cleanupExpiredSessions();
  cleanupKnowledgeHistoryIfEnabled(undefined, nowIso()).catch((error) => {
    logger.warn({
      event: "ai.knowledge.history.cleanup.error",
      errorCode: error && error.code ? error.code : "AI_KNOWLEDGE_CLEANUP_FAILED"
    }, "knowledge history startup cleanup failed");
  });
  cleanupExpiredMetricsIfEnabled(nowIso()).catch((error) => {
    logger.warn({
      event: "ai.metrics.cleanup.error",
      errorCode: error && error.code ? error.code : "AI_METRICS_CLEANUP_FAILED"
    }, "AI metrics startup cleanup failed");
  });
  // Start the worker after bootstrap without delaying the HTTP listener on a
  // slow or unavailable external notification provider.
  processNotificationOutbox().catch((error) => {
    logger.error({
      event: "notification.worker.error",
      error: error && error.message ? error.message : String(error)
    }, "notification worker failed");
  });
  setInterval(() => {
    processNotificationOutbox().catch((error) => {
      logger.error({
        event: "notification.worker.error",
        error: error && error.message ? error.message : String(error)
      }, "notification worker failed");
    });
  }, 30 * 1000).unref();
  setInterval(() => {
    cleanupExpiredSessions().catch((error) => {
      logger.error({
        event: "session.cleanup.error",
        error: error && error.message ? error.message : String(error)
      }, "session cleanup failed");
    });
  }, 60 * 60 * 1000).unref();
  setInterval(() => {
    cleanupKnowledgeHistoryIfEnabled(undefined, nowIso()).catch((error) => {
      logger.warn({
        event: "ai.knowledge.history.cleanup.error",
        errorCode: error && error.code ? error.code : "AI_KNOWLEDGE_CLEANUP_FAILED"
      }, "knowledge history cleanup failed");
    });
  }, 60 * 60 * 1000).unref();
  setInterval(() => {
    cleanupExpiredMetricsIfEnabled(nowIso()).catch((error) => {
      logger.warn({
        event: "ai.metrics.cleanup.error",
        errorCode: error && error.code ? error.code : "AI_METRICS_CLEANUP_FAILED"
      }, "AI metrics cleanup failed");
    });
  }, 60 * 60 * 1000).unref();

  app.listen(config.port, config.listenHost, () => {
    logger.info({
      host: config.listenHost,
      port: config.port
    }, `server running at http://${config.listenHost}:${config.port}`);
  });
}

startServer().catch((error) => {
  logger.error({
    event: "bootstrap.error",
    error: error && error.message ? error.message : String(error)
  }, "failed to start server");
  process.exit(1);
});

