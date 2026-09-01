const test = require("node:test");
const assert = require("node:assert/strict");

const {
  requestProviderSuggestion,
  parseSuggestionText
} = require("../server/ai-provider");

function responseFromJson(body, options = {}) {
  const encoded = JSON.stringify(body);
  const headers = new Map(Object.entries(options.headers || {}));
  if (options.contentLength !== undefined) headers.set("content-length", String(options.contentLength));
  return {
    status: options.status || 200,
    ok: (options.status || 200) >= 200 && (options.status || 200) < 300,
    headers: { get(name) { return headers.get(String(name).toLowerCase()) || headers.get(name) || null; } },
    text: async () => encoded
  };
}

function profile(protocol, baseUrl, extra = {}) {
  return {
    id: "profile-1",
    protocol,
    baseUrl,
    model: "test-model",
    apiKey: "secret-provider-key",
    ...extra
  };
}

test("OpenAI Chat adapter sends the compatible path and Bearer credentials", async () => {
  let request;
  const result = await requestProviderSuggestion({
    profile: profile("openai-chat", "https://provider.example/v1/"),
    prompt: "return a suggestion",
    requestId: "req-1",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return responseFromJson({
        id: "chat-request-1",
        choices: [{ message: { content: "{\"summary\":\"ok\"}" } }],
        usage: { prompt_tokens: 3, completion_tokens: 4 }
      });
    }
  });

  assert.equal(request.url, "https://provider.example/v1/chat/completions");
  assert.equal(request.options.headers.Authorization, "Bearer secret-provider-key");
  assert.equal(request.options.headers["x-api-key"], undefined);
  const body = JSON.parse(request.options.body);
  assert.equal(body.model, "test-model");
  assert.equal(body.messages[0].role, "user");
  assert.equal(body.messages[0].content, "return a suggestion");
  assert.equal(result.text, "{\"summary\":\"ok\"}");
  assert.deepEqual(result.usage, { inputTokens: 3, outputTokens: 4 });
  assert.equal(result.providerRequestId, "chat-request-1");
});

test("OpenAI Responses adapter does not duplicate an already configured protocol path", async () => {
  let request;
  const result = await requestProviderSuggestion({
    profile: profile("openai-responses", "https://provider.example/v1/responses"),
    prompt: "return a response",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return responseFromJson({
        id: "response-request-1",
        output_text: "{\"summary\":\"ok\"}"
      });
    }
  });

  assert.equal(request.url, "https://provider.example/v1/responses");
  assert.equal(request.options.headers.Authorization, "Bearer secret-provider-key");
  const body = JSON.parse(request.options.body);
  assert.equal(body.model, "test-model");
  assert.equal(body.input, "return a response");
  assert.equal(result.providerRequestId, "response-request-1");
});

test("OpenAI Responses adapter maps a configured reasoning effort", async () => {
  let request;
  await requestProviderSuggestion({
    profile: profile("openai-responses", "https://provider.example/v1", { reasoningEffort: "xhigh" }),
    prompt: "return a response",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return responseFromJson({
        id: "response-request-reasoning",
        output_text: "{\"summary\":\"ok\"}"
      });
    }
  });

  const body = JSON.parse(request.options.body);
  assert.deepEqual(body.reasoning, { effort: "xhigh" });
});

test("Provider omits reasoning when it is empty or unsupported", async () => {
  for (const reasoningEffort of ["", "unsupported"]) {
    let request;
    await requestProviderSuggestion({
      profile: profile("openai-responses", "https://provider.example/v1", { reasoningEffort }),
      prompt: "return a response",
      fetchImpl: async (url, options) => {
        request = { url, options };
        return responseFromJson({ output_text: "{\"summary\":\"ok\"}" });
      }
    });

    const body = JSON.parse(request.options.body);
    assert.equal(Object.hasOwn(body, "reasoning"), false);
  }
});

