# Provider 真实诊断与 AI 指标研究

研究日期：2026-08-31  
研究范围：当前 `server/ai-provider.js`、`server/ai-copilot.js`、`server/ai-knowledge.js`、`server/db.js`，以及它们的路由、配置、审计和测试边界。  
本文件只记录研究结论和设计建议，不包含产品代码修改。

## 1. 当前实现证据

### 1.1 Provider 适配器是唯一的出站边界

`server/ai-provider.js:138-197` 的 `requestDefinition` 已经把三种协议收敛到同一内部请求形状；`requestProviderSuggestion`（`server/ai-provider.js:199-261`）负责真实 `fetch`、超时、响应读取、JSON 解析、文本提取和统一错误映射。

| 内部协议 | Endpoint 生成 | 认证头 | 请求核心字段 | 当前文本提取 |
| --- | --- | --- | --- | --- |
| `openai-chat` | Base URL + `/chat/completions` | `Authorization: Bearer <key>` | `model`、`messages` | `choices[0].message.content` |
| `openai-responses` | Base URL + `/responses` | `Authorization: Bearer <key>` | `model`、`input` | `output_text`，否则 `output[].content` |
| `anthropic-messages` | Base URL + `/messages` | `x-api-key`、固定 `anthropic-version` | `model`、`max_tokens`、`messages` | `content[]` |

`textFromContent`（`server/ai-provider.js:51-60`）允许字符串以及带 `text`/`content` 的数组项，适合三协议的常见响应形态。Provider profile 当前只允许这三个协议；DeepSeek、GLM/Z.ai 和一般中转站应继续选择 `openai-chat`，不需要额外厂商适配器。

### 1.2 当前请求边界和安全限制

- Base URL 由 `normalizeProviderBaseUrl` 校验为无 userinfo、query、fragment 的 `http/https` 地址，再由 `buildProviderEndpoint` 避免已包含协议路径时重复拼接（`server/ai-provider.js:15-40`）。Profile 写入层也有同等校验（`server/ai-profiles.js`、`server/validation.js:620-644`）。
- 超时上限固定为 15 秒；传入的 `timeoutMs` 只能取正数并被截断到 15 秒（`server/ai-provider.js:1-2,199-212`）。外部 `AbortSignal`、内部 timer 和 Provider 的 `AbortError` 当前都映射为 `AI_TIMEOUT`。
- 响应先检查 `Content-Length`，流式读取或 `response.text()` 时再次限制 32 KiB（`server/ai-provider.js:97-136`）。超限映射为 `AI_INVALID_RESPONSE`，不会把上游正文带入错误。
- 非 2xx 在读取正文之前即映射为 `AI_PROVIDER_FAILED`（`server/ai-provider.js:229-233`），因此不应为了诊断再读取错误正文。
- API Key 只由 profile 解密后短暂传给 Provider；浏览器 DTO 只拿到 `keyConfigured`/掩码（`server/ai-profiles.js`）。
- Provider 请求参数中的 `requestId` 目前只是 `requestProviderSuggestion` 的形参，`server/ai-provider.js:199` 没有把它写入请求头或 body。应用侧 request ID 由 `requestLoggerMiddleware` 生成并写入本地日志/响应头（`server/logger.js`），Copilot 仅在日志上下文中使用它（`server/ai-copilot.js:252-263`）。

### 1.3 当前上层调用、usage 和错误

Copilot 的 `generateSuggestion`（`server/ai-copilot.js:252-357`）会读取业务记录、取 active profile、服务端解密 key、构造固定安全 prompt，然后调用 Provider；Provider 返回后由 `parseSuggestionText` 校验 JSON，再写 `ai_copilot_suggestion`。成功/失败日志包含请求 ID、profile、协议、模型和 `durationMs`，但没有持久化指标。

知识问答的 `askKnowledge`（`server/ai-knowledge.js:287-371`）在检索索引并取得 active profile 后调用同一个 Provider，解析 `answer/basis/citedSourceIds/caveats`，再写 `ai_knowledge_answer`。当前没有请求耗时日志；回答 DTO 会安全返回 Provider request ID（最多 128 字符）。

当前稳定错误码主要是：

