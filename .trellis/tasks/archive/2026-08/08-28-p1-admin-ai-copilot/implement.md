# P1 管理员 AI Copilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the Trellis implementation workflow and execute the tasks below in order. Each task is independently testable; do not start implementation until this plan is approved and `task.py start` has set the task to `in_progress`.

**Goal:** 在现有管理员工作收件箱中加入默认关闭、可切换 Provider、加密 profile、脱敏建议和人工确认的 AI Copilot。

**Architecture:** 通过 `server/ai-profiles.js` 管理 `workstation_setting` 中的 AES-256-GCM profile，`server/ai-provider.js` 隔离三种协议，`server/ai-copilot.js` 负责最小输入、相似度、限流/超时和候选持久化；`app.js` 只编排已认证路由。建议结果存入新增的有界 `ai_copilot_suggestion` 表，业务表和通知 outbox 不被 AI 写入。

**Tech Stack:** Node.js 24 CommonJS、Express、Node 内置 `fetch`/`crypto`/`AbortController`、现有 SQLite/MySQL/PostgreSQL `server/db.js` 适配、原生 HTML/CSS/JavaScript、Node `node:test`。

---

## 依赖与执行顺序

1. 先完成配置/加密纯函数和数据库契约，再实现 profile 管理。
2. profile 契约通过后实现 Provider 适配器，再实现 Copilot 编排。
3. 后端 API 和测试通过后接入管理员 UI。
4. 最后同步公开文档、运行完整质量门禁，并由 `trellis-check` 做跨层复核。

## Task 1: 配置闸门与 AES-GCM 边界

**Files:**

- Modify: `server/config.js:73-188,200-257`，加入 `AI_COPILOT_ENABLED`、`AI_PROFILE_ENCRYPTION_KEY` 和不含密钥的 `profileEncryptionKeyValid` 判断。
- Create: `server/ai-profiles.js`，先放置纯函数 `parseMasterKey`、`encryptApiKey`、`decryptApiKey`、`maskApiKey` 的实现。
- Test: `tests/config.test.js`、`tests/ai-profiles.test.js`。
- Modify: `.env.example`，只加入两个 AI 变量及安全注释。

- [ ] **Step 1: 写失败测试**

  在 `tests/config.test.js` 增加四个断言：默认 `ai.enabled === false`；`AI_COPILOT_ENABLED=true` 且密钥为空时 `ai.profileEncryptionKeyValid === false`；64 位十六进制密钥被识别为有效 32 字节；错误密钥的错误列表不包含密钥原文。`tests/ai-profiles.test.js` 增加：同一 profile ID 加密后每次 IV 不同；正确 AAD 可解密；错误 profile ID/AAD 和篡改 authTag 抛出统一 `AI_KEY_UNAVAILABLE`；`maskApiKey("sk-test-123456")` 不包含原文。

- [ ] **Step 2: 运行失败测试**

  运行 `node --test tests/config.test.js tests/ai-profiles.test.js`；预期新断言因 `config.ai` 和加密函数不存在而失败，现有测试仍保持可加载。

- [ ] **Step 3: 实现最小配置与加密代码**

  `server/config.js` 只读取两个环境变量，并以如下结构导出，不导出解密后的 profile：

  ```js
  ai: {
    enabled: parseBoolOrDefault(process.env.AI_COPILOT_ENABLED, false),
    profileEncryptionKey: process.env.AI_PROFILE_ENCRYPTION_KEY || "",
    profileEncryptionKeyValid: /^[a-f0-9]{64}$/iu.test(process.env.AI_PROFILE_ENCRYPTION_KEY || "")
  }
  ```

  `server/ai-profiles.js` 使用 `crypto.createCipheriv("aes-256-gcm", key, iv)` 和 `crypto.createDecipheriv`，envelope 固定返回 `{ version: 1, algorithm: "aes-256-gcm", keyId: "kws-ai-v1", iv, ciphertext, authTag }`，IV 使用 12 字节随机值，profile ID 作为 AAD；所有异常统一映射为带 `code = "AI_KEY_UNAVAILABLE"` 的错误。导出 `parseMasterKey`, `encryptApiKey`, `decryptApiKey`, `maskApiKey`，不导出原始密钥日志辅助函数。

