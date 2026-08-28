const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseMasterKey,
  encryptApiKey,
  decryptApiKey,
  maskApiKey
} = require("../server/ai-profiles");

const MASTER_KEY_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

test("AES-GCM encrypts with a fresh IV and decrypts with the matching profile AAD", () => {
  const key = parseMasterKey(MASTER_KEY_HEX);
  const first = encryptApiKey(key, "profile-1", "sk-test-123456");
  const second = encryptApiKey(key, "profile-1", "sk-test-123456");

  assert.notEqual(first.iv, second.iv);
  assert.equal(decryptApiKey(key, "profile-1", first), "sk-test-123456");
  assert.equal(decryptApiKey(key, "profile-1", second), "sk-test-123456");
  assert.equal(first.algorithm, "aes-256-gcm");
  assert.equal(first.version, 1);
  assert.equal(first.keyId, "kws-ai-v1");
});

test("AES-GCM rejects the wrong profile AAD and tampered auth tag uniformly", () => {
  const key = parseMasterKey(MASTER_KEY_HEX);
  const envelope = encryptApiKey(key, "profile-1", "sk-test-123456");

  assert.throws(
    () => decryptApiKey(key, "profile-2", envelope),
    (error) => error && error.code === "AI_KEY_UNAVAILABLE"
  );

  const tampered = { ...envelope, authTag: `${envelope.authTag.slice(0, -2)}AA` };
  assert.throws(
    () => decryptApiKey(key, "profile-1", tampered),
    (error) => error && error.code === "AI_KEY_UNAVAILABLE"
  );
});

test("API key masking does not reveal the original key", () => {
  const key = "sk-test-123456";
  const masked = maskApiKey(key);

  assert.notEqual(masked, key);
  assert.equal(masked.includes(key), false);
  assert.match(masked, /•/u);
});

test("AES-GCM rejects invalid profile identifiers and empty API keys", () => {
  const key = parseMasterKey(MASTER_KEY_HEX);
  assert.throws(() => encryptApiKey(key, "", "secret"), (error) => error && error.code === "AI_KEY_UNAVAILABLE");
  assert.throws(() => encryptApiKey(key, "profile-1", ""), (error) => error && error.code === "AI_KEY_UNAVAILABLE");
});
