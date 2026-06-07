require("dotenv").config();

const path = require("path");
const express = require("express");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");

const config = require("./config");
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
  listFeedback,
  listFeedbackByAccountUser,
  updateFeedbackStatus,
  updateFeedbackHomeDisplay,
  updateFeedbackNoteReply,
  deleteFeedback,
  listWorktask,
  listWorktaskByAccountUser,
  updateWorktaskStatus,
  updateWorktaskHomeDisplay,
  updateWorktaskNoteReply,
  arrangeWorktask,
  deleteWorktask,
  getHomeHighlights,
  getStatusSettings,
  updateStatusProfileSettings,
  updateMinecraftStatusSettings
} = require("./db");
const { fetchMeowStatusDashboard } = require("./meowstatus");
const { sendError } = require("./errors");
const {
  buildSessionCookieOptions,
  clearSessionCookie,
  createSessionForUser,
  destroySessionByCookieToken,
  requireAdminSession
} = require("./auth");
const {
  createPolicyCache,
  fetchWorkstationPolicy,
  exchangeLoginTicket
} = require("./account-auth");
const {
  accountCookieName,
  buildAccountSessionCookieOptions,
  clearAccountSessionCookie,
  createAccountSessionForUser,
  destroyAccountSessionByCookieToken,
  requireAccountSession
} = require("./account-session");
const {
  validateFeedbackPayload,
  validateWorktaskPayload,
  validateAdminWorktaskCreatePayload,
  validateAdminLoginPayload,
  validateListPayload,
  validateWorktaskListPayload,
  validateStatusPayload,
  validateWorktaskStatusPayload,
  validateWorktaskArrangePayload,
  validateDeletePayload,
  validateHomeDisplayPayload,
  validateNoteReplyPayload,
  validateSmtpTestPayload,
  validateWebhookTestPayload,
  validateStatusProfileSettingsPayload,
  validateMinecraftStatusSettingsPayload
} = require("./validation");
const {
  createRequireSameOriginForAdminMutation,
  requireJsonForAdminMutation
} = require("./security");

const app = express();
app.set("trust proxy", config.trustProxy);

const ACCOUNT_LOGIN_PATH = "/workstation/login";

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

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNotifyResultSkipped(result) {
  return Boolean(result && typeof result === "object" && result.sent === false);
}

function isNotifyResultRetryableFailure(result) {
  if (!result || typeof result !== "object") {
    return false;
  }
  if (result.ok === false) {
    return true;
  }
  if (typeof result.failCount === "number" && typeof result.okCount === "number") {
    return result.failCount > 0 && result.okCount === 0;
  }
  return false;
}

function notifyResultMessage(result) {
  if (!result || typeof result !== "object") {
    return "unknown notify result";
  }
  if (result.error) {
    return String(result.error);
  }
  if (typeof result.failCount === "number" && typeof result.okCount === "number") {
    return `ok=${result.okCount}, failed=${result.failCount}`;
  }
  return "notify failed";
}

async function runNotifyTask(taskName, taskFn, maxAttempts = 2) {
  let lastError = null;
  let lastResult = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      lastResult = await taskFn();
      if (isNotifyResultSkipped(lastResult)) {
        return {
          taskName,
          success: true,
          skipped: true,
          message: "skip (disabled or incomplete config)"
        };
      }

      const retryableFailure = isNotifyResultRetryableFailure(lastResult);
      if (!retryableFailure) {
        const partialFailure = Boolean(lastResult && typeof lastResult === "object" &&
          typeof lastResult.failCount === "number" &&
          typeof lastResult.okCount === "number" &&
          lastResult.failCount > 0 &&
          lastResult.okCount > 0);
        return {
          taskName,
          success: true,
          skipped: false,
          partialFailure,
          message: partialFailure ? notifyResultMessage(lastResult) : ""
        };
      }
      lastError = new Error(notifyResultMessage(lastResult));
    } catch (error) {
      lastError = error;
    }

    if (attempt < maxAttempts) {
      await sleep(300 * attempt);
    }
  }

  return {
    taskName,
    success: false,
    skipped: false,
    partialFailure: false,
    message: lastError && lastError.message ? lastError.message : "notify task failed",
    error: lastError
  };
}

