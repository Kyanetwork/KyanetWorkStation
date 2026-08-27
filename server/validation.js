const ALLOWED_TYPES = new Set(["Bug", "功能建议", "体验问题", "其他"]);
const ALLOWED_STATUS = new Set(["new", "reviewed", "resolved", "notplanned"]);

const ALLOWED_WORKTASK_TYPES = new Set(["WorkTask提交", "工单提交", "任务安排", "协作请求", "其他"]);
const ALLOWED_WORKTASK_STATUS = new Set(["new", "scheduled", "in_progress", "completed", "cancelled"]);
const ALLOWED_WORKTASK_PRIORITY = new Set(["low", "medium", "high", "urgent"]);
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
  validateHomeDisplayPayload,
  validateNoteReplyPayload,
  validateSmtpTestPayload,
  validateWebhookTestPayload,
  validateStatusProfileSettingsPayload,
  validateMinecraftStatusSettingsPayload
};
