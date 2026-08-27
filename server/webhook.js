const crypto = require("crypto");
const config = require("./config");
const { logger } = require("./logger");

const webhookLogger = logger.child({ module: "webhook" });

const SUPPORTED_PROVIDERS = new Set(["generic", "wecom", "feishu", "lark", "dingtalk", "slack"]);

let warnedDisabled = false;
let warnedInvalid = false;
let warnedProvider = false;

function oneLine(input, max = 120) {
  return String(input == null ? "" : input).replace(/\s+/g, " ").trim().slice(0, max);
}

function textBlock(input, max = 2400) {
  return String(input == null ? "" : input).slice(0, max);
}

function provider() {
  const raw = oneLine(config.webhook.provider || "generic", 32).toLowerCase();
  if (SUPPORTED_PROVIDERS.has(raw)) {
    return raw;
  }
  if (!warnedProvider) {
    warnedProvider = true;
    webhookLogger.warn({ provider: raw }, "unsupported provider, fallback to generic");
  }
  return "generic";
}

function webhookAvailable() {
  if (!config.webhook.enabled) {
    if (!warnedDisabled) {
      warnedDisabled = true;
      webhookLogger.info("webhook disabled. Set WEBHOOK_ENABLED=true to enable webhook notifications");
    }
    return false;
  }

  if (!Array.isArray(config.webhook.urls) || config.webhook.urls.length === 0) {
    if (!warnedInvalid) {
      warnedInvalid = true;
      webhookLogger.warn("webhook enabled but WEBHOOK_URLS is empty. Skip sending");
    }
    return false;
  }
  return true;
}

function titleWithPrefix(title) {
  const prefix = oneLine(config.webhook.titlePrefix || "", 64);
  return prefix ? `${prefix} ${title}` : title;
}

function configuredKeywordLine() {
  const keywords = Array.isArray(config.webhook.keywords)
    ? config.webhook.keywords.map((item) => oneLine(item, 80)).filter(Boolean)
    : [];
  return keywords.length ? `安全关键词：${keywords.join(" ")}` : "";
}

function buildText(title, lines) {
  const keywordLine = configuredKeywordLine();
  return [
    titleWithPrefix(title),
    "应用：KyanetWorkStation",
    keywordLine,
    ...lines
  ].filter(Boolean).join("\n");
}

function formatCommonFooter() {
  return [
    "",
    `管理入口：${config.appBaseUrl.replace(/\/+$/, "")}/admin/`,
    `发送时间：${new Date().toISOString()}`
  ];
}

function signForGeneric(bodyText) {
  if (!config.webhook.secret) {
    return null;
  }
  const timestamp = String(Date.now());
  const signature = crypto
    .createHmac("sha256", config.webhook.secret)
    .update(`${timestamp}\n${bodyText}`)
    .digest("hex");
  return { timestamp, signature };
}

function withDingTalkSign(url) {
  if (!config.webhook.secret) {
    return url;
  }
  const timestamp = Date.now();
  const stringToSign = `${timestamp}\n${config.webhook.secret}`;
  const sign = crypto
    .createHmac("sha256", config.webhook.secret)
    .update(stringToSign)
    .digest("base64");
  const connector = url.includes("?") ? "&" : "?";
  return `${url}${connector}timestamp=${timestamp}&sign=${encodeURIComponent(sign)}`;
}

function buildPayload(text, meta) {
  const p = provider();
  if (p === "wecom") {
    return { msgtype: "markdown", markdown: { content: text } };
  }
  if (p === "feishu" || p === "lark") {
    return { msg_type: "text", content: { text } };
  }
  if (p === "dingtalk") {
    return { msgtype: "text", text: { content: text } };
  }
  if (p === "slack") {
    return { text };
  }
  return {
    title: titleWithPrefix(meta.title || "消息通知"),
    text,
    event: meta.event || "system.message",
    service: "kyanet-workstation",
    timestamp: new Date().toISOString()
  };
}