| 阶段 | 错误码 | 现有含义 |
| --- | --- | --- |
| 开关/配置 | `AI_UNAVAILABLE`、`AI_KEY_UNAVAILABLE` | AI 关闭、无 active profile 或 key 不可解密 |
| 并发/限流 | `AI_BUSY`、`AI_RATE_LIMITED` | Copilot 并发上限或路由频率限制 |
| 传输 | `AI_TIMEOUT` | 超时、AbortError 或外部 signal abort |
| Provider HTTP/网络 | `AI_PROVIDER_FAILED` | 非 2xx、网络/DNS/TLS/其他 fetch 异常、请求配置不完整 |
| Provider 响应 | `AI_INVALID_RESPONSE` | 超大正文、JSON 无法解析、文本字段缺失或建议 JSON 无效 |
| 本地持久化 | `AI_KNOWLEDGE_PERSIST_FAILED` 等 | Provider 之后的业务历史/候选写入失败 |

`server/ai-copilot.js:158-165` 和 `server/ai-knowledge.js:141-151` 分别实现 usage 归一化，均将未知 token 表示为 `null`；Provider 层 `mapUsage`（`server/ai-provider.js:77-87`）读取 `input_tokens/prompt_tokens/inputTokens` 和 `output_tokens/completion_tokens/outputTokens`。

## 2. 发现的缺口和需要保留的边界

1. **没有任意 profile 的读取接口。** `server/ai-profiles.js` 只导出 `getActiveProfileSnapshot`；真实诊断不能临时切换 active profile，建议增加只读的 `getProfileSnapshot(profileId)`，仍返回服务端副本，key 只在诊断服务内解密。
2. **Provider 层阶段信息被统一错误码压平。** 现有业务调用需要继续看到原有 `{text, usage, providerRequestId}` 契约；诊断若直接调用并捕获错误，无法判断是 HTTP、JSON、文本还是响应大小失败。因此应在 `ai-provider.js` 内部抽取一个共用请求核心，保留 `requestProviderSuggestion` 的兼容返回值，另提供仅供诊断使用的阶段投影；不要在路由中自行 `fetch`。
3. **`requestId` 没有出站用途。** 诊断应把本地 `req.requestId` 用于日志和审计关联，把响应中的上游 `x-request-id`/body `id` 单独命名为 `providerRequestId`。不应把用户传入的任意值作为 Provider URL、query 或未校验的自定义认证头。
4. **Provider request ID 目前只有长度限制。** `providerRequestId`（`server/ai-provider.js:89-95`）应在诊断返回/审计前去除控制字符，并只接受有界、可打印的摘要（例如 `[A-Za-z0-9._:-]`，不匹配则返回空字符串）。指标表不需要保存这个高基数字段。
5. **usage 的显式 null/空值存在误报风险。** `mapUsage` 用 `Number(input)` 判断；若字段显式为 `null` 或空字符串，可能变成 `0`，而不是未知的 `null`。新的公共归一化函数应先排除 `null`、空字符串、布尔值和非安全整数，再接受安全整数/明确的数字字符串。Copilot、知识问答、诊断和指标写入应共用同一语义：缺失、显式 null 或非法值均为 `null`，不能把未知用量计成 0。
6. **当前 timeout 会混淆客户端断开。** 外部 signal abort 也会得到 `AI_TIMEOUT`。首版可保持现有业务语义以避免回归；如果诊断路由绑定 `req.close`，建议内部区分 `deadline` 与 `client_abort`，后者不应对外宣称 Provider 超时。若暂不扩展错误码，至少在指标记录前只把真正达到内部 deadline 的请求计为 `timeout`，客户端断开可归入 `failed/AI_PROVIDER_FAILED` 或不记录。
7. **Provider 成功与本地持久化失败的边界需明确。** 指标应定义为“管理员 AI 操作结果”还是“Provider 调用结果”。建议首版定义为操作结果：Copilot/知识问答解析并持久化均完成才是 `success`；若 Provider 成功但本地历史/候选写入失败，记录 `failed` 和现有持久化错误码，但保留已取得的 usage。诊断没有本地持久化步骤，其 Provider 通过即为 `success`。

## 3. 最小真实诊断探针建议

### 3.1 调用路径

