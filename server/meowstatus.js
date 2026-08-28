const MAX_DASHBOARD_BYTES = 512 * 1024;
const MAX_FAVICON_TEXT_BYTES = 256 * 1024;
const MAX_FAVICON_BYTES = 128 * 1024;
const MAX_WIDGETS = 32;

const MAX_PROFILE_STATE_LENGTH = 64;
const MAX_PROFILE_NOTE_LENGTH = 1000;
const MAX_TIMESTAMP_LENGTH = 64;
const MAX_WIDGET_ID_LENGTH = 128;
const MAX_WIDGET_NAME_LENGTH = 200;
const MAX_PAYLOAD_TEXT_LENGTH = 1000;
const MAX_ERROR_LENGTH = 500;
const MAX_HOST_LENGTH = 255;

function normalizeBaseUrl(input) {
  const value = String(input || "").trim().replace(/\/+$/, "");
  if (!value) {
    return "";
  }
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) {
      return "";
    }
    if (url.username || url.password) {
      return "";
    }
    return url.toString().replace(/\/+$/, "");
  } catch (_) {
    return "";
  }
}

function boundedString(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.replace(/\u0000/g, "").slice(0, maxLength);
}

function boundedNumber(value, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER, integer = false } = {}) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) return null;
  if (integer && !Number.isInteger(number)) return null;
  return number;
}

function normalizeFaviconDataUrl(value) {
  if (typeof value !== "string") return "";
  if (Buffer.byteLength(value, "utf8") > MAX_FAVICON_TEXT_BYTES) return "";

  const match = /^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,([A-Za-z0-9+/]*={0,2})$/i.exec(value);
  if (!match || !match[2] || match[2].length % 4 !== 0) return "";

  let decoded;
  try {
    decoded = Buffer.from(match[2], "base64");
  } catch (_) {
    return "";
  }
  if (!decoded.length || decoded.length > MAX_FAVICON_BYTES) return "";
  if (decoded.toString("base64") !== match[2]) return "";

  const mime = match[1].toLowerCase();
  const isPng = mime === "image/png" && decoded.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = ["image/jpeg", "image/jpg"].includes(mime) && decoded.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  const isGif = mime === "image/gif" && (decoded.subarray(0, 6).toString("ascii") === "GIF87a" || decoded.subarray(0, 6).toString("ascii") === "GIF89a");
  const isWebp = mime === "image/webp" && decoded.subarray(0, 4).toString("ascii") === "RIFF" && decoded.subarray(8, 12).toString("ascii") === "WEBP";
  if (!isPng && !isJpeg && !isGif && !isWebp) return "";

  return `data:${mime};base64,${match[2]}`;
}

function normalizeWidgetConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return {};
  const normalized = {};
  const host = boundedString(config.host, MAX_HOST_LENGTH).trim();
  if (host) normalized.host = host;
  const port = boundedNumber(config.port, { minimum: 1, maximum: 65535, integer: true });
  if (port !== null) normalized.port = port;
  return normalized;
}

function toCamelMinecraftPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const serverSoftware = typeof payload.server_software === "string"
    ? payload.server_software
    : payload.serverSoftware;
  const favicon = typeof payload.favicon === "string" ? payload.favicon : payload.icon;
  const checkedAt = typeof payload.checked_at === "string" ? payload.checked_at : payload.checkedAt;
  return {
    provider: boundedString(payload.provider, 64),
    source: boundedString(payload.source, 64),
    target: boundedString(payload.target, MAX_HOST_LENGTH),
    online: typeof payload.online === "boolean" ? payload.online : null,
    motd: boundedString(payload.motd, MAX_PAYLOAD_TEXT_LENGTH),
    version: boundedString(payload.version, 200),
    serverSoftware: boundedString(serverSoftware, 200),
    playersOnline: boundedNumber(payload.players_online ?? payload.playersOnline, { minimum: 0, maximum: 100000000, integer: true }),
    playersMax: boundedNumber(payload.players_max ?? payload.playersMax, { minimum: 0, maximum: 100000000, integer: true }),
    latencyMs: boundedNumber(payload.latency_ms ?? payload.latencyMs, { minimum: 0, maximum: 24 * 60 * 60 * 1000 }),
    favicon: normalizeFaviconDataUrl(favicon),
    checkedAt: boundedString(checkedAt, MAX_TIMESTAMP_LENGTH)
  };
}

