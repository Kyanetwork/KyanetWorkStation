const ALLOWED_TYPES = new Set(["Bug", "功能建议", "体验问题", "其他"]);
const ALLOWED_STATUS = new Set(["new", "reviewed", "resolved", "notplanned"]);

const ALLOWED_WORKTASK_TYPES = new Set(["WorkTask提交", "工单提交", "任务安排", "协作请求", "其他"]);
const ALLOWED_WORKTASK_STATUS = new Set(["new", "scheduled", "in_progress", "completed", "cancelled"]);
const ALLOWED_WORKTASK_PRIORITY = new Set(["low", "medium", "high", "urgent"]);
const ALLOWED_AI_PROTOCOLS = new Set(["openai-chat", "openai-responses", "anthropic-messages"]);
const ALLOWED_AI_SUGGESTION_FIELDS = new Set(["summary", "category", "priority", "tags", "replyDraft"]);
const AI_PROFILE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SIMPLE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SIMPLE_URL_PATTERN = /^https?:\/\/.+/i;

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNullableString(value, maxLen) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return "";
  }
  return normalized.slice(0, maxLen);
}

function hasOwn(payload, key) {
  return Boolean(payload && Object.prototype.hasOwnProperty.call(payload, key));
}

function isValidDateTime(value) {
  if (!value) return true;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

function normalizeEmailToken(token) {
  let value = normalizeString(token);
  if (!value) return "";

  const angleMatch = value.match(/<([^<>]+)>/);
  if (angleMatch && angleMatch[1]) {
    value = angleMatch[1].trim();
  }

  if (value.toLowerCase().startsWith("mailto:")) {
    value = value.slice(7);
  }

  value = value.replace(/^["']+|["']+$/g, "").trim();
  return value;
}

function parseEmailRecipients(input) {
  const raw = normalizeString(input);
  if (!raw) return [];
  return raw
    .split(/[,\n\r;，；]+/)
    .map(normalizeEmailToken)
    .filter(Boolean);
}

function validateFeedbackPayload(payload) {
  const type = normalizeString(payload.type);
  const title = normalizeString(payload.title);
  const content = normalizeString(payload.content);
  const contact = normalizeString(payload.contact);
  const images = Array.isArray(payload.images) ? payload.images : [];

  if (!ALLOWED_TYPES.has(type)) {
    return { valid: false, message: "type 必须是有效反馈类型" };
  }
  if (!title || title.length > 80) {
    return { valid: false, message: "title 长度必须在 1-80 之间" };
  }
  if (!content || content.length > 2000) {
    return { valid: false, message: "content 长度必须在 1-2000 之间" };
  }
  if (!contact || contact.length > 100) {
    return { valid: false, message: "contact 长度必须在 1-100 之间" };
  }

  if (images.length > 8) {
    return { valid: false, message: "images 最多 8 项" };
  }

  const sanitizedImages = images
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, 8);

  for (const image of sanitizedImages) {
    if (image.length > 500) {
      return { valid: false, message: "images 项长度不能超过 500" };
    }
  }

  return {
    valid: true,
    data: {
      type,
      title,
      content,
      contact,
      images: sanitizedImages
    }
  };
}

function validateWorktaskPayload(payload) {
  const type = normalizeString(payload.type);
  const title = normalizeString(payload.title);
  const content = normalizeString(payload.content);
  const contact = normalizeString(payload.contact);
  const priority = normalizeString(payload.priority).toLowerCase();
  const expectedAt = normalizeNullableString(payload.expectedAt, 40);
  const tags = normalizeNullableString(payload.tags, 200);

  if (!ALLOWED_WORKTASK_TYPES.has(type)) {
    return { valid: false, message: "type 必须是有效 WorkTask 类型" };
  }
  if (!title || title.length > 100) {
    return { valid: false, message: "title 长度必须在 1-100 之间" };
  }
  if (!content || content.length > 3000) {
    return { valid: false, message: "content 长度必须在 1-3000 之间" };
  }
  if (!contact || contact.length > 100) {
    return { valid: false, message: "contact 长度必须在 1-100 之间" };
  }
  if (!ALLOWED_WORKTASK_PRIORITY.has(priority)) {
    return { valid: false, message: "worktask priority 不合法" };
  }

  return {
    valid: true,
    data: {
      type,
      title,
      content,
      contact,
      priority,
      expectedAt,
      tags
    }
  };
}

function validateAdminWorktaskCreatePayload(payload) {
  const type = normalizeString(payload.type) || "任务安排";
  const title = normalizeString(payload.title);
  const content = normalizeString(payload.content);
  const priority = (normalizeString(payload.priority) || "medium").toLowerCase();
  const status = normalizeString(payload.status) || "";
  const expectedAt = normalizeNullableString(payload.expectedAt, 40);
  const scheduledAt = normalizeNullableString(payload.scheduledAt, 40);
  const assignee = normalizeNullableString(payload.assignee, 100);
  const tags = normalizeNullableString(payload.tags, 200);
  const adminNote = normalizeNullableString(payload.adminNote, 2000);
  const publicReply = normalizeNullableString(payload.publicReply, 2000);
  const showOnHome = parseBooleanLike(payload.showOnHome);

  if (!ALLOWED_WORKTASK_TYPES.has(type)) {
    return { valid: false, message: "type 必须是有效 WorkTask 类型" };
  }
  if (!title || title.length > 100) {
    return { valid: false, message: "title 长度必须在 1-100 之间" };
  }
  if (!content || content.length > 3000) {
    return { valid: false, message: "content 长度必须在 1-3000 之间" };
  }
  if (!ALLOWED_WORKTASK_PRIORITY.has(priority)) {
    return { valid: false, message: "worktask priority 不合法" };
  }
  if (status && !ALLOWED_WORKTASK_STATUS.has(status)) {
    return { valid: false, message: "worktask status 不合法" };
  }
  if (showOnHome === null) {
    return { valid: false, message: "showOnHome 必须为 true/false 或 1/0" };
  }

  return {
    valid: true,
    data: {
      type,
      title,
      content,
      priority,
      status,
      expectedAt,
      scheduledAt,
      assignee,
      tags,
      adminNote,
      publicReply,
      showOnHome
    }
  };
}

function validateAdminLoginPayload(payload) {
  const username = normalizeString(payload.username);
  const password = typeof payload.password === "string" ? payload.password : "";

  if (!username || username.length > 64) {
    return { valid: false, message: "username 不合法" };
  }
  if (!password || password.length > 256) {
    return { valid: false, message: "password 不合法" };
  }

  return { valid: true, data: { username, password } };
}

function validateListPayload(payload) {
  const status = normalizeString(payload.status);
  const keyword = normalizeString(payload.keyword);
  const page = Number.parseInt(payload.page, 10);
  const pageSize = Number.parseInt(payload.pageSize, 10);

  if (status && !ALLOWED_STATUS.has(status)) {
    return { valid: false, message: "status 不合法" };
  }

  if (keyword.length > 200) {
    return { valid: false, message: "keyword 过长" };
  }

  return {
    valid: true,
    data: {
      status,
      keyword,
      page: Number.isFinite(page) && page > 0 ? page : 1,
      pageSize: Number.isFinite(pageSize) && pageSize > 0 ? Math.min(pageSize, 100) : 20
    }
  };
}

function validateWorktaskListPayload(payload) {
  const status = normalizeString(payload.status);
  const keyword = normalizeString(payload.keyword);
  const priority = normalizeString(payload.priority).toLowerCase();
  const page = Number.parseInt(payload.page, 10);
  const pageSize = Number.parseInt(payload.pageSize, 10);

  if (status && !ALLOWED_WORKTASK_STATUS.has(status)) {
    return { valid: false, message: "worktask status 不合法" };
  }

  if (priority && !ALLOWED_WORKTASK_PRIORITY.has(priority)) {
    return { valid: false, message: "worktask priority 不合法" };
  }

  if (keyword.length > 200) {
    return { valid: false, message: "keyword 过长" };
  }

  return {
    valid: true,
    data: {
      status,
      keyword,
      priority,
      page: Number.isFinite(page) && page > 0 ? page : 1,
      pageSize: Number.isFinite(pageSize) && pageSize > 0 ? Math.min(pageSize, 100) : 20
    }
  };
}

function validateStatusPayload(payload) {
  const id = Number.parseInt(payload.id, 10);
  const status = normalizeString(payload.status);

  if (!Number.isFinite(id) || id <= 0) {
    return { valid: false, message: "id 不合法" };
  }
  if (!ALLOWED_STATUS.has(status)) {
    return { valid: false, message: "status 不合法" };
  }

  return { valid: true, data: { id, status } };
}

function validateWorktaskStatusPayload(payload) {
  const id = Number.parseInt(payload.id, 10);
  const status = normalizeString(payload.status);

  if (!Number.isFinite(id) || id <= 0) {
    return { valid: false, message: "id 不合法" };
  }
  if (!ALLOWED_WORKTASK_STATUS.has(status)) {
    return { valid: false, message: "worktask status 不合法" };
  }

  return { valid: true, data: { id, status } };
}

function validateWorktaskArrangePayload(payload) {
  const id = Number.parseInt(payload.id, 10);
  const assigneeProvided = hasOwn(payload, "assignee");
  const scheduledAtProvided = hasOwn(payload, "scheduledAt");
  const statusProvided = hasOwn(payload, "status");
  const assignee = assigneeProvided ? normalizeNullableString(payload.assignee, 100) : "";
  const scheduledAt = scheduledAtProvided ? normalizeNullableString(payload.scheduledAt, 40) : "";
  const status = statusProvided ? normalizeString(payload.status) : "";

  if (!Number.isFinite(id) || id <= 0) {
    return { valid: false, message: "id 不合法" };
  }
  if (!assigneeProvided && !scheduledAtProvided && !statusProvided) {
    return { valid: false, message: "请至少提供 assignee、scheduledAt 或 status 之一" };
  }
  if (assigneeProvided && payload.assignee !== null && typeof payload.assignee !== "string") {
    return { valid: false, message: "assignee 必须是字符串、null 或空字符串" };
  }
  if (scheduledAtProvided && payload.scheduledAt !== null && typeof payload.scheduledAt !== "string") {
    return { valid: false, message: "scheduledAt 必须是 ISO 时间、null 或空字符串" };
  }
  if (scheduledAt && !isValidDateTime(scheduledAt)) {
    return { valid: false, message: "scheduledAt 必须是有效时间" };
  }
  if (statusProvided && (!status || typeof payload.status !== "string")) {
    return { valid: false, message: "status 必须是有效 WorkTask 状态" };
  }
  if (status && !ALLOWED_WORKTASK_STATUS.has(status)) {
    return { valid: false, message: "worktask status 不合法" };
  }

  return {
    valid: true,
    data: {
      id,
      assignee,
      scheduledAt,
      status,
      assigneeProvided,
      scheduledAtProvided,
      statusProvided
    }
  };
}

function validateDeletePayload(payload) {
  const id = Number.parseInt(payload.id, 10);

  if (!Number.isFinite(id) || id <= 0) {
    return { valid: false, message: "id 不合法" };
  }

  return { valid: true, data: { id } };
}

function validateNotificationHandoffRetryPayload(payload) {
  const handoffId = normalizeString(payload.handoffId);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(handoffId)) {
    return { valid: false, message: "handoffId 不合法" };
  }
  return { valid: true, data: { handoffId } };
}

function parseBooleanLike(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }
  return null;
}

