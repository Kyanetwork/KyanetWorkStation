const test = require("node:test");
const assert = require("node:assert/strict");

const config = require("../server/config");
const {
  DIAGNOSTIC_PROMPT,
  diagnoseProfile,
  endpointForProtocol
} = require("../server/ai-diagnostics");
const { requestProviderSuggestion } = require("../server/ai-provider");

function baseProfile(extra = {}) {
  return {
    id: "profile-secondary",
    name: "Secondary",
    protocol: "openai-responses",
    baseUrl: "https://provider.example/v1",
    model: "gpt-5.6",
    reasoningEffort: "xhigh",
    keyEnvelope: { version: 1 },
    ...extra
  };
}

test("diagnostic sends one fixed sentinel request to a non-active profile without changing active profile", async () => {
  const previousEnabled = config.ai.enabled;
  config.ai.enabled = true;
  const calls = [];
  const metrics = [];
  try {
    const result = await diagnoseProfile({
      profileId: "profile-secondary",
      requestId: "request-1",
      dependencies: {
        profiles: {
          getProfileSnapshot: async (id) => {
            assert.equal(id, "profile-secondary");
            return baseProfile();
          },
          decryptProfileApiKey: (profile) => {
            assert.equal(profile.id, "profile-secondary");
            return "secret-key";
          },
          getAiProfileStatus: async () => ({ activeProfile: { id: "profile-active" } })
        },
        provider: async (request) => {
          calls.push(request);
          return {
            text: DIAGNOSTIC_PROMPT.includes("KWS_DIAGNOSTIC_OK") ? "KWS_DIAGNOSTIC_OK" : "",
            usage: { inputTokens: 2, outputTokens: 3 },
            providerRequestId: "req_123",
            httpStatus: 200,
            responseJson: true,
            textExtracted: true,
            usageReported: true,
            reasoningEffortSent: true,
            endpoint: "/responses"
          };
        },
        metrics: {
          recordAiRequestMetricSafely: async (metric) => { metrics.push(metric); return true; }
        }
      }
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].prompt, DIAGNOSTIC_PROMPT);
    assert.equal(calls[0].profile.apiKey, "secret-key");
    assert.equal(result.status, "passed");
    assert.equal(result.checks.probeMatched, true);
    assert.equal(result.profile.id, "profile-secondary");
    assert.equal(result.endpoint, "/responses");
    assert.equal(result.reasoningEffortApplied, true);
    assert.equal(metrics.length, 1);
    assert.equal(metrics[0].operation, "provider_diagnostic");
    assert.equal(metrics[0].status, "success");
  } finally {
    config.ai.enabled = previousEnabled;
  }
});

test("diagnostic requires an exact sentinel and maps provider failures without leaking response text", async () => {
  const previousEnabled = config.ai.enabled;
  config.ai.enabled = true;
  const metrics = [];
  try {
    const result = await diagnoseProfile({
      profileId: "profile-secondary",
      dependencies: {
        profiles: {
          getProfileSnapshot: async () => baseProfile({ protocol: "openai-chat", reasoningEffort: "" }),
          decryptProfileApiKey: () => "secret-key"
        },
        provider: async () => {
          const error = new Error("provider secret response");
          error.code = "AI_PROVIDER_FAILED";
          error.providerMeta = { reachable: true, httpStatus: 502, responseJson: false };
          throw error;
        },
        metrics: { recordAiRequestMetricSafely: async (metric) => { metrics.push(metric); return true; } }
      }
    });
    assert.equal(result.status, "failed");
    assert.equal(result.errorCode, "AI_PROVIDER_FAILED");
    assert.equal(result.checks.reachable, true);
    assert.equal(result.httpStatus, 502);
    assert.equal(JSON.stringify(result).includes("provider secret response"), false);
    assert.equal(metrics[0].status, "failed");

    const mismatch = await diagnoseProfile({
      profileId: "profile-secondary",
      dependencies: {
        profiles: {
          getProfileSnapshot: async () => baseProfile({ protocol: "anthropic-messages" }),
          decryptProfileApiKey: () => "secret-key"
        },
        provider: async () => ({ text: " KWS_DIAGNOSTIC_OK ", usage: null, httpStatus: 200 }),
        metrics: { recordAiRequestMetricSafely: async (metric) => { metrics.push(metric); return true; } }
      }
    });
    assert.equal(mismatch.status, "failed");
    assert.equal(mismatch.checks.textExtracted, true);
    assert.equal(mismatch.checks.probeMatched, false);
    assert.equal(mismatch.errorCode, "AI_INVALID_RESPONSE");
    assert.equal(mismatch.reasoningEffortApplied, false);
  } finally {
    config.ai.enabled = previousEnabled;
  }
});

