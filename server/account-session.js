const crypto = require("crypto");
const config = require("./config");
const {
  nowIso,
  createAccountSessionRecord,
  deleteAccountSessionByTokenHash,
  findAccountSessionByTokenHash,
  deleteAccountSessionById,
  touchAccountSessionLastSeen
} = require("./db");
const { sendError } = require("./errors");

const accountCookieName = config.account.cookieName;

function hashToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

function generateSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

function buildAccountSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict",
    secure: config.isProduction,
    path: "/",
    maxAge: config.account.sessionTtlHours * 60 * 60 * 1000
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

function clearAccountSessionCookie(res) {
  res.clearCookie(accountCookieName, buildClearCookieOptions());
}

async function createAccountSessionForUser(user, req) {
  const rawToken = generateSessionToken();
  const tokenHash = hashToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.account.sessionTtlHours * 60 * 60 * 1000).toISOString();
  const nowText = now.toISOString();

  await createAccountSessionRecord({
    accountUserId: user.id,
    accountEmail: user.email,
    accountDisplayName: user.displayName || "",
    tokenHash,
    ip: req.ip || "",
    userAgent: req.get("user-agent") || "",
    createdAt: nowText,
    expiresAt,
    lastSeenAt: nowText
  });

  return rawToken;
}

async function destroyAccountSessionByCookieToken(rawToken) {
  if (!rawToken) {
    return;
  }
  await deleteAccountSessionByTokenHash(hashToken(rawToken));
}

async function requireAccountSession(req, res, next) {
  try {
    const rawToken = req.cookies[accountCookieName];
    if (!rawToken) {
      return sendError(res, 401, "UNAUTHORIZED", "请先登录账号");
    }

    const row = await findAccountSessionByTokenHash(hashToken(rawToken));
    if (!row) {
      clearAccountSessionCookie(res);
      return sendError(res, 401, "UNAUTHORIZED", "账号登录无效，请重新登录");
    }

    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await deleteAccountSessionById(row.session_id);
      clearAccountSessionCookie(res);
      return sendError(res, 401, "UNAUTHORIZED", "账号登录已过期，请重新登录");
    }

    await touchAccountSessionLastSeen(row.session_id, nowIso());

    req.accountUser = {
      id: row.account_user_id,
      email: row.account_email,
      displayName: row.account_display_name || "",
      sessionId: row.session_id
    };
    req.accountToken = rawToken;
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  accountCookieName,
  buildAccountSessionCookieOptions,
  clearAccountSessionCookie,
  createAccountSessionForUser,
  destroyAccountSessionByCookieToken,
  requireAccountSession
};
