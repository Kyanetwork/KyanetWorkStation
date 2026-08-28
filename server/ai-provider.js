const MAX_RESPONSE_BYTES = 32 * 1024;
const DEFAULT_TIMEOUT_MS = 15 * 1000;
const ANTHROPIC_VERSION = "2023-06-01";
const USER_AGENT = "KyanetWorkStation-AI/1";
const ALLOWED_CATEGORIES = new Set(["Bug", "功能建议", "体验问题", "其他"]);
const ALLOWED_PRIORITIES = new Set(["low", "medium", "high", "urgent"]);

function aiError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeProviderBaseUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw aiError("AI_PROVIDER_FAILED", "AI provider 地址不可用");
  }
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch (_) {
    throw aiError("AI_PROVIDER_FAILED", "AI provider 地址不可用");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || parsed.hash || parsed.search) {
    throw aiError("AI_PROVIDER_FAILED", "AI provider 地址不可用");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed;
}

function buildProviderEndpoint(baseUrl, suffix) {
  const parsed = normalizeProviderBaseUrl(baseUrl);
  const path = parsed.pathname === "/" ? "" : (parsed.pathname || "");
  if (path === suffix || path.endsWith(suffix)) {
    parsed.pathname = path || suffix;
  } else {
    parsed.pathname = `${path}${suffix}`;
  }
  return parsed.toString();
}

function providerKey(profile) {
  const value = profile && (profile.apiKey || profile.decryptedApiKey || profile.key);
  if (typeof value !== "string" || !value) {
    throw aiError("AI_KEY_UNAVAILABLE", "AI provider API Key 不可用");
  }
  return value;
}

function textFromContent(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((part) => {
    if (typeof part === "string") return part;
    if (part && typeof part.text === "string") return part.text;
    if (part && typeof part.content === "string") return part.content;
    return "";
  }).join("");
}

function extractChatText(body) {
  const choice = body && Array.isArray(body.choices) ? body.choices[0] : null;
  return textFromContent(choice && choice.message && choice.message.content);
}

function extractResponsesText(body) {
  if (body && typeof body.output_text === "string") return body.output_text;
  if (!body || !Array.isArray(body.output)) return "";
  return body.output.map((item) => textFromContent(item && item.content)).join("");
}

function extractAnthropicText(body) {
  return textFromContent(body && body.content);
}

function mapUsage(usage) {
  if (!usage || typeof usage !== "object") {
    return { inputTokens: null, outputTokens: null };
  }
  const input = usage && (usage.input_tokens ?? usage.prompt_tokens ?? usage.inputTokens);
  const output = usage && (usage.output_tokens ?? usage.completion_tokens ?? usage.outputTokens);
  return {
    inputTokens: Number.isSafeInteger(Number(input)) && Number(input) >= 0 ? Number(input) : null,
    outputTokens: Number.isSafeInteger(Number(output)) && Number(output) >= 0 ? Number(output) : null
  };
}

function providerRequestId(response, body) {
  const headerId = response && response.headers && typeof response.headers.get === "function"
    ? response.headers.get("x-request-id")
    : "";
  if (headerId) return String(headerId).slice(0, 128);
  return body && typeof body.id === "string" ? body.id.slice(0, 128) : "";
}

async function readResponseTextBounded(response) {
  const contentLength = response && response.headers && typeof response.headers.get === "function"
    ? response.headers.get("content-length")
    : null;
  const declaredLength = Number.parseInt(contentLength, 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw aiError("AI_INVALID_RESPONSE", "AI provider 响应超出大小限制");
  }

  if (response && response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        const chunk = Buffer.from(item.value);
        total += chunk.length;
        if (total > MAX_RESPONSE_BYTES) {
          await reader.cancel().catch(() => {});
          throw aiError("AI_INVALID_RESPONSE", "AI provider 响应超出大小限制");
        }
        chunks.push(chunk);
      }
    } finally {
      reader.releaseLock?.();
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  if (!response || typeof response.text !== "function") {
    throw aiError("AI_INVALID_RESPONSE", "AI provider 响应格式无效");
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
    throw aiError("AI_INVALID_RESPONSE", "AI provider 响应超出大小限制");
  }
  return text;
}

function requestDefinition(profile, prompt) {
  const protocol = profile && profile.protocol;
  const model = profile && profile.model;
  if (typeof model !== "string" || !model || typeof prompt !== "string") {
    throw aiError("AI_PROVIDER_FAILED", "AI provider 请求配置不可用");
  }
  const key = providerKey(profile);
  if (protocol === "openai-chat") {
    return {
      url: buildProviderEndpoint(profile.baseUrl, "/chat/completions"),
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        Authorization: `Bearer ${key}`
      },
      body: {
        model,
        messages: [{ role: "user", content: prompt }]
      },
      extract: extractChatText
    };
  }
  if (protocol === "openai-responses") {
    return {
      url: buildProviderEndpoint(profile.baseUrl, "/responses"),
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        Authorization: `Bearer ${key}`
      },
      body: { model, input: prompt },
      extract: extractResponsesText
    };
  }
  if (protocol === "anthropic-messages") {
    return {
      url: buildProviderEndpoint(profile.baseUrl, "/messages"),
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        "x-api-key": key,
        "anthropic-version": ANTHROPIC_VERSION
      },
      body: {
        model,
        max_tokens: 1200,
        messages: [{ role: "user", content: prompt }]
      },
      extract: extractAnthropicText
    };
  }
  throw aiError("AI_PROVIDER_FAILED", "AI provider 协议不可用");
}