function assertProviderSuccess(payloadText) {
  const trimmed = String(payloadText == null ? "" : payloadText).trim();
  if (!trimmed) {
    return null;
  }
  let data = null;
  try {
    data = JSON.parse(trimmed);
  } catch (_) {
    return null;
  }

  const p = provider();
  if (p === "wecom" || p === "dingtalk") {
    if (Number(data.errcode || 0) !== 0) {
      const message = data.errmsg || "webhook 平台返回 errcode 非 0";
      if (/key\s*words?\s*not\s*found|keywords?\s*not\s*in\s*content|关键词/i.test(message)) {
        return "Webhook 平台未找到安全关键词，请在 WEBHOOK_KEYWORDS 中配置机器人要求的关键词";
      }
      return message;
    }
  }
  if (p === "feishu" || p === "lark") {
    if (Number(data.code || 0) !== 0) {
      return data.msg || data.message || "webhook 平台返回 code 非 0";
    }
  }
  return null;
}

async function postWebhook(url, body) {
  const finalUrl = provider() === "dingtalk" ? withDingTalkSign(url) : url;
  const bodyText = JSON.stringify(body);
  const headers = {
    "Content-Type": "application/json"
  };

  const genericSign = provider() === "generic" ? signForGeneric(bodyText) : null;
  if (genericSign) {
    headers["X-KyanetWorkStation-Timestamp"] = genericSign.timestamp;
    headers["X-KyanetWorkStation-Signature"] = genericSign.signature;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, Math.max(1000, config.webhook.timeoutMs || 5000));

  try {
    const response = await fetch(finalUrl, {
      method: "POST",
      headers,
      body: bodyText,
      signal: controller.signal
    });

    const responseText = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        error: `HTTP ${response.status}`,
        status: response.status,
        body: responseText.slice(0, 300)
      };
    }

    const providerError = assertProviderSuccess(responseText);
    if (providerError) {
      return {
        ok: false,
        error: providerError,
        status: response.status,
        body: responseText.slice(0, 300)
      };
    }
    return { ok: true, status: response.status };
  } catch (error) {
    const message = error && error.name === "AbortError" ? "请求超时" : (error && error.message ? error.message : "请求失败");
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

function resolveWebhookTargets(target) {
  const urls = Array.isArray(config.webhook.urls) ? config.webhook.urls : [];
  if (!target || target === "configured-endpoints") {
    return urls.map((url, index) => ({ index, url }));
  }

  const match = /^webhook-endpoints:([0-9]+(?:,[0-9]+)*)$/.exec(String(target));
  if (!match) return [];

  const indexes = [...new Set(match[1].split(",").map((value) => Number(value)))]
    .filter((index) => Number.isSafeInteger(index) && index >= 0 && index < urls.length);
  return indexes.map((index) => ({ index, url: urls[index] }));
}

function formatWebhookTarget(items) {
  if (items.length === config.webhook.urls.length) {
    return "configured-endpoints";
  }
  return `webhook-endpoints:${items.map((item) => item.index).join(",")}`;
}

async function sendWebhookMessage(title, lines, meta = {}) {
  if (!webhookAvailable()) {
    return {
      sent: false,
      okCount: 0,
      failCount: 0,
      failures: [],
      target: ""
    };
  }

  const targets = resolveWebhookTargets(meta.target);
  if (!targets.length) {
    return {
      sent: false,
      okCount: 0,
      failCount: 0,
      failures: [],
      reason: "webhook_target_unavailable",
      target: String(meta.target || "").slice(0, 64)
    };
  }

  const text = buildText(title, lines);
  const body = buildPayload(text, { ...meta, title });
  const failures = [];
  let okCount = 0;

  for (const item of targets) {
    const result = await postWebhook(item.url, body);
    if (result.ok) {
      okCount += 1;
      continue;
    }
    failures.push({
      index: item.index,
      error: oneLine(result.error || "发送失败", 240),
      status: result.status || null
    });
  }

  return {
    sent: true,
    okCount,
    failCount: failures.length,
    failures,
    target: formatWebhookTarget(targets)
  };
}

async function notifyWebhookNewFeedback(payload) {
  try {
    const result = await sendWebhookMessage(
      `新反馈 #${payload.id} ${oneLine(payload.title, 80)}`,
      [
        "收到新的反馈提交",
        `ID：${payload.id}`,
        `类型：${oneLine(payload.type, 40)}`,
        `标题：${oneLine(payload.title, 120)}`,
        `联系方式：${oneLine(payload.contact, 120) || "-"}`,
        "详细内容：",
        textBlock(payload.content, 2000),
        ...formatCommonFooter()
      ],
      { event: "feedback.created", target: payload.notificationTarget }
    );
    if (!result.sent) {
      return { sent: false, ok: false, reason: "webhook_not_ready", ...result };
    }
    if (result.failCount > 0) {
      return {
        sent: true,
        ok: result.okCount > 0,
        failCount: result.failCount,
        okCount: result.okCount,
        error: result.failures[0] ? result.failures[0].error : "webhook notify failed",
        failures: result.failures
      };
    }
    return { sent: true, ok: true, okCount: result.okCount, failCount: 0 };
  } catch (error) {
    return {
      sent: true,
      ok: false,
      error: error && error.message ? error.message : String(error)
    };
  }
}

async function notifyWebhookNewWorktask(payload) {
  try {
    const sourceLabel = payload.source === "admin" ? "本人添加" : "用户提交";
    const showOnHome = payload.showOnHome ? "是" : "否";
    const result = await sendWebhookMessage(
      `新任务 #${payload.id} ${oneLine(payload.title, 80)}`,
      [
        "收到新的任务提交",
        `ID：${payload.id}`,
        `来源：${sourceLabel}`,
        `类型：${oneLine(payload.type, 40)}`,
        `优先级：${oneLine(payload.priority, 20)}`,
        `状态：${oneLine(payload.status || "new", 20)}`,
        `主页展示：${showOnHome}`,
        `标题：${oneLine(payload.title, 120)}`,
        `联系方式：${oneLine(payload.contact, 120) || "-"}`,
        `负责人：${oneLine(payload.assignee, 80) || "-"}`,
        `标签：${oneLine(payload.tags, 120) || "-"}`,
        payload.expectedAt ? `期望时间：${payload.expectedAt}` : "期望时间：-",
        payload.scheduledAt ? `计划时间：${payload.scheduledAt}` : "计划时间：-",
        payload.publicReply ? `对外回复：${textBlock(payload.publicReply, 1000)}` : "对外回复：-",
        payload.adminNote ? `管理员备注：${textBlock(payload.adminNote, 1000)}` : "管理员备注：-",
        "详细内容：",
        textBlock(payload.content, 2500),
        ...formatCommonFooter()
      ],
      { event: "worktask.created", target: payload.notificationTarget }
    );
    if (!result.sent) {
      return { sent: false, ok: false, reason: "webhook_not_ready", ...result };
    }
    if (result.failCount > 0) {
      return {
        sent: true,
        ok: result.okCount > 0,
        failCount: result.failCount,
        okCount: result.okCount,
        error: result.failures[0] ? result.failures[0].error : "webhook notify failed",
        failures: result.failures
      };
    }
    return { sent: true, ok: true, okCount: result.okCount, failCount: 0 };
  } catch (error) {
    return {
      sent: true,
      ok: false,
      error: error && error.message ? error.message : String(error)
    };
  }
}

async function sendWebhookTestMessage(payload = {}) {
  const operator = oneLine(payload.operator || "admin", 80);
  const extraText = textBlock(payload.content || "", 300);
  return sendWebhookMessage(
    "Webhook 测试消息",
    [
      "这是一条来自 KyanetWorkStation 的 Webhook 测试消息。",
      `平台类型：${provider()}`,
      `操作人：${operator}`,
      extraText ? `附加内容：${extraText}` : "附加内容：-",
      ...formatCommonFooter()
    ],
    { event: "notify.webhook.test", target: payload.notificationTarget }
  );
}

module.exports = {
  notifyWebhookNewFeedback,
  notifyWebhookNewWorktask,
  sendWebhookTestMessage
};

