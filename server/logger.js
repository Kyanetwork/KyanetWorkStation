"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const pino = require("pino");
const config = require("./config");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function createLogger() {
  const streams = [{ stream: process.stdout }];

  if (config.logToFile) {
    ensureDir(config.logDir);
    const filePath = path.join(config.logDir, "app.log");
    streams.push({
      stream: pino.destination({
        dest: filePath,
        sync: false
      })
    });
  }

  return pino({
    name: "kyanet-workstation",
    level: config.logLevel,
    base: {
      service: "kyanet-workstation",
      env: config.nodeEnv
    },
    timestamp: pino.stdTimeFunctions.isoTime
  }, pino.multistream(streams));
}

const logger = createLogger();
const sensitiveQueryKeys = new Set(["ticket", "token", "secret", "password", "pass", "key"]);

function redactSensitiveUrl(value) {
  if (typeof value !== "string" || !value.includes("?")) {
    return value;
  }

  try {
    const url = new URL(value, "http://kws.local");
    let changed = false;
    for (const key of Array.from(url.searchParams.keys())) {
      if (sensitiveQueryKeys.has(key.toLowerCase())) {
        url.searchParams.set(key, "[redacted]");
        changed = true;
      }
    }
    if (!changed) {
      return value;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch (_) {
    return value.replace(/([?&](?:ticket|token|secret|password|pass|key)=)[^&#]*/gi, "$1[redacted]");
  }
}

function shouldSkipAccessLog(req) {
  if (!config.accessLogEnabled) {
    return true;
  }
  if (config.accessLogSkipHealth && req.path === "/api/health") {
    return true;
  }
  return false;
}

function requestLoggerMiddleware(req, res, next) {
  const requestId = String(req.get("x-request-id") || crypto.randomUUID()).slice(0, 120);
  const startedAt = process.hrtime.bigint();
  let finished = false;

  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);
  req.log = logger.child({ requestId });

  if (!shouldSkipAccessLog(req)) {
    req.log.info({
      event: "request.start",
      method: req.method,
      path: redactSensitiveUrl(req.originalUrl || req.url),
      ip: req.ip || "",
      userAgent: String(req.get("user-agent") || "").slice(0, 256)
    }, "request started");
  }

  function logFinish(eventType, forcedLevel) {
    if (finished) return;
    finished = true;
    if (shouldSkipAccessLog(req)) return;

    const durationMs = Number((process.hrtime.bigint() - startedAt) / 1000000n);
    const statusCode = Number(res.statusCode || 0);
    const level = forcedLevel || (
      statusCode >= 500 ? "error"
      : statusCode >= 400 ? "warn"
      : durationMs >= config.accessLogSlowMs ? "warn"
      : "info"
    );

    req.log[level]({
      event: eventType,
      method: req.method,
      path: redactSensitiveUrl(req.originalUrl || req.url),
      statusCode,
      durationMs
    }, eventType === "request.close" ? "request closed before finish" : "request completed");
  }

  res.on("finish", () => logFinish("request.finish"));
  res.on("close", () => {
    if (!res.writableEnded) {
      logFinish("request.close", "warn");
    }
  });

  next();
}

module.exports = {
  logger,
  redactSensitiveUrl,
  requestLoggerMiddleware
};