function validateHomeDisplayPayload(payload) {
  const id = Number.parseInt(payload.id, 10);
  const showOnHome = parseBooleanLike(payload.showOnHome);

  if (!Number.isFinite(id) || id <= 0) {
    return { valid: false, message: "id 不合法" };
  }
  if (showOnHome === null) {
    return { valid: false, message: "showOnHome 必须为 true/false 或 1/0" };
  }

  return { valid: true, data: { id, showOnHome } };
}

function validateNoteReplyPayload(payload) {
  const id = Number.parseInt(payload.id, 10);
  const adminNote = normalizeNullableString(payload.adminNote, 2000);
  const publicReply = normalizeNullableString(payload.publicReply, 2000);

  if (!Number.isFinite(id) || id <= 0) {
    return { valid: false, message: "id 不合法" };
  }

  return {
    valid: true,
    data: {
      id,
      adminNote,
      publicReply
    }
  };
}

function validateSmtpTestPayload(payload) {
  const toRaw = normalizeNullableString(payload.to, 1000);
  const recipients = parseEmailRecipients(toRaw);

  if (recipients.length > 10) {
    return { valid: false, message: "测试收件人最多 10 个" };
  }

  for (const recipient of recipients) {
    if (recipient.length > 320 || !SIMPLE_EMAIL_PATTERN.test(recipient)) {
      return { valid: false, message: "测试收件人邮箱格式不正确" };
    }
  }

  return {
    valid: true,
    data: {
      to: recipients
    }
  };
}

