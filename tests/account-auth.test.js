const test = require("node:test");
const assert = require("node:assert/strict");

const {
  defaultPolicy,
  createPolicyCache,
  fetchWorkstationPolicy,
  exchangeLoginTicket
} = require("../server/account-auth");

test("policy cache fails closed when policy fetch fails", async () => {
  const cache = createPolicyCache({
    ttlMs: 60000,
    fetchPolicy: async () => {
      throw new Error("network unavailable");
    }
  });

  const policy = await cache.getPolicy();

  assert.deepEqual(policy, defaultPolicy);
  assert.equal(policy.feedbackRequiresLogin, true);
  assert.equal(policy.worktaskRequiresLogin, true);
  assert.equal(policy.allowAnonymousSubmission, false);
});

test("ticket exchange uses bearer integration secret and returns account user", async () => {
  let requestUrl = "";
  let requestOptions = null;
  const fetchImpl = async (url, options) => {
    requestUrl = url;
    requestOptions = options;
    return {
      ok: true,
      async json() {
        return {
          ok: true,
          user: {
            id: "acct_1",
            email: "user@example.com",
            displayName: "Kyan"
          }
        };
      }
    };
  };

  const user = await exchangeLoginTicket({
    ticket: "ticket-secret-value",
    baseUrl: "http://account.local",
    secret: "integration-secret",
    fetchImpl,
    timeoutMs: 5000
  });

  assert.equal(requestUrl, "http://account.local/api/integrations/workstation/login-ticket/exchange");
  assert.equal(requestOptions.method, "POST");
  assert.equal(requestOptions.headers.Authorization, "Bearer integration-secret");
  assert.equal(requestOptions.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(requestOptions.body), { ticket: "ticket-secret-value" });
  assert.deepEqual(user, {
    id: "acct_1",
    email: "user@example.com",
    displayName: "Kyan"
  });
});

test("ticket exchange reads display name from KyanetAccount profile payload", async () => {
  const user = await exchangeLoginTicket({
    ticket: "ticket-secret-value",
    baseUrl: "http://account.local",
    secret: "integration-secret",
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          user: {
            id: "acct_1",
            email: "user@example.com",
            roles: ["USER"],
            profile: {
              displayName: "测试用户",
              avatarUrl: null
            }
          }
        };
      }
    }),
    timeoutMs: 5000
  });

  assert.deepEqual(user, {
    id: "acct_1",
    email: "user@example.com",
    displayName: "测试用户"
  });
});

test("ticket exchange rejects missing integration secret with Chinese message", async () => {
  await assert.rejects(
    () => exchangeLoginTicket({
      ticket: "ticket-secret-value",
      baseUrl: "http://account.local",
      secret: "",
      fetchImpl: async () => {
        throw new Error("fetch should not be called");
      },
      timeoutMs: 5000
    }),
    /账号接入密钥未配置/
  );
});

test("ticket exchange rejects non-ok response with Chinese message", async () => {
  await assert.rejects(
    () => exchangeLoginTicket({
      ticket: "ticket-secret-value",
      baseUrl: "http://account.local",
      secret: "integration-secret",
      fetchImpl: async () => ({
        ok: false,
        status: 403,
        async json() {
          return { ok: false };
        }
      }),
      timeoutMs: 5000
    }),
    /账号登录票据校验失败/
  );
});