function fireAndForget(taskName, taskPromiseFactory) {
  Promise.resolve()
    .then(taskPromiseFactory)
    .then((result) => {
      if (!Array.isArray(result)) return;
      for (const item of result) {
        if (!item || typeof item !== "object") continue;
        if (!item.success) {
          logger.error({ taskName, subTask: item.taskName, error: item.message }, "notify task failed");
          continue;
        }
        if (item.partialFailure) {
          logger.warn({ taskName, subTask: item.taskName, error: item.message }, "notify task partial failure");
        }
      }
    })
    .catch((error) => {
      logger.error({
        taskName,
        error: error && error.message ? error.message : String(error)
      }, "notify async task failed");
    });
}

const requireSameOriginForAdminMutation = createRequireSameOriginForAdminMutation({
  appBaseUrl: config.appBaseUrl,
  allowHeaderlessAdminMutation: config.allowHeaderlessAdminMutation,
  sendError
});

const accountPolicyCache = createPolicyCache({
  ttlMs: config.account.policyCacheMs,
  fetchPolicy: () => fetchWorkstationPolicy({
    baseUrl: config.account.baseUrl,
    secret: config.account.integrationSecret,
    timeoutMs: config.account.requestTimeoutMs
  })
});

function appOrigin(req) {
  try {
    return new URL(config.appBaseUrl).origin;
  } catch (_) {
    const host = req.get("host") || "";
    return host ? `${req.protocol || "http"}://${host}` : "http://127.0.0.1";
  }
}

function normalizeReturnPath(req, rawValue) {
  const fallback = "/";
  const raw = typeof rawValue === "string" && rawValue.trim() ? rawValue.trim() : fallback;
  const origin = appOrigin(req);

  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin) {
      return fallback;
    }
    return `${url.pathname}${url.search}${url.hash}` || fallback;
  } catch (_) {
    return fallback;
  }
}

function absoluteKwsReturnUrl(req, rawValue) {
  return new URL(normalizeReturnPath(req, rawValue), `${appOrigin(req)}/`).toString();
}

function accountLoginUrl(req) {
  const url = new URL(ACCOUNT_LOGIN_PATH, `${config.account.publicUrl.replace(/\/+$/, "")}/`);
  url.searchParams.set("returnUrl", absoluteKwsReturnUrl(req, req.query.returnUrl));
  return url.toString();
}

function accountSnapshot(accountUser) {
  if (!accountUser) {
    return {
      accountUserId: "",
      accountEmailSnapshot: "",
      accountDisplayNameSnapshot: ""
    };
  }
  return {
    accountUserId: accountUser.id,
    accountEmailSnapshot: accountUser.email,
    accountDisplayNameSnapshot: accountUser.displayName || ""
  };
}

function requireAccountForSubmission(kind) {
  return asyncHandler(async (req, res, next) => {
    const policy = await accountPolicyCache.getPolicy();
    const requiresLogin = kind === "feedback"
      ? policy.feedbackRequiresLogin !== false
      : policy.worktaskRequiresLogin !== false;
    const allowAnonymous = policy.allowAnonymousSubmission === true && !requiresLogin;
    const rawAccountToken = req.cookies[accountCookieName];

    if (!allowAnonymous && !rawAccountToken) {
      return sendError(res, 401, "UNAUTHORIZED", "提交前请先登录 KyanetAccount");
    }
    if (!rawAccountToken) {
      return next();
    }
    return requireAccountSession(req, res, next);
  });
}

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
    settings: {
      profileEnabled: settings.profile.enabled,
      minecraftEnabled: settings.minecraft.enabled
    },
    profile: null,
    minecraftWidgets: [],
    error: ""
  };

  if (!settings.profile.enabled && !settings.minecraft.enabled) {
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
  } catch (error) {
    data.error = error && error.message ? error.message : "MeowStatus 状态加载失败";
  }

  return res.json({ ok: true, data });
}));