function validateWebhookTestPayload(payload) {
  const content = normalizeNullableString(payload.content, 300);
  return {
    valid: true,
    data: {
      content
    }
  };
}

function validateStatusProfileSettingsPayload(payload) {
  const enabled = parseBooleanLike(payload.enabled);
  const apiBaseUrl = normalizeNullableString(payload.apiBaseUrl, 300);
  const timeoutMs = Number.parseInt(payload.timeoutMs, 10);

  if (enabled === null) {
    return { valid: false, message: "enabled 必须为 true/false 或 1/0" };
  }
  if (apiBaseUrl && !SIMPLE_URL_PATTERN.test(apiBaseUrl)) {
    return { valid: false, message: "apiBaseUrl 必须是 http/https 地址" };
  }
  if (apiBaseUrl) {
    try {
      const parsedUrl = new URL(apiBaseUrl);
      if (parsedUrl.username || parsedUrl.password) {
        return { valid: false, message: "apiBaseUrl 不得包含账号或密码" };
      }
    } catch (_) {
      return { valid: false, message: "apiBaseUrl 必须是 http/https 地址" };
    }
  }

  return {
    valid: true,
    data: {
      enabled,
      apiBaseUrl,
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs >= 1000 ? timeoutMs : 5000
    }
  };
}