推荐增加独立的诊断服务函数和管理员路由：

```text
POST /api/admin/ai/profiles/diagnose
  → 校验 profileId
  → getProfileSnapshot(profileId)（不改 activeProfileId）
  → decryptProfileApiKey(profile)
  → requestProviderDiagnostic(profile, fixedPrompt, requestId, signal)
  → 安全结果 DTO + ai.profile.diagnose 审计
```

路由继续位于现有 `/api/admin` 安全中间件之后（`server/app.js:624-626`），沿用管理员 session、同源校验、JSON 校验和 rate limit。诊断必须是显式 POST；不在页面加载、启动、定时器或普通 Copilot/知识请求中自动运行。建议使用独立的小限流器，避免诊断消耗 Copilot/知识问答配额；个人使用场景可先采用每管理员/IP 5 次/5 分钟。

请求体只允许 `{ profileId }`，不接受 base URL、模型、key、任意 prompt 或任意 Header。未知 profile、AI 关闭、key 不可用仍使用现有 envelope 和稳定错误码；这些情况没有真实出站请求，不应伪造为 Provider 可用。

### 3.2 探针内容和三协议行为

固定 prompt 应为无业务数据的常量，例如：

```text
KyanetWorkStation provider diagnostic. Reply with exactly KWS_DIAGNOSTIC_OK and nothing else.
```

它的目标是验证网络、认证、endpoint、JSON 响应、当前协议文本提取和模型能否完成最小指令，而不是测量模型完整能力。探针应复用 `requestDefinition`、`readResponseTextBounded`、AbortController 和现有认证生成；不要在 app.js 中复制请求逻辑。

- `openai-chat`：仍发 `/chat/completions`、Bearer 和 `messages`，不带 `reasoning`。
- `openai-responses`：仍发 `/responses`、Bearer 和 `input`；profile 中的 `low/medium/high/xhigh/max` 继续映射为 `reasoning: { effort }`。2xx 只能说明请求被接受，不能在页面文案中宣称模型具备该级别推理能力。
- `anthropic-messages`：仍发 `/messages`、`x-api-key`、`anthropic-version` 和 Messages body，不带 Responses 专属 `reasoning`。

现有 Anthropic body 的 `max_tokens` 为 1200、Chat 没有额外的 `max_tokens`，Responses 也没有新增输出上限。为保证兼容性，首版只用短 prompt，不擅自给三协议追加不一定被中转站支持的参数；成本仍以 Provider 实际计费为准，并在 UI 明确“这是一次真实上游请求，可能消耗少量 token”。

如果响应文本不是精确的 `KWS_DIAGNOSTIC_OK`，建议标记 `textExtracted=true`、`probeMatched=false`，并将诊断结果判为 `AI_INVALID_RESPONSE`。这样可以区分“Provider 返回了文本”与“最小契约通过”，又不需要把上游文本返回浏览器。

### 3.3 安全诊断结果 DTO

建议只返回以下有界字段（字段名可按现有前端风格调整）：

```json
{
  "profileId": "profile-1",
  "protocol": "openai-chat",
  "model": "gpt-5.6",
  "status": "success",
  "reachable": true,
  "httpStatus": 200,
  "responseWithinLimit": true,
  "jsonParsed": true,
  "textExtracted": true,
  "probeMatched": true,
  "usageReturned": false,
  "usage": { "inputTokens": null, "outputTokens": null },
  "providerRequestId": "req_abc123",
  "durationMs": 842,
  "reasoningEffortSent": false,
  "errorCode": ""
}
```

失败 DTO 仍返回诊断区域可显示的安全投影，不返回上游 response body、错误 message、完整 URL、query、key 或 prompt：