test("diagnostic endpoint projection covers all supported protocols", () => {
  assert.equal(endpointForProtocol("openai-chat"), "/chat/completions");
  assert.equal(endpointForProtocol("openai-responses"), "/responses");
  assert.equal(endpointForProtocol("anthropic-messages"), "/messages");
  assert.equal(endpointForProtocol("unknown"), "");
});

test("diagnostic sends the fixed probe through each supported provider adapter", async () => {
  const previousEnabled = config.ai.enabled;
  config.ai.enabled = true;
  const cases = [
    {
      protocol: "openai-chat",
      baseUrl: "https://provider.example/v1",
      body: { choices: [{ message: { content: "KWS_DIAGNOSTIC_OK" } }], usage: { prompt_tokens: 2, completion_tokens: 1 } },
      assertRequest(request) {
        assert.equal(request.url, "https://provider.example/v1/chat/completions");
        assert.equal(request.options.headers.Authorization, "Bearer secret-key");
        const payload = JSON.parse(request.options.body);
        assert.equal(payload.messages[0].content, DIAGNOSTIC_PROMPT);
        assert.equal(Object.hasOwn(payload, "reasoning"), false);
      }
    },
    {
      protocol: "openai-responses",
      baseUrl: "https://provider.example/v1",
      reasoningEffort: "xhigh",
      body: { output_text: "KWS_DIAGNOSTIC_OK", usage: { input_tokens: 2, output_tokens: 1 } },
      assertRequest(request) {
        assert.equal(request.url, "https://provider.example/v1/responses");
        assert.equal(request.options.headers.Authorization, "Bearer secret-key");
        const payload = JSON.parse(request.options.body);
        assert.equal(payload.input, DIAGNOSTIC_PROMPT);
        assert.deepEqual(payload.reasoning, { effort: "xhigh" });
      }
    },
    {
      protocol: "anthropic-messages",
      baseUrl: "https://provider.example",
      body: { content: [{ type: "text", text: "KWS_DIAGNOSTIC_OK" }], usage: { input_tokens: 2, output_tokens: 1 } },
      assertRequest(request) {
        assert.equal(request.url, "https://provider.example/messages");
        assert.equal(request.options.headers["x-api-key"], "secret-key");
        const payload = JSON.parse(request.options.body);
        assert.equal(payload.messages[0].content, DIAGNOSTIC_PROMPT);
        assert.equal(Object.hasOwn(payload, "reasoning"), false);
      }
    }
  ];

  try {
    for (const item of cases) {
      const profileValue = baseProfile(item);
      let request;
      const result = await diagnoseProfile({
        profileId: profileValue.id,
        dependencies: {
          profiles: {
            getProfileSnapshot: async () => profileValue,
            decryptProfileApiKey: () => "secret-key"
          },
          provider: (input) => requestProviderSuggestion({
            ...input,
            fetchImpl: async (url, options) => {
              request = { url, options };
              return {
                status: 200,
                headers: { get(name) { return name.toLowerCase() === "x-request-id" ? "diagnostic-request" : null; } },
                text: async () => JSON.stringify(item.body)
              };
            }
          }),
          metrics: { recordAiRequestMetricSafely: async () => true }
        }
      });
      assert.equal(result.status, "passed");
      assert.equal(result.checks.probeMatched, true);
      assert.equal(result.usage.inputTokens, 2);
      assert.equal(result.usage.outputTokens, 1);
      assert.equal(result.providerRequestId, "diagnostic-request");
      item.assertRequest(request);
    }
  } finally {
    config.ai.enabled = previousEnabled;
  }
});

test("diagnostic result remains available when metric persistence fails", async () => {
  const previousEnabled = config.ai.enabled;
  config.ai.enabled = true;
  try {
    const result = await diagnoseProfile({
      profileId: "profile-secondary",
      dependencies: {
        profiles: {
          getProfileSnapshot: async () => baseProfile({ protocol: "openai-chat" }),
          decryptProfileApiKey: () => "secret-key"
        },
        provider: async () => ({ text: "KWS_DIAGNOSTIC_OK", usage: null, httpStatus: 200, responseJson: true, textExtracted: true }),
        metrics: {
          recordAiRequestMetricSafely: async () => { throw new Error("database secret"); }
        }
      }
    });
    assert.equal(result.status, "passed");
    assert.equal(result.checks.probeMatched, true);
  } finally {
    config.ai.enabled = previousEnabled;
  }
});
