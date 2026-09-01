const crypto = require("node:crypto");
const config = require("./config");
const {
  getAiProviderProfiles,
  setAiProviderProfiles
} = require("./db");

const ENVELOPE_VERSION = 1;
const ENVELOPE_ALGORITHM = "aes-256-gcm";
const ENVELOPE_KEY_ID = "kws-ai-v1";
const IV_BYTES = 12;
const MAX_PROFILES = 8;
const MAX_PROFILE_NAME = 64;
const MAX_BASE_URL = 300;
const MAX_MODEL = 120;
const MAX_API_KEY = 512;
const MAX_PROMPT_INSTRUCTION = 2000;
const PROFILE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const ALLOWED_PROTOCOLS = new Set(["openai-chat", "openai-responses", "anthropic-messages"]);
const ALLOWED_REASONING_EFFORTS = new Set(["", "low", "medium", "high", "xhigh", "max"]);

function keyUnavailable() {
  const error = new Error("AI profile encryption key is unavailable");
  error.code = "AI_KEY_UNAVAILABLE";
  return error;
}

function parseMasterKey(value) {
  if (Buffer.isBuffer(value)) {
    if (value.length === 32) return Buffer.from(value);
    throw keyUnavailable();
  }
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/iu.test(value)) {
    throw keyUnavailable();
  }
  try {
    return Buffer.from(value, "hex");
  } catch (_) {
    throw keyUnavailable();
  }
}

function normalizeCryptoProfileId(profileId) {
  if (typeof profileId !== "string" || !profileId.trim() || profileId.length > 128) {
    throw keyUnavailable();
  }
  const normalized = profileId.trim();
  if (!PROFILE_ID_PATTERN.test(normalized)) {
    throw keyUnavailable();
  }
  return normalized;
}

function normalizeApiKey(apiKey) {
  if (typeof apiKey !== "string" || !apiKey) {
    throw keyUnavailable();
  }
  return apiKey;
}

function truncateUnicode(value, maxLength) {
  return Array.from(value).slice(0, maxLength).join("");
}

function normalizeReasoningEffort(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return ALLOWED_REASONING_EFFORTS.has(normalized) ? normalized : "";
}

function normalizePromptInstruction(value) {
  return typeof value === "string"
    ? truncateUnicode(value.trim(), MAX_PROMPT_INSTRUCTION)
    : "";
}

function encryptApiKey(masterKey, profileId, apiKey) {
  let key;
  let id;
  let secret;
  try {
    key = parseMasterKey(masterKey);
    id = normalizeCryptoProfileId(profileId);
    secret = normalizeApiKey(apiKey);
  } catch (error) {
    if (error && error.code === "AI_KEY_UNAVAILABLE") throw error;
    throw keyUnavailable();
  }

  try {
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ENVELOPE_ALGORITHM, key, iv);
    cipher.setAAD(Buffer.from(id, "utf8"));
    const ciphertext = Buffer.concat([
      cipher.update(secret, "utf8"),
      cipher.final()
    ]);
    const authTag = cipher.getAuthTag();
    return {
      version: ENVELOPE_VERSION,
      algorithm: ENVELOPE_ALGORITHM,
      keyId: ENVELOPE_KEY_ID,
      iv: iv.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      authTag: authTag.toString("base64")
    };
  } catch (_) {
    throw keyUnavailable();
  }
}

function isBase64(value) {
  return typeof value === "string" && value.length > 0 &&
    value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value);
}