app.get("/auth/account/start", (req, res) => {
  return res.redirect(accountLoginUrl(req));
});

async function handleAccountCallback(req, res) {
  const payload = req.method === "POST" ? (req.body || {}) : (req.query || {});
  const returnPath = normalizeReturnPath(req, payload.returnUrl);
  const user = await exchangeLoginTicket({
    ticket: payload.ticket,
    baseUrl: config.account.baseUrl,
    secret: config.account.integrationSecret,
    timeoutMs: config.account.requestTimeoutMs
  });
  const token = await createAccountSessionForUser(user, req);
  res.cookie(accountCookieName, token, buildAccountSessionCookieOptions());
  return res.redirect(returnPath);
}

app.get("/auth/account/callback", asyncHandler(handleAccountCallback));
app.post("/auth/account/callback", asyncHandler(handleAccountCallback));

app.get("/api/account/me", requireAccountSession, (req, res) => {
  res.json({
    ok: true,
    data: {
      id: req.accountUser.id,
      email: req.accountUser.email,
      displayName: req.accountUser.displayName || ""
    }
  });
});

app.post("/api/account/logout", requireAccountSession, asyncHandler(async (req, res) => {
  await destroyAccountSessionByCookieToken(req.accountToken);
  clearAccountSessionCookie(res);
  res.json({ ok: true });
}));

app.get("/api/account/feedback", requireAccountSession, asyncHandler(async (req, res) => {
  const data = await listFeedbackByAccountUser(req.accountUser.id);
  res.json({ ok: true, data });
}));

app.get("/api/account/worktask", requireAccountSession, asyncHandler(async (req, res) => {
  const data = await listWorktaskByAccountUser(req.accountUser.id);
  res.json({ ok: true, data });
}));

app.post("/api/feedback", submitLimiter, requireAccountForSubmission("feedback"), asyncHandler(async (req, res) => {
  const validation = validateFeedbackPayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }

  const data = {
    ...validation.data,
    ...accountSnapshot(req.accountUser)
  };
  const id = await createFeedback(data);
  fireAndForget("feedback", async () => Promise.all([
    runNotifyTask("smtp", () => notifyNewFeedback({
      id,
      ...data
    })),
    runNotifyTask("webhook", () => notifyWebhookNewFeedback({
      id,
      ...data
    }))
  ]));
  return res.status(201).json({
    ok: true,
    data: { id }
  });
}));

app.post("/api/worktask", submitLimiter, requireAccountForSubmission("worktask"), asyncHandler(async (req, res) => {
  const validation = validateWorktaskPayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }

  const data = {
    ...validation.data,
    ...accountSnapshot(req.accountUser)
  };
  const id = await createWorktask(data);
  fireAndForget("worktask", async () => Promise.all([
    runNotifyTask("smtp", () => notifyNewWorktask({
      id,
      source: "user",
      showOnHome: false,
      status: "new",
      ...data
    })),
    runNotifyTask("webhook", () => notifyWebhookNewWorktask({
      id,
      source: "user",
      showOnHome: false,
      status: "new",
      ...data
    }))
  ]));
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
  return res.json({ ok: true, data });
}));

app.post("/api/admin/status/minecraft", requireAdminSession, asyncHandler(async (req, res) => {
  const validation = validateMinecraftStatusSettingsPayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }

  const data = await updateMinecraftStatusSettings(validation.data);
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
      return sendError(res, 400, "SMTP_NOT_READY", "SMTP 未启用或配置不完整，请检查 .env 配置");
    }
    return res.json({
      ok: true,
      data: {
        recipients: result.to
      }
    });
  } catch (error) {
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
      return sendError(res, 400, "WEBHOOK_NOT_READY", "Webhook 未启用或配置不完整，请检查 .env 配置");
    }
    if (result.okCount === 0 && result.failCount > 0) {
      const firstError = result.failures[0] && result.failures[0].error ? result.failures[0].error : "Webhook 推送失败";
      return sendError(res, 502, "WEBHOOK_SEND_FAILED", firstError);
    }

    return res.json({
      ok: true,
      data: {
        okCount: result.okCount,
        failCount: result.failCount,
        firstError: result.failures[0] ? result.failures[0].error : ""
      }
    });
  } catch (error) {
    logger.error({
      route: "/api/admin/notify/webhook-test",
      error: error && error.message ? error.message : String(error)
    }, "webhook test failed");
    return sendError(res, 502, "WEBHOOK_SEND_FAILED", "Webhook 发送失败，请检查 URL、密钥或网络连通性");
  }
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
    return sendError(res, 404, "NOT_FOUND", "反馈记录不存在");
  }
  return res.json({ ok: true });
}));

