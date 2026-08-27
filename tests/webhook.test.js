const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const configPath = path.resolve(__dirname, "..", "server", "config.js");
const webhookPath = path.resolve(__dirname, "..", "server", "webhook.js");

function loadWebhookWithEnv(overrides) {
  const keys = Object.keys(overrides);
  const previous = {};
  for (const key of keys) {
    previous[key] = process.env[key];
    if (overrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = String(overrides[key]);
    }
  }

  delete require.cache[configPath];
  delete require.cache[webhookPath];
  const webhook = require(webhookPath);

  return {
    webhook,
    restore() {
      delete require.cache[configPath];
      delete require.cache[webhookPath];
      for (const key of keys) {
        if (previous[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = previous[key];
        }
      }
    }
  };
}

test("webhook test message includes configured security keywords", async () => {
  const previousFetch = global.fetch;
  let sentBody = null;
  global.fetch = async (_url, options) => {
    sentBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ errcode: 0 })
    };
  };

  const { webhook, restore } = loadWebhookWithEnv({
    WEBHOOK_ENABLED: "true",
    WEBHOOK_PROVIDER: "dingtalk",
    WEBHOOK_URLS: "https://example.test/webhook",
    WEBHOOK_KEYWORDS: "KyanetWorkStation,告警"
  });

  try {
    const result = await webhook.sendWebhookTestMessage({ operator: "tester" });
    assert.equal(result.okCount, 1);
    assert.match(sentBody.text.content, /应用：KyanetWorkStation/);
    assert.match(sentBody.text.content, /安全关键词：KyanetWorkStation 告警/);
  } finally {
    restore();
    global.fetch = previousFetch;
  }
});

test("webhook keyword provider errors are mapped to actionable message", async () => {
  const previousFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ errcode: 310000, errmsg: "Key Words Not Found" })
  });

  const { webhook, restore } = loadWebhookWithEnv({
    WEBHOOK_ENABLED: "true",
    WEBHOOK_PROVIDER: "dingtalk",
    WEBHOOK_URLS: "https://example.test/webhook"
  });

  try {
    const result = await webhook.sendWebhookTestMessage({ operator: "tester" });
    assert.equal(result.okCount, 0);
    assert.equal(result.failCount, 1);
    assert.match(result.failures[0].error, /WEBHOOK_KEYWORDS/);
  } finally {
    restore();
    global.fetch = previousFetch;
  }
});

test("webhook partial failures expose counts and support targeted retries", async () => {
  const previousFetch = global.fetch;
  const requests = [];
  global.fetch = async (url) => {
    requests.push(url);
    if (url.endsWith("/ok")) {
      return {
        ok: true,
        status: 200,
        text: async () => ""
      };
    }
    return {
      ok: false,
      status: 503,
      text: async () => "upstream unavailable"
    };
  };

  const { webhook, restore } = loadWebhookWithEnv({
    WEBHOOK_ENABLED: "true",
    WEBHOOK_PROVIDER: "generic",
    WEBHOOK_URLS: "https://example.test/ok,https://example.test/fail"
  });

  try {
    const result = await webhook.sendWebhookTestMessage({ operator: "tester" });
    assert.equal(result.okCount, 1);
    assert.equal(result.failCount, 1);
    assert.equal(result.failures[0].index, 1);
    assert.equal(result.failures[0].url, undefined);
    assert.deepEqual(requests, [
      "https://example.test/ok",
      "https://example.test/fail"
    ]);

    requests.length = 0;
    const retry = await webhook.sendWebhookTestMessage({
      operator: "tester",
      notificationTarget: "webhook-endpoints:1"
    });
    assert.equal(retry.okCount, 0);
    assert.equal(retry.failCount, 1);
    assert.deepEqual(requests, ["https://example.test/fail"]);
  } finally {
    restore();
    global.fetch = previousFetch;
  }
});