function decryptApiKey(masterKey, profileId, envelope) {
  let key;
  let id;
  try {
    key = parseMasterKey(masterKey);
    id = normalizeCryptoProfileId(profileId);
    if (!envelope || typeof envelope !== "object" ||
      envelope.version !== ENVELOPE_VERSION ||
      envelope.algorithm !== ENVELOPE_ALGORITHM ||
      envelope.keyId !== ENVELOPE_KEY_ID ||
      !isBase64(envelope.iv) || !isBase64(envelope.ciphertext) || !isBase64(envelope.authTag)) {
      throw keyUnavailable();
    }
  } catch (error) {
    if (error && error.code === "AI_KEY_UNAVAILABLE") throw error;
    throw keyUnavailable();
  }

  try {
    const iv = Buffer.from(envelope.iv, "base64");
    const ciphertext = Buffer.from(envelope.ciphertext, "base64");
    const authTag = Buffer.from(envelope.authTag, "base64");
    if (iv.length !== IV_BYTES || authTag.length !== 16 || ciphertext.length === 0) {
      throw keyUnavailable();
    }

    const decipher = crypto.createDecipheriv(ENVELOPE_ALGORITHM, key, iv);
    decipher.setAAD(Buffer.from(id, "utf8"));
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]);
    return plaintext.toString("utf8");
  } catch (_) {
    throw keyUnavailable();
  }
}

function maskApiKey(apiKey) {
  return typeof apiKey === "string" && apiKey ? "••••••••" : "";
}

function normalizeBaseUrl(value) {
  if (typeof value !== "string") return "";
  const raw = value.trim();
  if (!raw || raw.length > MAX_BASE_URL) return "";
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    return "";
  }
  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) {
    return "";
  }
  const normalized = `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/+$/, "");
  return normalized || `${parsed.protocol}//${parsed.host}`;
}

function normalizeStoredProfileId(value) {
  const id = typeof value === "string" ? value.trim() : "";
  return PROFILE_ID_PATTERN.test(id) ? id : "";
}

function normalizeEnvelope(value) {
  if (!value || typeof value !== "object") return null;
  if (value.version !== ENVELOPE_VERSION || value.algorithm !== ENVELOPE_ALGORITHM || value.keyId !== ENVELOPE_KEY_ID) {
    return null;
  }
  if (!["iv", "ciphertext", "authTag"].every((field) => isBase64(value[field]))) {
    return null;
  }
  return {
    version: ENVELOPE_VERSION,
    algorithm: ENVELOPE_ALGORITHM,
    keyId: ENVELOPE_KEY_ID,
    iv: value.iv,
    ciphertext: value.ciphertext,
    authTag: value.authTag
  };
}

function normalizeStoredProfile(value) {
  if (!value || typeof value !== "object") return null;
  const id = normalizeStoredProfileId(value.id);
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const protocol = typeof value.protocol === "string" ? value.protocol.trim() : "";
  const baseUrl = normalizeBaseUrl(value.baseUrl);
  const model = typeof value.model === "string" ? value.model.trim() : "";
  if (!id || !name || name.length > MAX_PROFILE_NAME || !ALLOWED_PROTOCOLS.has(protocol) || !baseUrl || !model || model.length > MAX_MODEL) {
    return null;
  }
  return {
    id,
    name,
    protocol,
    baseUrl,
    model,
    reasoningEffort: normalizeReasoningEffort(value.reasoningEffort ?? value.reasoning_effort),
    promptInstruction: normalizePromptInstruction(value.promptInstruction),
    keyEnvelope: normalizeEnvelope(value.keyEnvelope),
    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : ""
  };
}

function normalizeStoredState(value) {
  const raw = value && typeof value === "object" ? value : {};
  const profiles = Array.isArray(raw.profiles)
    ? raw.profiles.map(normalizeStoredProfile).filter(Boolean).slice(0, MAX_PROFILES)
    : [];
  const ids = new Set(profiles.map((profile) => profile.id));
  const activeProfileId = ids.has(raw.activeProfileId) ? raw.activeProfileId : "";
  return { version: 1, activeProfileId, profiles };
}

function cloneState(value) {
  return JSON.parse(JSON.stringify(value));
}

function toProfileDto(profile) {
  if (!profile) return null;
  const keyConfigured = Boolean(normalizeEnvelope(profile.keyEnvelope));
  return {
    id: profile.id,
    name: profile.name,
    protocol: profile.protocol,
    baseUrl: profile.baseUrl,
    model: profile.model,
    reasoningEffort: profile.reasoningEffort || "",
    promptInstruction: profile.promptInstruction || "",
    keyConfigured,
    keyMask: keyConfigured ? maskApiKey("configured") : "",
    createdAt: profile.createdAt || "",
    updatedAt: profile.updatedAt || ""
  };
}