function validateMinecraftStatusSettingsPayload(payload) {
  const enabled = parseBooleanLike(payload.enabled);

  if (enabled === null) {
    return { valid: false, message: "enabled 必须为 true/false 或 1/0" };
  }

  return {
    valid: true,
    data: {
      enabled
    }
  };
}

function normalizeAiBaseUrl(value) {
  const raw = normalizeString(value);
  if (!raw || raw.length > 300 || !SIMPLE_URL_PATTERN.test(raw)) {
    return { valid: false, message: "baseUrl 必须是有效的 http/https 地址" };
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    return { valid: false, message: "baseUrl 必须是有效的 http/https 地址" };
  }
  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) {
    return { valid: false, message: "baseUrl 必须使用 http 或 https 协议" };
  }
  if (parsed.username || parsed.password) {
    return { valid: false, message: "baseUrl 不得包含账号或密码" };
  }
  if (parsed.search || parsed.hash) {
    return { valid: false, message: "baseUrl 不得包含 query 或 fragment" };
  }

  const normalized = `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/+$/, "");
  return { valid: true, value: normalized || `${parsed.protocol}//${parsed.host}` };
}

function validateAiProfilePayload(payload) {
  const body = payload && typeof payload === "object" ? payload : {};
  const hasId = hasOwn(body, "id") && body.id !== undefined && body.id !== null && body.id !== "";
  if (hasId && typeof body.id !== "string") {
    return { valid: false, message: "profile id 不合法" };
  }
  const id = normalizeString(body.id);
  const name = normalizeString(body.name);
  const protocol = normalizeString(body.protocol);
  const model = normalizeString(body.model);
  const keyProvided = hasOwn(body, "key");
  const key = keyProvided && typeof body.key === "string" ? body.key.trim() : "";

  if (id && !AI_PROFILE_ID_PATTERN.test(id)) {
    return { valid: false, message: "profile id 不合法" };
  }
  if (!name || name.length > 64) {
    return { valid: false, message: "name 长度必须在 1-64 之间" };
  }
  if (!ALLOWED_AI_PROTOCOLS.has(protocol)) {
    return { valid: false, message: "protocol 不是受支持的 AI 协议" };
  }
  const baseUrl = normalizeAiBaseUrl(body.baseUrl);
  if (!baseUrl.valid) {
    return baseUrl;
  }
  if (!model || model.length > 120) {
    return { valid: false, message: "model 长度必须在 1-120 之间" };
  }
  if (keyProvided && typeof body.key !== "string") {
    return { valid: false, message: "key 必须是字符串" };
  }
  if (key.length > 512) {
    return { valid: false, message: "key 长度不能超过 512" };
  }
  if (!id && !key) {
    return { valid: false, message: "新 profile 必须提供 key" };
  }

  return {
    valid: true,
    data: {
      id,
      name,
      protocol,
      baseUrl: baseUrl.value,
      model,
      key
    }
  };
}

