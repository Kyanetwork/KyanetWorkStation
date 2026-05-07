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
    return url.toString().replace(/\/+$/, "");
  } catch (_) {
    return "";
  }
}

function toCamelMinecraftPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  return {
    provider: payload.provider || "",
    source: payload.source || "",
    target: payload.target || "",
    online: payload.online === true,
    motd: payload.motd || "",
    version: payload.version || "",
    serverSoftware: payload.server_software || payload.serverSoftware || "",
    playersOnline: payload.players_online ?? payload.playersOnline ?? null,
    playersMax: payload.players_max ?? payload.playersMax ?? null,
    latencyMs: payload.latency_ms ?? payload.latencyMs ?? null,
    favicon: payload.favicon || payload.icon || "",
    checkedAt: payload.checked_at || payload.checkedAt || ""
  };
}

function normalizeDashboard(raw) {
  const profile = raw && raw.profile_status && typeof raw.profile_status === "object"
    ? raw.profile_status
    : {};
  const widgets = Array.isArray(raw && raw.widgets) ? raw.widgets : [];

  return {
    profile: {
      state: typeof profile.state === "string" ? profile.state : "",
      note: typeof profile.note === "string" ? profile.note : "",
      updatedAt: typeof profile.updated_at === "string" ? profile.updated_at : ""
    },
    minecraftWidgets: widgets
      .filter((widget) => widget && ["minecraft-java", "minecraft-bedrock"].includes(widget.kind))
      .map((widget) => ({
        id: String(widget.id || ""),
        kind: widget.kind,
        name: String(widget.name || "Minecraft Server"),
        enabled: widget.enabled !== false,
        config: widget.config && typeof widget.config === "object" ? widget.config : {},
        lastPayload: toCamelMinecraftPayload(widget.last_payload),
        lastUpdatedAt: typeof widget.last_updated_at === "string" ? widget.last_updated_at : "",
        lastError: typeof widget.last_error === "string" ? widget.last_error : "",
        lastErrorCode: typeof widget.last_error_code === "string" ? widget.last_error_code : ""
      }))
  };
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
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || `MeowStatus API 返回 HTTP ${response.status}`);
    }
    return normalizeDashboard(body);
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
  normalizeBaseUrl
};
