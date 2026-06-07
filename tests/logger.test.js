const test = require("node:test");
const assert = require("node:assert/strict");

const { redactSensitiveUrl } = require("../server/logger");

test("redactSensitiveUrl removes tickets tokens and secrets from query strings", () => {
  const value = redactSensitiveUrl(
    "/auth/account/callback?ticket=raw-ticket&returnUrl=%2Ffeedback%2F&token=raw-token&secret=raw-secret"
  );

  assert.equal(
    value,
    "/auth/account/callback?ticket=%5Bredacted%5D&returnUrl=%2Ffeedback%2F&token=%5Bredacted%5D&secret=%5Bredacted%5D"
  );
  assert.equal(value.includes("raw-ticket"), false);
  assert.equal(value.includes("raw-token"), false);
  assert.equal(value.includes("raw-secret"), false);
});

test("redactSensitiveUrl preserves invalid relative paths without leaking sensitive values", () => {
  assert.equal(redactSensitiveUrl("/path?ticket=raw-ticket#section"), "/path?ticket=%5Bredacted%5D#section");
  assert.equal(redactSensitiveUrl("not a url"), "not a url");
});