function normalizeAiProfileIdPayload(payload, fieldName, message) {
  const body = payload && typeof payload === "object" ? payload : {};
  const raw = hasOwn(body, fieldName) ? body[fieldName] : "";
  if (raw !== undefined && raw !== null && raw !== "" && typeof raw !== "string") {
    return { valid: false, message: message || "profile id 不合法" };
  }
  const value = normalizeString(raw);
  if (!value) {
    return { valid: true, data: { profileId: "" } };
  }
  if (!AI_PROFILE_ID_PATTERN.test(value)) {
    return { valid: false, message: message || "profile id 不合法" };
  }
  return { valid: true, data: { profileId: value } };
}

function validateAiProfileActivePayload(payload) {
  const body = payload && typeof payload === "object" ? payload : {};
  const fieldName = hasOwn(body, "profileId") ? "profileId" : hasOwn(body, "activeProfileId") ? "activeProfileId" : "id";
  return normalizeAiProfileIdPayload(body, fieldName, "active profile id 不合法");
}

function validateAiProfileDeletePayload(payload) {
  const body = payload && typeof payload === "object" ? payload : {};
  const fieldName = hasOwn(body, "profileId") ? "profileId" : "id";
  const result = normalizeAiProfileIdPayload(body, fieldName, "profile id 不合法");
  if (result.valid && !result.data.profileId) {
    return { valid: false, message: "profile id 不合法" };
  }
  return result;
}

function validateAiEntityPayload(payload) {
  const body = payload && typeof payload === "object" ? payload : {};
  const entityType = normalizeString(body.entityType);
  const rawId = body.entityId;
  const entityId = typeof rawId === "number" ? rawId : Number(rawId);
  if (!["feedback", "worktask"].includes(entityType)) {
    return { valid: false, message: "entityType 不合法" };
  }
  if (!Number.isSafeInteger(entityId) || entityId <= 0) {
    return { valid: false, message: "entityId 不合法" };
  }
  return { valid: true, data: { entityType, entityId } };
}

function validateAiSuggestPayload(payload) {
  return validateAiEntityPayload(payload);
}

function validateAiSuggestionsQueryPayload(payload) {
  return validateAiEntityPayload(payload);
}

function validateAiSuggestionDecisionPayload(payload) {
  const body = payload && typeof payload === "object" ? payload : {};
  const rawId = body.suggestionId;
  const suggestionId = typeof rawId === "number" ? rawId : Number(rawId);
  const decision = normalizeString(body.decision);
  const fields = body.fields === undefined ? [] : body.fields;
  if (!Number.isSafeInteger(suggestionId) || suggestionId <= 0) {
    return { valid: false, message: "suggestionId 不合法" };
  }
  if (!["accepted", "rejected"].includes(decision)) {
    return { valid: false, message: "decision 不合法" };
  }
  if (!Array.isArray(fields) || fields.length > ALLOWED_AI_SUGGESTION_FIELDS.size) {
    return { valid: false, message: "fields 不合法" };
  }
  const normalizedFields = [];
  for (const field of fields) {
    if (typeof field === "string" && ALLOWED_AI_SUGGESTION_FIELDS.has(field) && !normalizedFields.includes(field)) {
      normalizedFields.push(field);
    }
  }
  return { valid: true, data: { suggestionId, decision, fields: normalizedFields } };
}

module.exports = {
  ALLOWED_STATUS,
  ALLOWED_TYPES,
  ALLOWED_WORKTASK_STATUS,
  ALLOWED_WORKTASK_TYPES,
  ALLOWED_WORKTASK_PRIORITY,
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
  validateNotificationHandoffRetryPayload,
  validateHomeDisplayPayload,
  validateNoteReplyPayload,
  validateSmtpTestPayload,
  validateWebhookTestPayload,
  validateStatusProfileSettingsPayload,
  validateMinecraftStatusSettingsPayload,
  ALLOWED_AI_PROTOCOLS,
  ALLOWED_AI_SUGGESTION_FIELDS,
  validateAiProfilePayload,
  validateAiProfileActivePayload,
  validateAiProfileDeletePayload,
  validateAiSuggestPayload,
  validateAiSuggestionsQueryPayload,
  validateAiSuggestionDecisionPayload
};