function normalizeDashboard(raw) {
  const root = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const profile = root.profile_status && typeof root.profile_status === "object" && !Array.isArray(root.profile_status)
    ? root.profile_status
    : {};
  const widgets = Array.isArray(root.widgets) ? root.widgets : [];
  const minecraftWidgets = [];

  for (const widget of widgets) {
    if (!widget || typeof widget !== "object" || Array.isArray(widget)) continue;
    if (!["minecraft-java", "minecraft-bedrock"].includes(widget.kind)) continue;
    minecraftWidgets.push({
      id: boundedString(widget.id, MAX_WIDGET_ID_LENGTH),
      kind: widget.kind,
      name: boundedString(widget.name, MAX_WIDGET_NAME_LENGTH) || "Minecraft Server",
      enabled: widget.enabled === undefined ? true : widget.enabled === true,
      config: normalizeWidgetConfig(widget.config),
      lastPayload: toCamelMinecraftPayload(widget.last_payload),
      lastUpdatedAt: boundedString(widget.last_updated_at, MAX_TIMESTAMP_LENGTH),
      lastError: boundedString(widget.last_error, MAX_ERROR_LENGTH),
      lastErrorCode: boundedString(widget.last_error_code, 128)
    });
    if (minecraftWidgets.length >= MAX_WIDGETS) break;
  }

  return {
    profile: {
      state: boundedString(profile.state, MAX_PROFILE_STATE_LENGTH),
      note: boundedString(profile.note, MAX_PROFILE_NOTE_LENGTH),
      updatedAt: boundedString(profile.updated_at, MAX_TIMESTAMP_LENGTH)
    },
    minecraftWidgets
  };
}

function contentLengthExceeds(response, maxBytes) {
  const value = response.headers && response.headers.get ? response.headers.get("content-length") : "";
  if (!value || !/^\d+$/.test(value.trim())) return false;
  return Number(value) > maxBytes;
}

async function readResponseTextBounded(response, maxBytes) {
  if (contentLengthExceeds(response, maxBytes)) {
    throw new Error("MeowStatus API 响应体过大");
  }

  if (!response.body || typeof response.body.getReader !== "function") {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new Error("MeowStatus API 响应体过大");
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error("MeowStatus API 响应体过大");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes).toString("utf8");
}

function isJsonContentType(response) {
  const contentType = response.headers && response.headers.get
    ? response.headers.get("content-type")
    : "";
  const mime = String(contentType || "").split(";", 1)[0].trim().toLowerCase();
  return mime === "application/json" || mime.endsWith("+json");
}

async function fetchMeowStatusDashboard({ baseUrl, timeoutMs }) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!normalizedBaseUrl) {
    throw new Error("MeowStatus API 地址未配置或格式不正确");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Math.min(Number(timeoutMs) || 5000, 15000)));
  try {
    const response = await fetch(`${normalizedBaseUrl}/api/dashboard`, {
      headers: { "User-Agent": "KyanetWorkStation/1.0" },
      signal: controller.signal
    });
    const body = await readResponseTextBounded(response, MAX_DASHBOARD_BYTES);
    if (!response.ok) {
      throw new Error(`MeowStatus API 返回 HTTP ${response.status}`);
    }
    if (!isJsonContentType(response)) {
      throw new Error("MeowStatus API 响应 MIME 不是 JSON");
    }

    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (_) {
      throw new Error("MeowStatus API 返回了无效 JSON");
    }
    return normalizeDashboard(parsed);
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error("MeowStatus API 请求超时");
    }
    const message = error && error.message ? error.message : String(error || "");
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|network/i.test(message)) {
      throw new Error("MeowStatus API 不可达，请确认 MeowStatus 已启动且地址正确");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  fetchMeowStatusDashboard,
  normalizeBaseUrl,
  normalizeDashboard,
  normalizeFaviconDataUrl,
  toCamelMinecraftPayload,
  MAX_DASHBOARD_BYTES,
  MAX_FAVICON_BYTES,
  MAX_FAVICON_TEXT_BYTES
};
