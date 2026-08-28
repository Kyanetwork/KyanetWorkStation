# 外部状态、通知补偿、备份验证与 AI Provider 边界

## 1. Scope / Trigger

本规范适用于 MeowStatus 外部 Dashboard/favicon、通知 outbox 入队 handoff、SQLite
发布前隔离备份验证和管理员 AI Provider。它们同时跨越外部输入、文件/数据库、API
和静态前端，必须在边界处限制大小、字段和错误可见性。

## 2. Signatures

- `fetchMeowStatusDashboard({ baseUrl, timeoutMs }) -> Promise<DashboardProjection>`
- `normalizeDashboard(raw) -> { profile, minecraftWidgets }`
- `createNotificationHandoff({ dbPath, entityType, entityId, providers, error }) -> Promise<{ persisted, handoffId }>`
- `listNotificationHandoffs({ dbPath, limit }) -> Promise<HandoffRecord[]>`
- `retryNotificationHandoff({ dbPath, handoffId, enqueue }) -> Promise<HandoffResult>`
- `validateNotificationHandoffRetryPayload(payload) -> { valid, data?, message? }`
- `node scripts/verify-sqlite-backup.js --backup <file.db|file.db.gz> -> JSON evidence`
- `requestProviderSuggestion({ profile, prompt, requestId, signal, fetchImpl }) -> Promise<{ text, usage, providerRequestId }>`
- `parseSuggestionText(text) -> SuggestionPayload`
- `buildCopilotInput(entityType, record) -> { entityType, id, type, title, content, status, priority?, expectedAt?, tags? }`

## 3. Contracts

### MeowStatus

- 成功响应必须是 `application/json` 或 `application/*+json`；响应体最多 512 KiB，
  读取前检查 `Content-Length`，读取过程再次按字节限制。
- 公开投影只保留 profile、Minecraft widget 和页面所需的 `config.host/port`；
  widget 最多 32 个，字符串/错误/时间字段有固定上限。
- favicon 只接受 `image/png/jpeg/jpg/gif/webp` 的 base64 raster data URL，编码文本
  最多 256 KiB、解码后最多 128 KiB，并校验对应文件头；SVG、外部 URL、非法 base64
  和超限值返回空图标。
- 超时、不可达、HTTP 错误、MIME/JSON/大小失败由公共接口转为 `unavailable`，不阻塞
  反馈或 WorkTask 提交。

### Notification handoff

- 正常投递仍写 `notification_delivery`；只有入队异常才追加私有
  `path.dirname(DB_PATH)/notification-handoff.jsonl`。
- 单条记录只允许 `handoffId/eventId/entityType/entityId/providers/status/attempts/lastError/createdAt/updatedAt`。
  providers 只允许 `smtp`/`webhook`；状态为 `pending/retrying/failed/resolved`。
- `lastError` 必须单行、长度受限并移除 URL、邮箱、密码、token、签名、正文/请求体
  等内容；journal 不保存联系方式、收件人、Webhook URL、凭据或 provider payload。
- `GET /api/admin/notification-handoffs` 只返回安全折叠记录；`POST .../retry` 只接受
  handoff UUID，重新调用幂等 outbox 入队。resolved 记录不得再次入队。
- journal 不可写时保持业务请求原有成功语义，但记录明确的持久化错误并暂停发布，
  由操作者按 event/entity ID 做人工补偿。

### SQLite 验证

- 验证脚本只接受显式 `.db`/`.db.gz` 文件，源文件 SHA-256 只输出 hash 和 basename。
- 备份在 OS 临时目录解压/复制，以 read-only `better-sqlite3` 执行
  `PRAGMA integrity_check`，检查关键表存在性和行数后关闭连接并清理临时目录。
- 输出不得包含完整路径、行内容、数据库 URL 或凭据；本地脚本成功不等于真实发布
  备份恢复已完成。

### AI Provider 与 Copilot

- profile 只允许 `openai-chat`、`openai-responses`、`anthropic-messages`；认证头由协议
  固定生成，不接受页面传入的任意 Header。Base URL 必须是绝对 `http/https` 地址，不能
  包含 userinfo、query 或 fragment；否则在验证层返回 `INVALID_PAYLOAD`。
- API Key 只在服务端短暂内存路径出现，持久化为 `AI_PROFILE_ENCRYPTION_KEY` 保护的
  AES-256-GCM 封装；列表只能返回 `keyConfigured`/掩码。AI 默认关闭，主密钥不可用时
  只返回 `AI_UNAVAILABLE`/`AI_KEY_UNAVAILABLE`，不阻塞普通业务。
- Provider 出站输入只能来自 `buildCopilotInput` 的 allow-list，必须包含不可信数据边界；
  请求超时 15 秒、响应最多 32 KiB、单进程并发最多 2，管理员建议另有 10 次/5 分钟限流。
  不记录完整 prompt/response、API Key 或带凭据的 URL。
- Provider 输出先由 `parseSuggestionText` 去 fence、解析、限制长度/枚举并丢弃未知字段；
  失败映射为 `AI_TIMEOUT`、`AI_PROVIDER_FAILED` 或 `AI_INVALID_RESPONSE`，原始上游正文
  不可进入日志、数据库或 API 错误。
