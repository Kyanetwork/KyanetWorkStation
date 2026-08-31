const db = require("./db");
const { logger } = require("./logger");
const {
  ALLOWED_AUDIT_FIELDS,
  ALLOWED_SUGGESTION_FIELDS,
  sanitizeAuditMetadata
} = require("./admin-audit-metadata");

function boundedString(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function auditErrorCode(error) {
  const code = error && error.code;
  if (typeof code === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(code)) return code;
  return "AUDIT_WRITE_FAILED";
}

async function recordAdminAuditSafely({
  req,
  action,
  entityType = "",
  entityId = null,
  result = "success",
  metadata = {},
  auditDb = db,
  auditLogger = (req && req.log) || logger
} = {}) {
  const adminUser = req && req.adminUser ? req.adminUser : {};
  const payload = {
    actorUserId: adminUser.id,
    actorUsername: adminUser.username,
    action,
    entityType,
    entityId,
    requestId: req && req.requestId,
    result,
    metadata: sanitizeAuditMetadata(metadata)
  };
  try {
    await auditDb.createAdminAudit(payload);
    return true;
  } catch (error) {
    const warning = {
      event: "admin.audit.write.error",
      requestId: boundedString(req && req.requestId, 120),
      action: boundedString(action, 64),
      errorCode: auditErrorCode(error)
    };
    try {
      auditLogger.warn(warning, "admin audit write failed");
    } catch (_) {
      // Logging is best effort at this boundary as well.
    }
    return false;
  }
}

module.exports = {
  sanitizeAuditMetadata,
  recordAdminAuditSafely,
  ALLOWED_AUDIT_FIELDS,
  ALLOWED_SUGGESTION_FIELDS
};
