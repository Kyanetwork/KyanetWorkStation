"use strict";

function safeOriginFromUrl(rawValue) {
  if (!rawValue || typeof rawValue !== "string") return "";
  try {
    return new URL(rawValue).origin;
  } catch (_) {
    return "";
  }
}

function getForwardedFirstValue(headerValue) {
  if (!headerValue || typeof headerValue !== "string") return "";
  return headerValue.split(",")[0].trim();
}

function getRequestOrigin(req) {
  const forwardedProto = getForwardedFirstValue(req.get("x-forwarded-proto"));
  const forwardedHost = getForwardedFirstValue(req.get("x-forwarded-host"));
  const protocol = forwardedProto || req.protocol || "http";
  const host = forwardedHost || req.get("host") || "";
  return host ? `${protocol}://${host}` : "";
}

function createRequireSameOriginForAdminMutation(options) {
  const appBaseUrl = options && options.appBaseUrl ? options.appBaseUrl : "";
  const allowHeaderless = Boolean(options && options.allowHeaderlessAdminMutation);
  const sendError = options && options.sendError
    ? options.sendError
    : ((res, status, code, message) => res.status(status).json({ ok: false, error: { code, message } }));

  return function requireSameOriginForAdminMutation(req, res, next) {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
      return next();
    }

    const expectedOrigins = new Set();
    const requestOrigin = getRequestOrigin(req);
    const configuredOrigin = safeOriginFromUrl(appBaseUrl);
    if (requestOrigin) expectedOrigins.add(requestOrigin);
    if (configuredOrigin) expectedOrigins.add(configuredOrigin);

    const origin = safeOriginFromUrl(req.get("origin") || "");
    const refererOrigin = safeOriginFromUrl(req.get("referer") || "");

    if (origin && expectedOrigins.has(origin)) {
      return next();
    }
    if (!origin && refererOrigin && expectedOrigins.has(refererOrigin)) {
      return next();
    }

    if (origin || refererOrigin) {
      return sendError(res, 403, "CSRF_BLOCKED", "请求来源校验失败，请从管理页面发起请求");
    }

    const secFetchSite = String(req.get("sec-fetch-site") || "").trim().toLowerCase();
    if (secFetchSite && !["same-origin", "same-site", "none"].includes(secFetchSite)) {
      return sendError(res, 403, "CSRF_BLOCKED", "请求来源校验失败，请从管理页面发起请求");
    }

    if (allowHeaderless) {
      return next();
    }
    return sendError(res, 403, "CSRF_BLOCKED", "请求来源校验失败，请从管理页面发起请求");
  };
}

function requireJsonForAdminMutation(req, res, next) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return next();
  }
  if (!req.is("application/json")) {
    if (res && typeof res.status === "function" && typeof res.json === "function") {
      return res.status(415).json({
        ok: false,
        error: {
          code: "UNSUPPORTED_MEDIA_TYPE",
          message: "管理写接口仅支持 application/json"
        }
      });
    }
    return next(new Error("Unsupported content type"));
  }
  return next();
}

module.exports = {
  safeOriginFromUrl,
  getForwardedFirstValue,
  getRequestOrigin,
  createRequireSameOriginForAdminMutation,
  requireJsonForAdminMutation
};