- [ ] **Step 4: 运行通过测试**

  运行 `node --test tests/config.test.js tests/ai-profiles.test.js`；预期全部通过，并确认测试输出不出现测试 API Key。

- [ ] **Step 5: 更新示例配置并检查差异**

  在 `.env.example` 写入 `AI_COPILOT_ENABLED=false`、`AI_PROFILE_ENCRYPTION_KEY=` 和“生产使用 64 位十六进制、独立于数据库备份、不要提交”的说明；运行 `git diff --check`。

## Task 2: 数据库设置封装与建议表

**Files:**

- Modify: `server/db.js:158-470,765-850,1690-1735`，加入三数据库 `ai_copilot_suggestion` schema、AI profile 设置包装函数和建议 CRUD/过期清理。
- Create: `tests/ai-db.test.js`，使用临时 SQLite 验证映射、过期过滤和决策更新。
- Modify: `tests/backup-sqlite.test.js`，更新关键表列表和设置数量断言。

- [ ] **Step 1: 写失败数据库测试**

  `tests/ai-db.test.js` 初始化临时 SQLite，断言 `setAiProviderProfiles` 后 `getAiProviderProfiles` 保持 JSON 版本/active/profile 元数据；创建一条 suggestion 后 `listAiSuggestions` 返回未过期记录，过期记录不可见；`recordAiSuggestionDecision(id, "accepted", ["replyDraft"], "admin")` 只更新 suggestion 行。测试结束调用 `closeDatabase()` 并删除临时目录。

- [ ] **Step 2: 运行失败测试**

  运行 `node --test tests/ai-db.test.js`；预期因导出函数和表不存在而失败。

- [ ] **Step 3: 增加跨数据库 schema 和参数化查询**

  在 `sqliteSchemaStatements`、`mysqlSchemaStatements`、`postgresSchemaStatements` 各加入等价的 `ai_copilot_suggestion` 表和 `(entity_type, entity_id, created_at)`、`expires_at` 索引。字段至少包含 `id/entity_type/entity_id/profile_id/protocol/model/status/result_json/accepted_fields/decided_by/decided_at/created_at/expires_at`。新增函数只通过现有 `placeholder`、`queryOne/queryAll/execute`，禁止在路由中调用驱动；所有返回值映射为 camelCase。

- [ ] **Step 4: 实现设置与建议函数**

  在 `db.js` 增加以下明确接口并导出：

  ```js
  getAiProviderProfiles() -> Promise<object>
  setAiProviderProfiles(value) -> Promise<object>
  createAiSuggestion(input) -> Promise<number>
  getAiSuggestionById(id) -> Promise<object|null>
  listAiSuggestions({ entityType, entityId, now }) -> Promise<object[]>
  recordAiSuggestionDecision(id, decision, fields, actor) -> Promise<number>
  deleteExpiredAiSuggestions(now) -> Promise<number>
  ```

  `listAiSuggestions` 必须带 `expires_at > now`；`recordAiSuggestionDecision` 只允许 `available` 状态，且 `fields` 由调用者传入的已验证 allow-list 再次过滤。

- [ ] **Step 5: 运行数据库回归**

  运行 `node --test tests/ai-db.test.js tests/backup-sqlite.test.js`；预期通过，且备份测试的 SQLite 表清单包含新表，旧两项 `workstation_setting` 断言按新增 AI 设置初始化行为更新。

## Task 3: Profile 规范化、热切换与管理员配置 API

**Files:**

- Modify: `server/ai-profiles.js`，加入 profile JSON 规范化、串行写锁、掩码 DTO 和 active 切换。
- Modify: `server/validation.js`，加入 `validateAiProfilePayload`、`validateAiProfileActivePayload`、`validateAiProfileDeletePayload`。
- Modify: `server/app.js:10-90,430-470`，注册 profile status/save/active/delete 路由。
- Create: `tests/ai-profile-api.test.js`，使用临时应用子进程或可注入模块验证会话、掩码和冲突状态。

