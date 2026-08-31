const ALLOWED_SUGGESTION_FIELDS = new Set(["summary", "category", "priority", "tags", "replyDraft"]);
const ALLOWED_AUDIT_FIELDS = new Set([
  ...ALLOWED_SUGGESTION_FIELDS,
  "adminNote", "publicReply", "expectedAt", "scheduledAt", "assignee", "showOnHome"
]);

const METADATA_RULES = Object.freeze({
  rowCount: "number",
  maxRows: "number",
  hasKeyword: "boolean",
  status: "string",
  priority: "string",
  showOnHome: "boolean",
  fields: "fields",
  adminNoteLength: "number",
  publicReplyLength: "number",
  assigneeProvided: "boolean",
  scheduledAtProvided: "boolean",
  statusProvided: "boolean",
  cleared: "boolean",
  profileId: "string",
  protocol: "string",
  model: "string",
  suggestionId: "number",
  decision: "decision",
  deliveryId: "number",
  handoffId: "string",
  provider: "string",
  okCount: "number",
  failCount: "number",
  enabled: "boolean",
  timeoutMs: "number",
  recipientCount: "number",
  errorCode: "errorCode",
  replayed: "boolean",
  persisted: "boolean",
  attempts: "number",
  keyConfigured: "boolean",
  active: "boolean"
});

function boundedString(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function isHttpUrlLike(value) {
  return /^(?:https?:)?\/\//i.test(value);
}

function sanitizeAuditMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  const normalized = {};
  for (const [key, rule] of Object.entries(METADATA_RULES)) {
    if (!Object.prototype.hasOwnProperty.call(metadata, key)) continue;
    const value = metadata[key];
    if (rule === "boolean" && typeof value === "boolean") {
      normalized[key] = value;
    } else if (rule === "number" && Number.isSafeInteger(value) && value >= 0) {
      normalized[key] = value;
    } else if (rule === "string" && typeof value === "string") {
      const bounded = boundedString(value, key === "model" ? 120 : key === "profileId" ? 128 : 64);
      // Model names are an audit summary only; never persist a provider URL
      // if a caller accidentally passes one instead of the model identifier.
      if (key !== "model" || !isHttpUrlLike(bounded)) {
        normalized[key] = bounded;
      }
    } else if (rule === "errorCode" && typeof value === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(value)) {
      normalized[key] = value;
    } else if (rule === "decision" && (value === "accepted" || value === "rejected")) {
      normalized[key] = value;
    } else if (rule === "fields" && Array.isArray(value)) {
      normalized[key] = value
        .filter((item) => typeof item === "string" && ALLOWED_AUDIT_FIELDS.has(item))
        .slice(0, ALLOWED_AUDIT_FIELDS.size);
    }
  }
  let serialized;
  try {
    serialized = JSON.stringify(normalized);
  } catch (_) {
    return {};
  }
  if (Buffer.byteLength(serialized, "utf8") > 2048) return {};
  return normalized;
}

module.exports = {
  ALLOWED_AUDIT_FIELDS,
  ALLOWED_SUGGESTION_FIELDS,
  METADATA_RULES,
  sanitizeAuditMetadata
};