- Provider `usage` 缺失或显式为 `null` 时，统一映射为 `inputTokens: null`、
  `outputTokens: null`；不得把未知用量误报为 `0`。
- 建议只写入 `ai_copilot_suggestion` 短期候选表；接受/拒绝只更新审计字段，“填入”只
  修改浏览器表单，状态、删除、公开回复和通知必须继续走现有人工确认接口。

## 4. Validation & Error Matrix

| 条件 | 结果 |
|---|---|
| Dashboard `Content-Length`/流式读取超过 512 KiB | 抛出有界大小错误，公共接口 `unavailable` |
| Dashboard 成功响应非 JSON MIME 或 JSON 无法解析 | 抛出 MIME/JSON 错误，公共接口 `unavailable` |
| MeowStatus 配置 URL 含嵌入账号/密码 | 设置校验返回 `INVALID_PAYLOAD`，不发起外部请求 |
| favicon 外部 URL、SVG、非法 base64、文件头不匹配或超限 | 投影 favicon 为 `""`，不抛公共 500 |
| outbox 入队抛错且 journal 可写 | 追加 pending handoff，业务写入/响应保持成功 |
| handoff UUID 不存在 | 管理 retry 返回 404 `NOT_FOUND` |
| handoff 状态 resolved | 不重新入队，返回 resolved 结果 |
| handoff 入队重试失败 | 追加 retrying/failed 与次数和脱敏错误 |
| SQLite 备份扩展名未知、损坏、缺关键表或 integrity 失败 | CLI 非 0，错误不含路径/秘密 |
| AI profile Base URL 含 query/fragment/userinfo 或协议未知 | 验证返回 `INVALID_PAYLOAD`，不发起外部请求 |
| AI 开关关闭、无 active profile 或主密钥无法解密 | 返回 `AI_UNAVAILABLE`/`AI_KEY_UNAVAILABLE`，普通 API 继续工作 |
| Provider 超时、非 2xx、超大响应或无效 JSON | 映射到有界 AI 错误码，不保存建议，不记录原始正文 |

## 5. Good / Base / Bad Cases

- Good：外部 JSON 通过大小/MIME 后只映射 allow-list；outbox 入队异常有 JSONL 记录，
  管理员可查询并一次次幂等重试；备份摘要仅含 hash/表计数。
- Base：MeowStatus/SMTP/Webhook 关闭时核心提交成功，不生成无意义 handoff；SQLite
  合成备份在临时只读连接通过完整性检查。
- Bad：把上游原始对象、favicon SVG、Webhook URL、收件人/正文或数据库路径写入
  公共响应、日志或 handoff；把 API Key 放进 URL query；用 stub 或 CLI 退出 0 冒充
  真实代理/备份/通知证据。
- Good AI：只使用固定协议认证和无 query 的 Base URL，最小化投影后调用 Provider，
  无效输出被丢弃并保留可审计的短期候选状态。
- Bad AI：把自定义 Header、联系方式、管理员备注或完整 Provider 响应直接转发给浏览器。

## 6. Tests Required

- `tests/meowstatus.test.js`：JSON MIME、Content-Length/流式大小、非法 JSON、超时、
  字段/数量 allow-list、favicon raster/非法/超限和空图标断言。
- `tests/notification-handoff.test.js`：journal 路径/权限、脱敏字段、折叠、并发追加、
  retrying/failed、resolved 不重放和损坏行容错断言。
- `tests/account-submission.test.js`：删除 outbox 表后业务仍成功、handoff 管理查询和
  重试 envelope 断言。
- `tests/backup-sqlite.test.js`：`.db.gz` hash/integrity/schema/关键表计数、损坏 gzip、
  缺表和未知扩展名非 0 断言。
- `tests/validation.test.js`、`tests/ai-profiles.test.js`、`tests/ai-provider.test.js`、
  `tests/ai-copilot.test.js`、`tests/admin-ai.test.js`：Base URL query 拒绝、协议认证、
  脱敏投影、大小/超时/并发、输出 schema、未知 usage、短期候选和人工决策边界。
- 发布前人工记录 D-004/V-002/V-003 的真实代理、脱敏备份和 SMTP/Webhook 证据；自动
  测试不得被描述为真实环境证据。

## 7. Wrong vs Correct

### Wrong

```js
const body = await response.json();
return res.json({ ok: true, data: body });
```

### Correct

```js
const body = await readResponseTextBounded(response, MAX_DASHBOARD_BYTES);
if (!isJsonContentType(response)) throw new Error("MeowStatus API 响应 MIME 不是 JSON");
return normalizeDashboard(JSON.parse(body));
```

### Wrong

```js
catch (error) {
  logger.error({ error: error.message });
  return [];
}
```

### Wrong AI URL

```js
const url = `${baseUrl}/chat/completions?api_key=${apiKey}`;
```

### Correct AI URL

```js
// baseUrl 已在验证层拒绝 query/fragment/userinfo；密钥只放协议固定的请求头。
const url = `${baseUrl}/chat/completions`;
const headers = { Authorization: `Bearer ${apiKey}` };
```

### Correct

```js
catch (error) {
  await createNotificationHandoff({ dbPath, entityType, entityId, providers, error });
  logger.error({ event: "notification.outbox.enqueue.error", error: sanitizeError(error) });
  return [];
}
```