async function requestProviderSuggestion({ profile, prompt, requestId = "", signal, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const definition = requestDefinition(profile, prompt);
  const timeout = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Math.min(Number(timeoutMs), DEFAULT_TIMEOUT_MS)
    : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const externalSignal = signal;
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeout);
  timer.unref?.();
  let abortReject;
  const abortPromise = new Promise((_, reject) => {
    abortReject = reject;
    if (controller.signal.aborted) {
      reject(aiError("AI_TIMEOUT", "AI provider 请求超时"));
    } else {
      controller.signal.addEventListener("abort", () => reject(aiError("AI_TIMEOUT", "AI provider 请求超时")), { once: true });
    }
  });
  try {
    const fetchPromise = Promise.resolve().then(() => fetchImpl(definition.url, {
      method: "POST",
      headers: definition.headers,
      body: JSON.stringify(definition.body),
      signal: controller.signal
    }));
    const response = await Promise.race([fetchPromise, abortPromise]);
    const status = Number(response && response.status);
    if (!Number.isFinite(status) || status < 200 || status >= 300) {
      throw aiError("AI_PROVIDER_FAILED", "AI provider 请求失败");
    }
    const responseText = await readResponseTextBounded(response);
    let body;
    try {
      body = JSON.parse(responseText);
    } catch (_) {
      throw aiError("AI_INVALID_RESPONSE", "AI provider 响应格式无效");
    }
    const text = definition.extract(body);
    if (!text) {
      throw aiError("AI_INVALID_RESPONSE", "AI provider 未返回建议文本");
    }
    return {
      text,
      usage: mapUsage(body && body.usage),
      providerRequestId: providerRequestId(response, body)
    };
  } catch (error) {
    if (error && error.code) throw error;
    if (controller.signal.aborted || (error && error.name === "AbortError")) {
      throw aiError("AI_TIMEOUT", "AI provider 请求超时");
    }
    throw aiError("AI_PROVIDER_FAILED", "AI provider 请求失败");
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
    abortReject = null;
  }
}

function stripCodeFence(value) {
  const text = typeof value === "string" ? value.trim() : "";
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return match ? match[1].trim() : text;
}

function boundedString(value, maxLength, field) {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.length > maxLength) {
    throw aiError("AI_INVALID_RESPONSE", `AI provider ${field} 字段无效`);
  }
  return value;
}

function boundedStringArray(value, maxItems, maxLength, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) {
    throw aiError("AI_INVALID_RESPONSE", `AI provider ${field} 字段无效`);
  }
  return value.map((item) => {
    if (typeof item !== "string" || item.length > maxLength) {
      throw aiError("AI_INVALID_RESPONSE", `AI provider ${field} 字段无效`);
    }
    return item;
  });
}

function parseSuggestionText(value) {
  const source = stripCodeFence(value);
  if (!source) throw aiError("AI_INVALID_RESPONSE", "AI provider 建议不是有效 JSON");
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (_) {
    throw aiError("AI_INVALID_RESPONSE", "AI provider 建议不是有效 JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw aiError("AI_INVALID_RESPONSE", "AI provider 建议不是 JSON 对象");
  }
  const category = parsed.category === undefined ? "" : parsed.category;
  if (category !== "" && (typeof category !== "string" || !ALLOWED_CATEGORIES.has(category))) {
    throw aiError("AI_INVALID_RESPONSE", "AI provider category 字段无效");
  }
  const priority = parsed.priority === undefined ? null : parsed.priority;
  if (priority !== null && (typeof priority !== "string" || !ALLOWED_PRIORITIES.has(priority))) {
    throw aiError("AI_INVALID_RESPONSE", "AI provider priority 字段无效");
  }
  return {
    summary: boundedString(parsed.summary, 600, "summary"),
    category,
    priority,
    tags: boundedStringArray(parsed.tags, 8, 32, "tags"),
    replyDraft: boundedString(parsed.replyDraft, 1000, "replyDraft"),
    rationale: boundedString(parsed.rationale, 600, "rationale"),
    missingInfo: boundedStringArray(parsed.missingInfo, 6, 120, "missingInfo")
  };
}

module.exports = {
  MAX_RESPONSE_BYTES,
  DEFAULT_TIMEOUT_MS,
  ANTHROPIC_VERSION,
  requestProviderSuggestion,
  parseSuggestionText,
  readResponseTextBounded,
  normalizeProviderBaseUrl,
  buildProviderEndpoint
};