- [ ] **Step 1: 写失败纯函数与验证测试**

  断言 profile 只接受三种协议；Base URL 拒绝非 `http/https`、userinfo、fragment 和空 host；名称/模型/Key 有长度上限；创建缺 Key 失败、更新空 Key 保留旧密文；profile 数量 8 个时第 9 个返回冲突；同一时刻 active 只能为空或现有 ID；删除 active profile 后 active 被清空且不会自动切换。

- [ ] **Step 2: 实现规范化与 profile CRUD**

  profile DTO 使用 `{ id, name, protocol, baseUrl, model, keyConfigured, keyMask, createdAt, updatedAt }`；写入时通过 Task 1 的加密函数生成 envelope，读取时永远丢弃 envelope。`saveProfile`、`setActiveProfile`、`deleteProfile` 均通过同一 Promise 串行锁读写 `db.js` 设置；删除 active 只清空 active，不自动选择其他 profile。

- [ ] **Step 3: 接入路由和统一错误**

  在已有 `/api/admin` 同源/JSON/limiter 之后加入：`GET /ai/status`、`POST /ai/profiles`、`POST /ai/profiles/active`、`POST /ai/profiles/delete`。路由只调用 validator 和 `ai-profiles.js`，使用 `{ok:true,data}` 或 `sendError`；密钥不可出现在响应、日志和异常文本。

- [ ] **Step 4: 运行 profile API 测试**

  运行 `node --test tests/ai-profile-api.test.js tests/config.test.js tests/security.test.js`；预期未登录 401、跨源写入 403、错误 JSON 415、成功响应只含掩码 profile，active 切换立即影响后续读取。

## Task 4: Provider 协议适配器与输出校验

**Files:**

- Create: `server/ai-provider.js`，实现 `openai-chat`、`openai-responses`、`anthropic-messages`。
- Create: `tests/ai-provider.test.js`，使用本地 `http.createServer` 或注入 `fetch`，不连接真实 Provider。
- Modify: `server/ai-profiles.js` 或 `server/ai-provider.js` 中的 URL 规范化辅助函数，确保根地址/已含协议路径都可用。

- [ ] **Step 1: 写失败适配器测试**

  为三种协议分别断言请求路径、认证头、固定 Anthropic 版本头、请求 JSON 中包含 model/最小消息；响应分别从 Chat `choices[0].message.content`、Responses `output_text`、Anthropic `content[].text` 提取。增加超大响应、非 2xx、AbortSignal 超时、Markdown code fence JSON、未知字段和无效枚举测试。

- [ ] **Step 2: 实现统一内部接口**

  实现：

  ```js
  requestProviderSuggestion({ profile, prompt, requestId, signal, fetchImpl = fetch })
    -> Promise<{ text, usage, providerRequestId }>
  ```

  适配器只发送 `Content-Type`、协议认证头和固定版本头；不接受 profile 的任意 headers。响应先检查 `Content-Length`，再以字节计数读取，超过 32 KiB 立即中止。所有上游错误转换为 `AI_TIMEOUT`、`AI_PROVIDER_FAILED` 或 `AI_INVALID_RESPONSE`，不返回原始响应正文。

- [ ] **Step 3: 实现 JSON 输出 schema**

  `parseSuggestionText(text)` 去掉可选 code fence，解析并返回固定结构：`summary` ≤600、`category` 为四个业务类型之一、`priority` 为四个等级或 null、`tags` 最多 8 个且每项 ≤32、`replyDraft` ≤1000、`rationale` ≤600、`missingInfo` 最多 6 项且每项 ≤120。未知字段丢弃，类型/大小错误抛 `AI_INVALID_RESPONSE`。

- [ ] **Step 4: 运行适配器测试**

  运行 `node --test tests/ai-provider.test.js`；预期三种协议、超时、超限、非 2xx 和 JSON 校验全部通过，测试日志不含 API Key 或完整响应。

## Task 5: Copilot 编排、脱敏投影、相似项与资源边界

**Files:**