app.post("/api/admin/feedback/delete", requireAdminSession, asyncHandler(async (req, res) => {
  const validation = validateDeletePayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }

  const changes = await deleteFeedback(validation.data.id);
  if (changes === 0) {
    return sendError(res, 404, "NOT_FOUND", "反馈记录不存在");
  }
  return res.json({ ok: true });
}));

app.post("/api/admin/feedback/home-display", requireAdminSession, asyncHandler(async (req, res) => {
  const validation = validateHomeDisplayPayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }

  const changes = await updateFeedbackHomeDisplay(validation.data.id, validation.data.showOnHome);
  if (changes === 0) {
    return sendError(res, 404, "NOT_FOUND", "反馈记录不存在");
  }
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
    return sendError(res, 404, "NOT_FOUND", "反馈记录不存在");
  }
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
  fireAndForget("worktask-admin-create", async () => Promise.all([
    runNotifyTask("smtp", () => notifyNewWorktask({
      id,
      source: "admin",
      ...validation.data
    })),
    runNotifyTask("webhook", () => notifyWebhookNewWorktask({
      id,
      source: "admin",
      ...validation.data
    }))
  ]));
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
    return sendError(res, 404, "NOT_FOUND", "WorkTask 记录不存在");
  }
  return res.json({ ok: true });
}));

app.post("/api/admin/worktask/arrange", requireAdminSession, asyncHandler(async (req, res) => {
  const validation = validateWorktaskArrangePayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }

  const changes = await arrangeWorktask(validation.data);
  if (changes === 0) {
    return sendError(res, 404, "NOT_FOUND", "WorkTask 记录不存在");
  }
  return res.json({ ok: true });
}));

app.post("/api/admin/worktask/delete", requireAdminSession, asyncHandler(async (req, res) => {
  const validation = validateDeletePayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }

  const changes = await deleteWorktask(validation.data.id);
  if (changes === 0) {
    return sendError(res, 404, "NOT_FOUND", "WorkTask 记录不存在");
  }
  return res.json({ ok: true });
}));

app.post("/api/admin/worktask/home-display", requireAdminSession, asyncHandler(async (req, res) => {
  const validation = validateHomeDisplayPayload(req.body || {});
  if (!validation.valid) {
    return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
  }

  const changes = await updateWorktaskHomeDisplay(validation.data.id, validation.data.showOnHome);
  if (changes === 0) {
    return sendError(res, 404, "NOT_FOUND", "WorkTask 记录不存在");
  }
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
    return sendError(res, 404, "NOT_FOUND", "WorkTask 记录不存在");
  }
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
  await initializeDatabase();
  const bootstrapResult = await ensureBootstrapAdmin();
  if (bootstrapResult.created) {
    logger.info("bootstrap admin user created from environment variables");
  }
  if (!bootstrapResult.created && bootstrapResult.reason === "missing_bootstrap_credentials") {
    logger.warn("admin_user is empty. Set ADMIN_USERNAME and ADMIN_PASSWORD or run npm run init-admin");
  }

  await cleanupExpiredSessions();
  setInterval(() => {
    cleanupExpiredSessions().catch((error) => {
      logger.error({
        event: "session.cleanup.error",
        error: error && error.message ? error.message : String(error)
      }, "session cleanup failed");
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