function profileError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function readProfileState() {
  return normalizeStoredState(await getAiProviderProfiles());
}

let writeLock = Promise.resolve();
function withProfileWriteLock(operation) {
  const result = writeLock.then(operation);
  writeLock = result.catch(() => {});
  return result;
}

function normalizeWriteProfilePayload(payload) {
  const body = payload && typeof payload === "object" ? payload : {};
  const id = body.id === undefined || body.id === null ? "" : normalizeStoredProfileId(body.id);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const protocol = typeof body.protocol === "string" ? body.protocol.trim() : "";
  const baseUrl = normalizeBaseUrl(body.baseUrl);
  const model = typeof body.model === "string" ? body.model.trim() : "";
  const key = typeof body.key === "string" ? body.key.trim() : "";
  const reasoningMarker = Object.getOwnPropertyDescriptor(body, "reasoningEffortProvided");
  const reasoningEffortProvided = reasoningMarker && reasoningMarker.enumerable === false &&
    typeof reasoningMarker.value === "boolean"
    ? reasoningMarker.value
    : Object.prototype.hasOwnProperty.call(body, "reasoningEffort") ||
      Object.prototype.hasOwnProperty.call(body, "reasoning_effort");
  const rawReasoningEffort = Object.prototype.hasOwnProperty.call(body, "reasoningEffort")
    ? body.reasoningEffort
    : body.reasoning_effort;
  const reasoningEffort = normalizeReasoningEffort(rawReasoningEffort);
  const promptMarker = Object.getOwnPropertyDescriptor(body, "promptInstructionProvided");
  const promptInstructionProvided = promptMarker && promptMarker.enumerable === false &&
    typeof promptMarker.value === "boolean"
    ? promptMarker.value
    : Object.prototype.hasOwnProperty.call(body, "promptInstruction");
  const rawPromptInstruction = body.promptInstruction;
  const promptInstruction = normalizePromptInstruction(rawPromptInstruction);
  if ((body.id !== undefined && body.id !== null && String(body.id).trim() && !id) || !name || name.length > MAX_PROFILE_NAME ||
    !ALLOWED_PROTOCOLS.has(protocol) || !baseUrl || !model || model.length > MAX_MODEL || key.length > MAX_API_KEY ||
    (reasoningEffortProvided && rawReasoningEffort !== undefined && typeof rawReasoningEffort !== "string") ||
    (reasoningEffortProvided && !ALLOWED_REASONING_EFFORTS.has(reasoningEffort)) ||
    (promptInstructionProvided && rawPromptInstruction !== undefined && typeof rawPromptInstruction !== "string")) {
    throw profileError("INVALID_PAYLOAD", "AI profile 配置不合法");
  }
  const normalized = {
    id,
    name,
    protocol,
    baseUrl,
    model,
    key,
    reasoningEffort,
    promptInstruction
  };
  Object.defineProperties(normalized, {
    reasoningEffortProvided: { value: reasoningEffortProvided, enumerable: false },
    promptInstructionProvided: { value: promptInstructionProvided, enumerable: false }
  });
  return normalized;
}