- Create: `server/ai-copilot.js`，实现 `getAiStatus`、`generateSuggestion`、`listSuggestions`、`recordSuggestionDecision`、本地相似度和请求闸门。
- Modify: `server/db.js`，增加只返回 Copilot 内部最小字段的近期候选查询。
- Create: `tests/ai-copilot.test.js`，覆盖脱敏、prompt 注入文本、相似项、并发和失败降级。

- [ ] **Step 1: 写失败编排测试**

  使用伪造 Provider 和含 `contact/adminNote/accountEmailSnapshot` 的 feedback/WorkTask，断言发送给 Provider 的 prompt 只含 allow-list 字段；包含“忽略系统提示”的正文被当作数据；无 active/关闭/密钥失败不调用 Provider；两个并发请求可运行，第三个立即得到 `AI_BUSY`；Provider 超时/无效 JSON 不创建 suggestion 行。

- [ ] **Step 2: 实现最小输入与相似度**

  `buildCopilotInput(entityType, record)` 只保留 PRD 规定字段，使用 Unicode 安全截断并把总 JSON 控制在 12 KiB；`findSimilarItems` 从最近最多 100 条中排除当前记录，以标题/正文 token 与字符 n-gram 的有界 Jaccard 分数排序，返回最多 3 条、分数 ≥0.15 的 ID/标题/状态/优先级，不把候选正文发往 Provider。

- [ ] **Step 3: 实现生成流程**

  `generateSuggestion({ entityType, entityId, requestId, actor })` 按“读取记录 → snapshot active → 解密 Key → 构造 prompt → 调用适配器 → schema 校验 → 写 suggestion → 返回 DTO”执行；profile 在请求开始时复制，切换不会取消已开始请求。调用以 `AbortController` 同时绑定 15 秒超时和客户端断开清理；finally 释放并发计数。

- [ ] **Step 4: 实现短期保留与审计**

  suggestion 创建时写 `expiresAt = now + 7 days`；查询前清理有限量过期行，只返回未过期记录；decision 只更新候选的 `accepted/rejected`、字段数组、管理员和时间，不调用业务写接口。日志只记录 requestId、实体 ID、profileId、protocol、model、duration、结果/错误码。

- [ ] **Step 5: 运行编排测试**

  运行 `node --test tests/ai-copilot.test.js tests/ai-db.test.js`；预期脱敏、热切换快照、相似度、并发/超时、短期保留和决策边界全部通过。

## Task 6: 管理员 Copilot API 与专用限流

**Files:**

- Modify: `server/validation.js`，加入 suggest/query/decision payload 校验。
- Modify: `server/app.js:130-155,430-780`，增加 AI limiter 和七个 API 路由。
- Create: `tests/admin-ai.test.js`，基于现有 `startKwsServer`/`requestJson` 模式验证真实 HTTP envelope。
- Modify: `docs/api/reference.md`，记录新路由和错误码。

- [ ] **Step 1: 写失败 API 测试**

  断言以下路径和行为：未登录返回 401；`POST /api/admin/ai/suggest` 缺少/非法 `entityType/entityId` 返回 400；不存在实体返回 404；关闭 AI 或无 active 返回 503；Provider 超时返回 504；成功返回建议 DTO 且不含 contact/adminNote/key；decision 只接受 allow-list fields，过期/已决策返回 409；连续超过 10 次/5 分钟返回 429。

- [ ] **Step 2: 实现验证与路由**

  添加 `aiLimiter`（`windowMs=5*60*1000`, `max=10`）并放在 `requireAdminSession` 之后；新增 `GET /api/admin/ai/status`、`POST /api/admin/ai/profiles`、`POST /api/admin/ai/profiles/active`、`POST /api/admin/ai/profiles/delete`、`POST /api/admin/ai/suggest`、`GET /api/admin/ai/suggestions`、`POST /api/admin/ai/suggestions/decision`。所有异步处理走 `asyncHandler`，错误通过 `sendError`，普通提交/列表路由不等待 Provider。

- [ ] **Step 3: 运行 HTTP 回归**

  运行 `node --test tests/admin-ai.test.js tests/account-submission.test.js tests/security.test.js`；预期健康、匿名提交、管理员列表在 AI disabled/unavailable 时仍成功。

