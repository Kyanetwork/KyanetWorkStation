const defaultPolicy = Object.freeze({
  feedbackRequiresLogin: true,
  worktaskRequiresLogin: true,
  allowAnonymousSubmission: false
});

function buildUrl(baseUrl, pathname) {
  const url = new URL(pathname, `${String(baseUrl || "").replace(/\/+$/, "")}/`);
  return url.toString();
}

function createError(message) {
  return new Error(message);
}

function normalizePolicy(value) {
  if (!value || typeof value !== "object") {
    return defaultPolicy;
  }
  return {
    feedbackRequiresLogin: value.feedbackRequiresLogin !== false,
    worktaskRequiresLogin: value.worktaskRequiresLogin !== false,
    allowAnonymousSubmission: value.allowAnonymousSubmission === true
  };
}

function readPolicyPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return defaultPolicy;
  }
  if (payload.policy && typeof payload.policy === "object") {
    return normalizePolicy(payload.policy);
  }
  return normalizePolicy(payload);
}

function createPolicyCache({ fetchPolicy, ttlMs }) {
  let cachedPolicy = null;
  let cachedUntil = 0;

  return {
    async getPolicy() {
      const now = Date.now();
      if (cachedPolicy && cachedUntil > now) {
        return cachedPolicy;
      }

      try {
        cachedPolicy = normalizePolicy(await fetchPolicy());
      } catch (error) {
        cachedPolicy = defaultPolicy;
      }
      cachedUntil = now + Math.max(0, Number(ttlMs) || 0);
      return cachedPolicy;
    },
    clear() {
      cachedPolicy = null;
      cachedUntil = 0;
    }
  };
}

function createAbortSignal(timeoutMs) {
  const ms = Number(timeoutMs);
  if (!Number.isFinite(ms) || ms <= 0 || typeof AbortSignal === "undefined") {
    return undefined;
  }
  if (typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  return undefined;
}

function requireSecret(secret) {
  if (typeof secret !== "string" || !secret.trim()) {
    throw createError("账号接入密钥未配置");
  }
  return secret;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}

async function fetchWorkstationPolicy({ baseUrl, secret, fetchImpl = fetch, timeoutMs }) {
  const integrationSecret = requireSecret(secret);
  const response = await fetchImpl(buildUrl(baseUrl, "/api/integrations/workstation/policy"), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${integrationSecret}`,
      Accept: "application/json"
    },
    signal: createAbortSignal(timeoutMs)
  });

  if (!response || !response.ok) {
    return defaultPolicy;
  }

  return readPolicyPayload(await safeJson(response));
}

function normalizeUser(value) {
  if (!value || typeof value !== "object") {
    throw createError("账号登录票据校验失败");
  }
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const email = typeof value.email === "string" ? value.email.trim() : "";
  const profile = value.profile && typeof value.profile === "object" ? value.profile : null;
  const displayName = typeof value.displayName === "string"
    ? value.displayName.trim()
    : (profile && typeof profile.displayName === "string" ? profile.displayName.trim() : "");
  if (!id || !email) {
    throw createError("账号登录票据校验失败");
  }
  return { id, email, displayName };
}

async function exchangeLoginTicket({ ticket, baseUrl, secret, fetchImpl = fetch, timeoutMs }) {
  const integrationSecret = requireSecret(secret);
  if (typeof ticket !== "string" || !ticket.trim()) {
    throw createError("账号登录票据不能为空");
  }

  const response = await fetchImpl(buildUrl(baseUrl, "/api/integrations/workstation/login-ticket/exchange"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${integrationSecret}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({ ticket }),
    signal: createAbortSignal(timeoutMs)
  });

  if (!response || !response.ok) {
    throw createError("账号登录票据校验失败");
  }

  const payload = await safeJson(response);
  if (!payload || payload.ok === false) {
    throw createError("账号登录票据校验失败");
  }

  return normalizeUser(payload.user);
}

module.exports = {
  defaultPolicy,
  createPolicyCache,
  fetchWorkstationPolicy,
  exchangeLoginTicket
};