| 状况 | `status` | `reachable` | 阶段投影 | `errorCode` |
| --- | --- | --- | --- | --- |
| HTTP 2xx + JSON + 文本 + sentinel | `success` | `true` | `jsonParsed/textExtracted/probeMatched=true` | 空 |
| HTTP 2xx，但 JSON 无法解析/响应超限 | `failed` | `true` | `jsonParsed=false` 或 `responseWithinLimit=false` | `AI_INVALID_RESPONSE` |
| HTTP 2xx + JSON，但没有文本 | `failed` | `true` | `jsonParsed=true,textExtracted=false` | `AI_INVALID_RESPONSE` |
| 非 2xx | `failed` | `true` | HTTP 失败；不读取/转发正文 | `AI_PROVIDER_FAILED` |
| timeout | `timeout` | `false` | 未完成响应 | `AI_TIMEOUT` |
| DNS/TLS/连接失败 | `failed` | `false` | transport failure | `AI_PROVIDER_FAILED` |
| profile/key/config 在出站前失败 | `failed` | `false` | not attempted | 原有 `AI_UNAVAILABLE`/`AI_KEY_UNAVAILABLE` |

`httpStatus` 只接受 100–599 的整数，否则为空；`durationMs`、计数和 ID 都要有上限。`usageReturned` 表示响应是否含有可解析的 usage 对象；即使为 false 也不让诊断失败，token 字段按未知处理。`providerRequestId` 只来自响应头 `x-request-id` 或响应 JSON `id`，经字符过滤/长度限制后返回。

### 3.4 审计与指标的诊断关系

诊断成功和失败都写 `admin_audit` 的 `ai.profile.diagnose` action；metadata 只保留 `profileId`、协议、模型摘要、结果状态、阶段布尔值、duration、usage 是否返回、稳定错误码和 `reasoningEffortSent` 等白名单摘要。不要把 Provider request ID、endpoint、响应文本或 token 之外的响应对象写入审计；若确需关联，优先只记录 `providerRequestIdPresent` 布尔值。

诊断的指标 operation 建议固定为 `provider_diagnostic`。诊断请求本身只执行一次 Provider 调用，不创建 Copilot 建议或知识问答历史。

## 4. AI 指标最小设计

### 4.1 指标语义和字段

新增一个小型 `ai_request_metric` 表，并在 `server/ai-metrics.js` 集中做归一化、写入、汇总和清理，避免把相同 SQL/状态判断分别复制到 Copilot、知识助手和路由。推荐稳定 operation 值：`copilot_suggest`、`knowledge_ask`、`provider_diagnostic`；status 值：`success`、`failed`、`timeout`。

建议字段：

| 字段 | 语义与边界 |
| --- | --- |
| `id` | 内部自增主键，不返回逐请求列表 |
| `operation` | 固定枚举字符串，最多 32 字符 |
| `profile_id` | profile ID 摘要，最多 128；未选中时为空 |
| `protocol` | 三协议之一或空，最多 64 |
| `model` | 模型标识摘要，最多 120；若误传 URL 必须丢弃 |
| `status` | 仅 `success/failed/timeout` |
| `duration_ms` | 非负安全整数，建议限制到 0–60,000（Provider 上限 15 秒，含本地收尾仍有界） |
| `input_tokens` | 已知时非负整数，未知为 SQL `NULL` |
| `output_tokens` | 已知时非负整数，未知为 SQL `NULL` |
| `usage_present` | 响应是否返回可识别 usage 对象；跨数据库布尔映射 |
| `error_code` | 成功为空；失败只允许稳定码正则，最多 64 |
| `created_at` | UTC ISO 时间，使用现有 `nowIso()` |

不存储 prompt、response、业务内容、完整 Base URL、key、local request ID、Provider request ID、联系方式或账号快照。request ID 只在本地结构化日志/审计中短期关联，避免指标高基数和敏感信息。

指标应使用“操作结果”语义，并在 Provider 调用前开始计时、在业务解析和必要的建议/历史持久化完成后结束：

- Copilot Provider 非 2xx、超时、无效建议 JSON，以及建议写入失败都记录 `failed`/`timeout`；Provider 返回的 usage 仍保留。
- 知识问答同理；配置无效、索引不可用、问题校验失败等没有实际 AI 调用的请求可不写 AI 指标，避免把本地输入错误伪装成 Provider 失败。若产品希望监控“按钮点击失败”，应另加明确的 `attempted`/`preflight` 语义，不能混入三种状态。
- 诊断的结果 DTO 即为操作结果；真实 Provider 通过并匹配 sentinel 才是 `success`。