## Task 7: 管理端设置与收件箱建议交互

**Files:**

- Modify: `public/admin/index.html:75-280`，增加 AI 设置区、状态消息和收件箱 Copilot 控件。
- Modify: `public/admin/admin.js:1-240,279-390,700-850`，加入页面状态、profile 操作、suggestion 渲染/填入/决策。
- Modify: `public/workstation.css`（仅在确有缺失时补方正、亮暗主题和窄屏规则）。
- Create: `public/admin/ai-model.js`，承载与 `inbox-model.js` 同模式的纯 DTO 映射/字段填入规则。
- Create: `tests/admin-ui-model.test.js`，测试 `public/admin/ai-model.js`；不引入浏览器框架。

- [ ] **Step 1: 写失败 UI 模型测试**

  断言 profile DTO 永远不渲染 `keyEnvelope`/明文；建议字段只映射到类型、优先级、标签和回复草稿；“填入”只修改 DOM 表单值，不触发保存；未知/超长字段显示为空或截断；不同主题和缺失字段不抛异常。

- [ ] **Step 2: 实现设置区**

  在现有管理员面板加入状态、profile 列表、协议/Base URL/model/Key 表单和保存/激活/删除按钮，并在 `index.html` 中按 `inbox-model.js` 之后、`admin.js` 之前加载 `ai-model.js`。Key input 初始为空，空值表示保留旧密钥；按钮使用 `withButtonBusy`，成功后重新 GET status；所有动态内容用 `escapeHtml`/`textContent`，不写 localStorage。

- [ ] **Step 3: 实现收件箱建议区**

  为 feedback/worktask 详情增加“生成 AI 建议”按钮、loading/error/expired 状态和 `aria-live`；显示 Provider/model、时间、摘要、分类、优先级、标签、相似条目、回复草稿、依据和缺失信息。生成前明确提示正文将发送至当前 Provider；“接受/拒绝”调用 decision，“填入”只写当前表单。

- [ ] **Step 4: 运行前端检查**

  运行 `node --check public/admin/admin.js`、`node --test tests/admin-ui-model.test.js`、`git diff --check`；手动打开 `/admin/` 验证未登录、登录、AI disabled、profile 掩码、建议成功/失败、键盘焦点、亮暗主题和 620px 窄屏。

## Task 8: 文档、运行手册与缺陷矩阵同步

**Files:**

- Modify: `docs/plans/ai-assistant.md`，同步 P1 已确认协议、profile 加密、人工确认和 P2 边界。
- Modify: `docs/api/reference.md`、`docs/operations/configuration.md`、`docs/operations/security.md`、`docs/architecture/current.md`、`docs/architecture/integration-boundaries.md`、`docs/plans/known-defects.md`、`docs/product/feature-status.md`、`docs/plans/roadmap.md`。
- Create: `docs/operations/ai-copilot.md`，记录启用、profile 配置、主密钥备份/轮换（首版受控脚本）、停用和回滚步骤；不得写入真实 URL、Key 或响应。

- [ ] **Step 1: 更新公开契约**

  在 API/配置文档加入环境变量、固定认证模式、路由 DTO、错误矩阵、数据出站 allow-list 和“AI unavailable 不影响基础业务”的验收说明；明确新 Account 联动仍不在范围内。

- [ ] **Step 2: 更新运维与缺陷记录**

  记录 AI-D001～AI-D004 的实现证据和测试路径；保留 R-002 CSV 导出风险为独立后续任务；运维文档只使用泛化的部署路径示例，不复制 `.env` 内容。

- [ ] **Step 3: 运行文档一致性检查**

  运行 `rg -n "AI_PROFILE_ENCRYPTION_KEY|ai_provider_profiles|ai_copilot_suggestion|/api/admin/ai" docs README.md .env.example`，逐项确认 API、配置、架构和路线图没有互相矛盾；运行 `git diff --check`。

## Task 9: 全范围质量门禁与发布前回滚验证

**Files:**

