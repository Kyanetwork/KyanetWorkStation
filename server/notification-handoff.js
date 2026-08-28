const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SUPPORTED_PROVIDERS = new Set(["smtp", "webhook"]);
const HANDOFF_STATUSES = new Set(["pending", "retrying", "resolved", "failed"]);
const MAX_HANDOFF_LINE_BYTES = 4096;
const MAX_HANDOFF_RECORDS = 200;
const MAX_RETRY_ATTEMPTS = 3;
const HANDOFF_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const appendQueues = new Map();

function getNotificationHandoffPath(dbPath) {
  return path.join(path.dirname(path.resolve(String(dbPath || "workstation.db"))), "notification-handoff.jsonl");
}

function oneLine(value, maxLength) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function sanitizeError(error) {
  let message = oneLine(error && error.message ? error.message : error, 1000);
  message = message
    .replace(/(?:https?|s?mtps?|mysql|postgres(?:ql)?):\/\/\S+/giu, "[redacted-url]")
    .replace(/[A-Z]:\\[^\s]+/giu, "[redacted-path]")
    .replace(/\b(?:password|pass|token|secret|key|authorization|signature|url|body|content|recipient|email)\s*[:=]\s*\S+/giu, "[redacted]")
    .replace(/\b(?:recipient|contact)\b/giu, "[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[redacted-email]");
  return message.slice(0, 240);
}

function normalizeProviders(providers) {
  if (!Array.isArray(providers)) return [];
  return [...new Set(providers
    .map((provider) => String(provider || "").trim().toLowerCase())
    .filter((provider) => SUPPORTED_PROVIDERS.has(provider)))];
}

function normalizeEntityId(value) {
  const id = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}

function normalizeRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  const handoffId = oneLine(record.handoffId, 80);
  const entityType = oneLine(record.entityType, 32);
  const entityId = normalizeEntityId(record.entityId);
  const eventId = oneLine(record.eventId, 100);
  const providers = normalizeProviders(record.providers);
  const status = HANDOFF_STATUSES.has(record.status) ? record.status : "pending";
  if (!HANDOFF_ID_PATTERN.test(handoffId) || !eventId || !entityType || !entityId || !providers.length) return null;
  return {
    handoffId,
    eventId,
    entityType,
    entityId,
    providers,
    status,
    attempts: Math.max(0, Math.min(MAX_RETRY_ATTEMPTS, normalizeEntityId(record.attempts))),
    lastError: sanitizeError(record.lastError),
    createdAt: oneLine(record.createdAt, 64),
    updatedAt: oneLine(record.updatedAt, 64)
  };
}

function serializeRecord(record) {
  const normalized = normalizeRecord(record);
  if (!normalized) throw new Error("invalid notification handoff record");
  let line = JSON.stringify(normalized);
  if (Buffer.byteLength(line, "utf8") > MAX_HANDOFF_LINE_BYTES) {
    normalized.lastError = "";
    line = JSON.stringify(normalized);
  }
  if (Buffer.byteLength(line, "utf8") > MAX_HANDOFF_LINE_BYTES) {
    throw new Error("notification handoff record is too large");
  }
  return `${line}\n`;
}

async function appendLine(filePath, line) {
  const previous = appendQueues.get(filePath) || Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    await fs.promises.appendFile(filePath, line, { encoding: "utf8", mode: 0o600 });
  });
  appendQueues.set(filePath, next);
  try {
    await next;
  } finally {
    if (appendQueues.get(filePath) === next) appendQueues.delete(filePath);
  }
}

async function appendRecord(dbPath, record) {
  const filePath = getNotificationHandoffPath(dbPath);
  const line = serializeRecord(record);
  try {
    await appendLine(filePath, line);
    return { persisted: true, handoffId: record.handoffId };
  } catch (error) {
    return { persisted: false, handoffId: record.handoffId, error: sanitizeError(error) };
  }
}

async function createNotificationHandoff({ dbPath, entityType, entityId, providers, error }) {
  const normalizedProviders = normalizeProviders(providers);
  const numericEntityId = normalizeEntityId(entityId);
  const type = oneLine(entityType, 32);
  if (!type || !numericEntityId || !normalizedProviders.length) {
    return { persisted: false, handoffId: "", error: "notification handoff input is incomplete" };
  }
  const now = new Date().toISOString();
  const record = {
    handoffId: crypto.randomUUID(),
    eventId: `${type}:${numericEntityId}`,
    entityType: type,
    entityId: numericEntityId,
    providers: normalizedProviders,
    status: "pending",
    attempts: 0,
    lastError: sanitizeError(error),
    createdAt: now,
    updatedAt: now
  };
  return appendRecord(dbPath, record);
}

async function listNotificationHandoffs({ dbPath, limit = MAX_HANDOFF_RECORDS } = {}) {
  const filePath = getNotificationHandoffPath(dbPath);
  let contents;
  try {
    contents = await fs.promises.readFile(filePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }

  const latest = new Map();
  for (const line of contents.split(/\r?\n/)) {
    if (!line || Buffer.byteLength(line, "utf8") > MAX_HANDOFF_LINE_BYTES) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (_) {
      continue;
    }
    const record = normalizeRecord(parsed);
    if (record) latest.set(record.eventId, record);
  }

  const requestedLimit = Number(limit);
  const safeLimit = Number.isSafeInteger(requestedLimit)
    ? Math.max(1, Math.min(MAX_HANDOFF_RECORDS, requestedLimit))
    : MAX_HANDOFF_RECORDS;
  return [...latest.values()]
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
    .slice(0, safeLimit);
}

async function appendState(dbPath, current, status, attempts, error) {
  const updated = {
    ...current,
    status,
    attempts,
    lastError: status === "resolved" ? "" : sanitizeError(error),
    updatedAt: new Date().toISOString()
  };
  return appendRecord(dbPath, updated);
}

async function retryNotificationHandoff({ dbPath, handoffId, enqueue }) {
  const requestedId = oneLine(handoffId, 80);
  const records = await listNotificationHandoffs({ dbPath, limit: MAX_HANDOFF_RECORDS });
  const current = records.find((record) => record.handoffId === requestedId);
  if (!current) return { status: "missing", handoffId: requestedId };
  if (current.status === "resolved") return { ...current, replayed: true };
  if (typeof enqueue !== "function") throw new Error("notification handoff enqueue callback is required");

  const attempts = Math.min(MAX_RETRY_ATTEMPTS, current.attempts + 1);
  try {
    await enqueue({
      entityType: current.entityType,
      entityId: current.entityId,
      providers: current.providers
    });
    const persisted = await appendState(dbPath, current, "resolved", attempts, "");
    return { ...current, status: "resolved", attempts, persisted: persisted.persisted };
  } catch (error) {
    const status = attempts >= MAX_RETRY_ATTEMPTS ? "failed" : "retrying";
    const persisted = await appendState(dbPath, current, status, attempts, error);
    return {
      ...current,
      status,
      attempts,
      lastError: sanitizeError(error),
      persisted: persisted.persisted
    };
  }
}

module.exports = {
  createNotificationHandoff,
  getNotificationHandoffPath,
  listNotificationHandoffs,
  normalizeProviders,
  retryNotificationHandoff,
  sanitizeError,
  MAX_HANDOFF_LINE_BYTES,
  MAX_RETRY_ATTEMPTS
};