所有 metric DB 写入必须是 best-effort：由 `recordAiMetricSafely` 捕获数据库/序列化异常，记录只含 operation、status、errorCode 的受控 warning，不改变 AI 主请求的成功/失败，也不把 DB error message 原文打入日志。读汇总失败只让汇总接口返回受控服务不可用，不阻塞 Copilot、知识问答和诊断。

### 4.2 跨数据库等价 schema

在三组现有 schema factory 中各加入等价的 `ai_request_metric` 表和时间索引。建议结构如下；具体 SQL 应匹配 `server/db.js` 当前的 placeholder 和自增风格。

SQLite：

```sql
CREATE TABLE IF NOT EXISTS ai_request_metric (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation TEXT NOT NULL,
  profile_id TEXT NOT NULL DEFAULT '',
  protocol TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  usage_present INTEGER NOT NULL DEFAULT 0,
  error_code TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_request_metric_created_at
  ON ai_request_metric(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_request_metric_operation_created
  ON ai_request_metric(operation, created_at DESC);
```

MySQL：使用 `BIGINT AUTO_INCREMENT` 主键、`VARCHAR(32/128/64/120/32/64)` 对应字符串、`BIGINT` token/duration、`TINYINT(1)` 的 `usage_present`、`VARCHAR(40)` 时间，并把两个 index 写入 `CREATE TABLE` 的 inline index 列表。  
PostgreSQL：使用 `BIGSERIAL` 主键、`TEXT` 或相同长度约束的字符串、`BIGINT` token/duration、`BOOLEAN NOT NULL DEFAULT FALSE`，再用 `CREATE INDEX IF NOT EXISTS` 建两个索引。

应用层必须在写入前限制 operation/status/protocol，profile/model/error code 做长度和 URL-like 过滤，duration/token 只接受非负安全整数；数据库类型差异通过现有 `toDbBoolean`/`toBoolean` 和 `toNumber` 边界处理。不要依赖 SQLite 的宽松类型来代替应用校验。

由于这是全新表，`initializeDatabase()` 当前的 `CREATE TABLE IF NOT EXISTS` 路径已经能让旧数据库幂等增加它，既有表/数据不需迁移或删除。仍应让三个 factory 同时更新，并加入旧 SQLite 启动幂等测试；如果未来为指标增加列，再按 `columnExists`/兼容 helper 顺序迁移。

### 4.3 汇总查询

提供一个管理员只读接口，例如 `GET /api/admin/ai/metrics/summary`。输入只允许有界 UTC 时间窗（默认最近 30 天，建议首版最多 365 天；不能让用户传入任意 SQL 或无界 offset），可选 operation/protocol 固定枚举。返回聚合 DTO，不返回逐请求记录：

```json
{
  "from": "2026-08-01T00:00:00.000Z",
  "to": "2026-08-31T00:00:00.000Z",
  "total": 12,
  "success": 9,
  "failed": 2,
  "timeout": 1,
  "averageDurationMs": 842,
  "inputTokens": 1234,
  "outputTokens": 678,
  "unknownUsageCount": 4,
  "groups": [
    { "operation": "knowledge_ask", "protocol": "openai-chat", "total": 5, "success": 4, "failed": 1, "timeout": 0, "averageDurationMs": 701, "inputTokens": 900, "outputTokens": 420, "unknownUsageCount": 1 }
  ]
}
```

跨 SQLite/MySQL/PostgreSQL 不使用数据库特有的 `FILTER` 或日期函数：由应用计算 `from/to` ISO 字符串，SQL 只使用参数化的 `created_at >= ? AND created_at < ?`（PostgreSQL 为 `$1/$2`）。状态/token 聚合使用 `SUM(CASE WHEN ... THEN ... ELSE ... END)`；MySQL/PostgreSQL 可能返回字符串或 bigint，映射时再做安全整数校验。平均耗时为空时返回 `null`，不要把无数据误报为 0。

汇总至少拆成一个总计查询和一个按 `operation, protocol` 的有界分组查询。分组结果限制为最多 100 组并按总量降序/固定字段顺序排序；即使当前 profile 最多 8 个，也不能把这个内部事实当成未来无界查询的安全边界。`unknownUsageCount` 定义为 `input_tokens IS NULL OR output_tokens IS NULL` 的行数；`usage_present=true` 但其中一个 token 缺失仍属于 unknown。