async function saveProfile(payload) {
  return withProfileWriteLock(async () => {
    const next = normalizeWriteProfilePayload(payload);
    const state = await readProfileState();
    let profile = next.id ? state.profiles.find((item) => item.id === next.id) : null;
    if (next.id && !profile) {
      throw profileError("NOT_FOUND", "AI profile 不存在");
    }
    if (!profile && state.profiles.length >= MAX_PROFILES) {
      throw profileError("AI_PROFILE_CONFLICT", "AI profile 数量已达到上限");
    }
    if (state.profiles.some((item) => item.id !== (profile && profile.id) && item.name.toLowerCase() === next.name.toLowerCase())) {
      throw profileError("AI_PROFILE_CONFLICT", "AI profile 名称已存在");
    }

    const id = profile ? profile.id : crypto.randomUUID();
    const now = new Date().toISOString();
    let keyEnvelope = profile && profile.keyEnvelope;
    if (next.key) {
      keyEnvelope = encryptApiKey(parseMasterKey(config.ai.profileEncryptionKey), id, next.key);
    }
    if (!keyEnvelope) {
      throw profileError("AI_KEY_UNAVAILABLE", "AI profile API Key 不可用");
    }
    const saved = {
      id,
      name: next.name,
      protocol: next.protocol,
      baseUrl: next.baseUrl,
      model: next.model,
      reasoningEffort: next.reasoningEffortProvided || !profile ? next.reasoningEffort : profile.reasoningEffort || "",
      promptInstruction: next.promptInstructionProvided || !profile ? next.promptInstruction : profile.promptInstruction || "",
      keyEnvelope,
      createdAt: profile ? profile.createdAt : now,
      updatedAt: now
    };
    const profiles = profile
      ? state.profiles.map((item) => item.id === id ? saved : item)
      : [...state.profiles, saved];
    await setAiProviderProfiles({ ...state, profiles });
    return toProfileDto(saved);
  });
}

async function setActiveProfile(profileId) {
  return withProfileWriteLock(async () => {
    const id = typeof profileId === "string" ? profileId.trim() : "";
    const state = await readProfileState();
    if (id && !state.profiles.some((profile) => profile.id === id)) {
      throw profileError("NOT_FOUND", "AI profile 不存在");
    }
    const next = { ...state, activeProfileId: id };
    await setAiProviderProfiles(next);
    return toProfileDto(next.profiles.find((profile) => profile.id === id) || null);
  });
}

async function deleteProfile(profileId) {
  return withProfileWriteLock(async () => {
    const id = typeof profileId === "string" ? profileId.trim() : "";
    const state = await readProfileState();
    if (!id || !state.profiles.some((profile) => profile.id === id)) {
      throw profileError("NOT_FOUND", "AI profile 不存在");
    }
    const profiles = state.profiles.filter((profile) => profile.id !== id);
    await setAiProviderProfiles({
      ...state,
      activeProfileId: state.activeProfileId === id ? "" : state.activeProfileId,
      profiles
    });
    return { deleted: true, activeProfile: toProfileDto(profiles.find((profile) => profile.id === state.activeProfileId) || null) };
  });
}

async function getActiveProfileSnapshot() {
  const state = await readProfileState();
  const active = state.profiles.find((profile) => profile.id === state.activeProfileId);
  return active ? cloneState(active) : null;
}

function decryptProfileApiKey(profile) {
  if (!profile || !profile.keyEnvelope) {
    throw keyUnavailable();
  }
  return decryptApiKey(parseMasterKey(config.ai.profileEncryptionKey), profile.id, profile.keyEnvelope);
}

async function getAiProfileStatus() {
  const state = await readProfileState();
  const active = state.profiles.find((profile) => profile.id === state.activeProfileId) || null;
  let reason = "ready";
  if (!config.ai.enabled) reason = "disabled";
  else if (!config.ai.profileEncryptionKeyValid) reason = "encryption_key_unavailable";
  else if (!active) reason = "no_active_profile";
  else if (!active.keyEnvelope) reason = "profile_key_unavailable";
  else {
    try {
      decryptProfileApiKey(active);
    } catch (_) {
      reason = "profile_key_unavailable";
    }
  }
  return {
    enabled: config.ai.enabled,
    available: reason === "ready",
    reason,
    activeProfile: toProfileDto(active),
    profiles: state.profiles.map(toProfileDto)
  };
}

module.exports = {
  parseMasterKey,
  encryptApiKey,
  decryptApiKey,
  maskApiKey,
  normalizeBaseUrl,
  toProfileDto,
  saveProfile,
  setActiveProfile,
  deleteProfile,
  getActiveProfileSnapshot,
  decryptProfileApiKey,
  getAiProfileStatus,
  MAX_PROFILES,
  ALLOWED_PROTOCOLS
};