- Test: `tests/*.test.js` 全套；`package.json` 仅在确有新测试脚本需要时修改。
- Review: `.trellis/spec/backend/*`、`.trellis/spec/frontend/*`、本任务 `prd.md/design.md/implement.md`。
- Operational evidence: 只在本地/受控部署记录，不把真实 Provider URL、Key、prompt、response 提交到 Git。

- [ ] **Step 1: 运行语法与聚焦测试**

  运行 `node --check server/config.js server/ai-profiles.js server/ai-provider.js server/ai-copilot.js server/validation.js server/app.js`；再运行 Task 1–7 列出的所有聚焦测试。

- [ ] **Step 2: 运行完整测试与依赖审计**

  运行 `npm test`、`npm audit --omit=dev --registry=https://registry.npmjs.org`、`git diff --check`；若 `better-sqlite3` ABI 与当前 Node 24 不匹配，先按现有 P0 运行时规范重建并记录，不得把失败标成通过。

- [ ] **Step 3: 做安全/跨层复核**

  检查所有 AI 路由均经过管理员会话、同源和 JSON middleware；检查 provider 请求没有任意 Header、没有完整 prompt/response 日志、没有 API Key DTO；检查三数据库 schema、过期索引和旧数据启动兼容。

- [ ] **Step 4: 做可逆发布冒烟**

  在隔离数据库使用本地 stub Provider 验证 profile 保存 → active 切换 → suggest → decision → 过期过滤；将 `AI_COPILOT_ENABLED=false` 重启后确认健康、匿名提交、通知 outbox 和管理员列表仍通过；只在用户明确授权且使用真实 `.env` 时做真实 Provider smoke，证据脱敏后保存到被忽略的内部记录。

- [ ] **Step 5: 进入 Trellis 检查与提交前评审**

  运行 `python ./.trellis/scripts/task.py validate .trellis/tasks/08-28-p1-admin-ai-copilot`，确认 PRD 无未解决问题、设计/实施文档存在、上下文清单有效；随后加载 `trellis-check` 做全范围检查。未通过前不得运行 `task.py start` 或提交产品实现。

## 回滚点

- 配置回滚：将 `AI_COPILOT_ENABLED=false` 并重启 PM2，保留数据库和主密钥。
- 代码回滚：回到加入 AI 表之前的提交；旧版本忽略 `ai_copilot_suggestion` 和 `ai_provider_profiles`，不执行删除迁移。
- 密钥异常：停止 AI 请求，恢复独立保存的旧 `AI_PROFILE_ENCRYPTION_KEY`；不得从日志、数据库明文或浏览器缓存寻找密钥。
- Provider 异常：停用 active profile 或全局开关，普通反馈/WorkTask/通知路径继续服务。

## 实际执行记录（2026-08-28）

- [x] 配置、AES-256-GCM profile、三数据库建议表、管理员 API、Provider 适配器、Copilot
      编排和管理员页面已实现，并保留现有 Node.js + Express + 原生前端边界。
- [x] 已覆盖 API Key 掩码/加密、Base URL query 拒绝、出站字段 allow-list、提示注入边界、
      15 秒超时、32 KiB 响应上限、2 并发、10 次/5 分钟限流、建议过期和人工决策审计。
- [x] 已同步公开 API/配置/架构/安全/路线图/缺陷文档及 AI Copilot 运维手册；AI 默认关闭，
      KyanetAccount 联动仍保持独立暂缓边界。
- [x] 最终门禁：`npm test` 105/105、相关 JavaScript `node --check`、canonical `npm audit`
      0 vulnerabilities、`git diff --check` 和 Trellis task validate 均通过；补充回归确认
      Provider 显式 `usage: null` 映射为未知用量而不是 0。
- [x] 本地浏览器冒烟：未登录管理页按预期返回 401 并显示登录界面；登录后 AI disabled
      状态、profile 设置区、工作收件箱、亮暗主题切换和 620px 窄屏布局均可用；未连接
      真实 Provider。
- [ ] 真实 Provider、真实多实例 RDBMS 和生产轮换脚本不在本任务中执行；按运维手册在获得
      明确授权后于受控环境单独验证。