### 4.4 保留期和清理

新增配置：

- `AI_METRICS_RETENTION_DAYS`：默认 30，严格接受 1–3650；放入 `rawInput` 和 `validateRuntimeConfig`，与知识历史保留期使用相同的显式非法值检查。
- `AI_METRICS_AUTO_CLEANUP`：建议默认 true，接受现有 boolean-like 值。单独开关比用 `RETENTION_DAYS=0` 表示关闭更清楚，也不破坏 1–3650 的边界。

启动时和每小时调用 `deleteExpiredAiRequestMetrics(cutoff)`，其中 cutoff 由当前 UTC 时间减 retention days 计算；SQL 只按有索引的 `created_at < cutoff` 删除。关闭自动清理时不执行启动/定时删除，但读汇总仍只查询用户指定且受界限的窗口；如 UI 需要手动清理，可复用管理员受保护 POST 并返回删除行数。清理异常只写 warning，不阻塞启动、Provider 或正常业务。

不使用 `expires_at`：指标没有单条业务生命周期，基于 `created_at` 的 cutoff 更直接，也避免误把未来创建时间的记录删除。清理函数应返回受控 affected row count，日志不得包含数据库路径、连接串或原始错误正文。

## 5. 测试与实施顺序建议

1. **Provider 核心回归**：在现有 `tests/ai-provider.test.js` 中为三协议各增加真实诊断服务所需 stub。断言 endpoint、固定 prompt 无业务字段、认证头、Responses reasoning 映射、Chat/Anthropic 不带 reasoning、request ID 提取、超时、非 2xx、32 KiB 超限、无效 JSON、无文本和缺失/null usage；断言错误响应正文不会进入错误/结果。
2. **诊断服务/路由**：用依赖注入 stub 验证非 active profile 诊断不会变更 active ID，不创建 suggestion/knowledge history；未登录、同源/JSON、未知 profile、AI 关闭、key 不可解密和 rate limit 使用稳定 envelope；三协议结果只返回安全投影，审计 metadata 通过白名单。
3. **usage 单元测试**：补充 `null`、空字符串、布尔、数字字符串、小数、负数和超安全整数用例，确保未知永远是 `null`，不会变成 0。
4. **数据库测试**：SQLite 创建/插入/映射/汇总/清理及重复初始化；断言 `NULL` token、usage_present、状态计数、平均耗时、unknownUsageCount、时间窗和最多 100 组。静态断言 SQLite/MySQL/PostgreSQL 三 factory 都声明表及两个索引；保留 MySQL/PostgreSQL 参数 placeholder 路径测试。
5. **失败隔离**：注入 `createAiRequestMetric` 抛错，Copilot、知识问答和诊断的主返回结果仍保持原语义，仅出现受控 warning；注入汇总查询失败时只返回管理端服务不可用。
6. **前端/文档与发布门禁**：补齐 API、配置、运维说明和 UI 的亮暗主题/键盘/窄屏/直角控件；运行 `node --check`、聚焦 node:test、`npm test`、`npm audit --omit=dev`、`git diff --check` 和 Trellis 校验。真实 Provider 测试只能作为管理员点击诊断时的部署 smoke，不应进入自动化测试或 CI。

## 6. 结论

- 最小且低风险的实现是复用现有 Provider 请求边界，增加一个只发送固定 sentinel prompt 的真实诊断投影；不切 active profile、不复制 fetch、不保存上游正文。
- Copilot/知识问答/诊断共享一个有界 metrics service 和一张按时间索引的 `ai_request_metric` 表；数据库写入 best-effort，汇总只给聚合数据。
- 三协议的差异只停留在 `ai-provider.js` 适配器；DeepSeek、GLM/Z.ai 和兼容中转站继续走 `openai-chat`。
- 首先应修正 usage 的显式 null/非法值归一化和 Provider request ID 的字符边界，再接入诊断与指标，避免新 UI 把旧的 0 或不安全 ID 当成可靠观测数据。
- 真实诊断只能证明一次网络/认证/响应契约和短指令通过，不能证明模型的完整能力、稳定性、计费准确性或未来请求一定成功；页面文案应明确这一点。
