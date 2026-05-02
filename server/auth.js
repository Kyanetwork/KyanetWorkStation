const crypto = require("crypto");
const config = require("./config");
const {
  nowIso,
  createSessionRecord,
  deleteSessionByTokenHash,
  findSessionWithUserByTokenHash,
  deleteSessionById,
  touchSessionLastSeen
} = require("./db");
const { sendError } = require("./errors");

function hashToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

function generateSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

function buildSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict",
    secure: config.isProduction,
    path: "/",
    maxAge: config.sessionTtlHours * 60 * 60 * 1000
  };
}

function buildClearCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict",
    secure: config.isProduction,
    path: "/"
  };
}

function clearSessionCookie(res) {
  res.clearCookie(config.cookieName, buildClearCookieOptions());
}

async function createSessionForUser(user, req) {
  const rawToken = generateSessionToken();
  const tokenHash = hashToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.sessionTtlHours * 60 * 60 * 1000).toISOString();
  const nowText = now.toISOString();

  await createSessionRecord({
    userId: user.id,
    tokenHash,
    ip: req.ip || "",
    userAgent: req.get("user-agent") || "",
    createdAt: nowText,
    expiresAt,
    lastSeenAt: nowText
  });

  return rawToken;
}

async function destroySessionByCookieToken(rawToken) {
  if (!rawToken) {
    return;
  }
  await deleteSessionByTokenHash(hashToken(rawToken));
}

async function requireAdminSession(req, res, next) {
  try {
    const rawToken = req.cookies[config.cookieName];
    if (!rawToken) {
      return sendError(res, 401, "UNAUTHORIZED", "请先登录管理员账号");
    }

    const tokenHash = hashToken(rawToken);
    const row = await findSessionWithUserByTokenHash(tokenHash);
    if (!row) {
      clearSessionCookie(res);
      return sendError(res, 401, "UNAUTHORIZED", "登录会话无效，请重新登录");
    }

    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await deleteSessionById(row.session_id);
      clearSessionCookie(res);
      return sendError(res, 401, "UNAUTHORIZED", "登录会话已过期，请重新登录");
    }

    await touchSessionLastSeen(row.session_id, nowIso());

    req.adminUser = {
      id: row.user_id,
      username: row.username,
      sessionId: row.session_id
    };
    req.adminToken = rawToken;
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  buildSessionCookieOptions,
  clearSessionCookie,
  createSessionForUser,
  destroySessionByCookieToken,
  requireAdminSession
};