test("Chat and Anthropic adapters omit Responses-only reasoning settings", async () => {
  for (const protocol of ["openai-chat", "anthropic-messages"]) {
    let request;
    await requestProviderSuggestion({
      profile: profile(protocol, "https://provider.example/v1", { reasoningEffort: "xhigh" }),
      prompt: "return a response",
      fetchImpl: async (url, options) => {
        request = { url, options };
        return responseFromJson(protocol === "openai-chat"
          ? { choices: [{ message: { content: "{\"summary\":\"ok\"}" } }] }
          : { content: [{ type: "text", text: "{\"summary\":\"ok\"}" }] });
      }
    });

    const body = JSON.parse(request.options.body);
    assert.equal(Object.hasOwn(body, "reasoning"), false);
  }
});

test("Anthropic Messages adapter sends its native message shape and fixed version", async () => {
  let request;
  const result = await requestProviderSuggestion({
    profile: profile("anthropic-messages", "https://api.anthropic.com/"),
    prompt: "return an anthropic suggestion",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return responseFromJson({
        id: "anthropic-request-1",
        content: [{ type: "text", text: "{\"summary\":\"ok\"}" }],
        usage: { input_tokens: 5, output_tokens: 6 }
      });
    }
  });

  assert.equal(request.url, "https://api.anthropic.com/messages");
  assert.equal(request.options.headers["x-api-key"], "secret-provider-key");
  assert.equal(request.options.headers["anthropic-version"], "2023-06-01");
  assert.equal(request.options.headers.Authorization, undefined);
  const body = JSON.parse(request.options.body);
  assert.equal(body.model, "test-model");
  assert.equal(body.messages[0].content, "return an anthropic suggestion");
  assert.equal(result.providerRequestId, "anthropic-request-1");
  assert.deepEqual(result.usage, { inputTokens: 5, outputTokens: 6 });
});

test("Provider errors are bounded and map to stable error codes", async () => {
  await assert.rejects(
    () => requestProviderSuggestion({
      profile: profile("openai-chat", "https://provider.example/v1"),
      prompt: "prompt",
      fetchImpl: async () => responseFromJson({ error: "provider secret response" }, { status: 502 })
    }),
    (error) => error && error.code === "AI_PROVIDER_FAILED" && !error.message.includes("provider secret response")
  );

  await assert.rejects(
    () => requestProviderSuggestion({
      profile: profile("openai-chat", "https://provider.example/v1"),
      prompt: "prompt",
      fetchImpl: async () => responseFromJson({ output: "too large" }, { contentLength: 32 * 1024 + 1 })
    }),
    (error) => error && error.code === "AI_INVALID_RESPONSE"
  );
});

test("Provider usage with an explicit null value remains unknown", async () => {
  const result = await requestProviderSuggestion({
    profile: profile("openai-chat", "https://provider.example/v1"),
    prompt: "prompt",
    fetchImpl: async () => responseFromJson({
      choices: [{ message: { content: "{\"summary\":\"ok\"}" } }],
      usage: null
    })
  });

  assert.deepEqual(result.usage, { inputTokens: null, outputTokens: null });
});

test("Provider request timeout aborts the fetch and returns AI_TIMEOUT", async () => {
  await assert.rejects(
    () => requestProviderSuggestion({
      profile: profile("openai-chat", "https://provider.example/v1"),
      prompt: "prompt",
      timeoutMs: 5,
      fetchImpl: (_url, options) => new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      })
    }),
    (error) => error && error.code === "AI_TIMEOUT"
  );
});

test("Suggestion JSON parsing accepts a code fence, drops unknown fields, and enforces enums", () => {
  const parsed = parseSuggestionText(`\n\`\`\`json\n${JSON.stringify({
    summary: "summary",
    category: "Bug",
    priority: "high",
    tags: ["login"],
    replyDraft: "reply",
    rationale: "rationale",
    missingInfo: ["browser"],
    ignored: "must not be returned"
  })}\n\`\`\`\n`);

  assert.deepEqual(parsed, {
    summary: "summary",
    category: "Bug",
    priority: "high",
    tags: ["login"],
    replyDraft: "reply",
    rationale: "rationale",
    missingInfo: ["browser"]
  });
  assert.equal(Object.hasOwn(parsed, "ignored"), false);
  assert.throws(() => parseSuggestionText(JSON.stringify({ priority: "critical" })), (error) => error.code === "AI_INVALID_RESPONSE");
  assert.throws(() => parseSuggestionText(JSON.stringify({ tags: ["x".repeat(33)] })), (error) => error.code === "AI_INVALID_RESPONSE");
});
