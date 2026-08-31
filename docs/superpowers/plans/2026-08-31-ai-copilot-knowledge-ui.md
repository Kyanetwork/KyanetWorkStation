# AI Copilot 参数、知识助手与方正 UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 Node.js 24 + Express + 静态 HTML/CSS/JavaScript 架构内，为管理员 AI 增加 Responses `reasoning_effort` 与受控工作指令、基于外部 Markdown/TXT 目录的引用式知识助手及历史清理，同时统一所有页面的直角冷色 HUD 控件。

**Architecture:** 保留现有 profile 加密、Provider adapter、统一 API envelope 和设置 JSON 存储。新增独立 `knowledge-base`（扫描/缓存/检索）与 `ai-knowledge`（问答/解析/历史编排）模块；知识库路径只来自进程环境，索引缓存版本化并原子替换，问答历史使用新增跨数据库表。管理员界面继续使用现有静态 HTML 和事件委托，视觉规则集中到 `workstation.css`。

**Tech Stack:** Node.js 24、Express 4、原生 `fetch`、SQLite/MySQL/PostgreSQL 兼容 SQL、Node `fs/path/crypto`、现有 `node:test`、原生 CSS/JavaScript；不新增运行时依赖、向量数据库或前端框架。

---

## 文件与责任地图

| 文件 | 责任 |
|---|---|
| `server/config.js`、`.env.example` | 解析知识库根目录、历史保留期和运行时边界 |
| `server/ai-profiles.js`、`server/validation.js` | profile 新字段归一化、DTO、输入校验 |
| `server/ai-provider.js`、`server/ai-copilot.js` | Responses 参数映射、受控 prompt 附加段与版本标识 |
| `server/knowledge-base.js` | 根目录安全校验、扫描、分块、缓存、确定性检索 |
| `server/ai-knowledge.js` | 知识问答 prompt、答案解析、引用映射、历史编排 |
| `server/db.js` | 知识设置、`ai_knowledge_answer` schema 与跨驱动 CRUD |
| `server/app.js` | 管理 API、限流、启动/每小时清理 worker、审计接入 |
| `scripts/reindex-knowledge.js` | 显式重建索引 CLI |
| `public/admin/index.html`、`admin.js`、`ai-model.js` | profile 字段、知识助手标签与历史交互 |
| `public/workstation.css` | 所有页面按钮/状态/布局的共享直角视觉契约 |
| `tests/*.test.js` | 单元、跨层 API、隐私和回归测试 |
| `docs/api/reference.md`、`docs/operations/*.md`、`docs/plans/*.md` | API、部署、知识库运维和路线图说明 |

## Task 1: Profile 参数与 Provider 映射（TDD）

**Files:**

- Modify: `tests/ai-provider.test.js`
- Modify: `tests/ai-profile-api.test.js`
- Modify: `tests/admin-ai-model.test.js`
- Modify: `server/validation.js`
- Modify: `server/ai-profiles.js`
- Modify: `server/ai-provider.js`
- Modify: `public/admin/ai-model.js`

- [ ] **Step 1: 写失败测试，锁定 profile 新字段和请求体契约**

  在 `tests/ai-provider.test.js` 增加以下断言：Responses profile 设置
  `reasoningEffort: "xhigh"` 时请求体包含 `reasoning: { effort: "xhigh" }`；空值时
  不包含 `reasoning`；Chat 和 Anthropic 即使设置该字段也不包含它。API 测试增加保存、
  更新、清空 `reasoningEffort` 与 `promptInstruction` 的请求，并断言响应不含
  `keyEnvelope`/API Key。模型测试断言 `normalizeProfile` 返回两个新字段且长度被限制。

  ```js
  const body = JSON.parse(request.options.body);
  assert.deepEqual(body.reasoning, { effort: "xhigh" });
  assert.equal(Object.hasOwn(body, "reasoning"), false);
  ```

- [ ] **Step 2: 运行聚焦测试，确认它们因字段尚未实现而失败**

  Run: `node --test tests/ai-provider.test.js tests/ai-profile-api.test.js tests/admin-ai-model.test.js`

  Expected: 新增断言失败，现有测试保持可定位的失败输出，不修改既有测试预期。

- [ ] **Step 3: 实现白名单归一化和向后兼容 DTO**

  在 `server/validation.js` 增加常量和 profile 校验：`reasoningEffort`（同时接受
  `reasoning_effort` 作为输入别名）只能是 `"" | "low" | "medium" | "high" | "xhigh" | "max"`，
  `promptInstruction` 必须是字符串且最多 2000 个 Unicode 字符；输出统一为
  `reasoningEffort`/`promptInstruction`。在 `server/ai-profiles.js` 的存储归一化、写入、
  DTO 和 clone 路径保留旧 profile 缺字段时的空值默认。

  ```js
  const ALLOWED_REASONING_EFFORTS = new Set(["", "low", "medium", "high", "xhigh", "max"]);
  const reasoningEffort = normalizeString(body.reasoningEffort ?? body.reasoning_effort);
  const promptInstruction = normalizeString(body.promptInstruction).slice(0, 2000);
  if (!ALLOWED_REASONING_EFFORTS.has(reasoningEffort)) {
    return { valid: false, message: "reasoningEffort 不合法" };
  }
  ```

- [ ] **Step 4: 实现 Provider 的协议映射**

  在 `requestDefinition(profile, prompt)` 中保留现有基础 body，新增一个只针对
  `openai-responses` 的分支合并：当 `profile.reasoningEffort` 非空时加入
  `body.reasoning = { effort: profile.reasoningEffort }`；Chat/Anthropic 永远省略。
  不改变 headers、超时、响应大小限制和错误码。

  ```js
  const body = { model, input: prompt };
  if (profile.reasoningEffort) body.reasoning = { effort: profile.reasoningEffort };
  return { url, headers, body, extract: extractResponsesText };
  ```

- [ ] **Step 5: 让管理员 profile 表单读写新字段**

  在 `public/admin/index.html` 增加 `select#aiProfileReasoningEffort`（空值、low、
  medium、high、xhigh、max）和 `textarea#aiProfilePromptInstruction`。在
  `ai-model.js` 的 `normalizeProfile` 返回新字段；在 `admin.js` 的 reset/edit/save
  读取、回填、提交这两个字段，并在 profile 列表显示 effort 是否应用：Responses 显示
  当前值，其他协议显示“本协议不应用”。

- [ ] **Step 6: 运行聚焦测试并提交**

  Run: `node --test tests/ai-provider.test.js tests/ai-profile-api.test.js tests/admin-ai-model.test.js`

  Expected: 全部通过，且 `JSON.stringify` 结果不出现 API Key 或密文。

  Commit: `feat: add bounded AI reasoning and profile instructions`

## Task 2: 固定/受控 Prompt 与 Copilot 版本标识

**Files:**

- Modify: `tests/ai-copilot.test.js`
- Modify: `server/ai-copilot.js`
- Modify: `server/admin-audit.js`（仅在现有 metadata 白名单需要新字段时）
- Modify: `docs/operations/ai-copilot.md`

- [ ] **Step 1: 写失败测试，验证附加指令边界和版本**

  增加测试调用 `buildCopilotPrompt(input, [], instruction)`：结果包含
  `<admin-instruction>` 和指令文本，但系统安全句、`<user-data>`、`<similar-items>`
  和 JSON 字段约束仍存在；超过 2000 字符的指令被截断。`generateSuggestion` 的存储
  result 和返回 DTO 增加 `promptVersion`，且审计 metadata 只包含 instruction 是否配置、
  长度或哈希，不包含原文。

  ```js
  assert.match(prompt, /<admin-instruction>/u);
  assert.match(prompt, /只返回符合要求的 JSON/u);
  assert.doesNotMatch(JSON.stringify(auditMetadata), /内部指令全文/u);
  ```

- [ ] **Step 2: 实现受控附加段**

  在 `server/ai-copilot.js` 定义 `COPILOT_PROMPT_VERSION = "copilot-v2"`，扩展
  `buildCopilotPrompt(input, similarItems, promptInstruction = "")`：先输出固定系统
  指令，再输出经过 Unicode 截断的 `<admin-instruction>`，最后输出不可信数据块；不允许
  instruction 改写固定内容。`generateSuggestion` 从 active profile 传入 instruction，
  将版本写入 `result` 和 DTO，不记录完整 prompt。

- [ ] **Step 3: 更新审计 metadata 与运维说明**

  profile 保存审计只增加 `reasoningEffort`、`promptInstructionConfigured`、
  `promptInstructionLength`；在运维文档明确系统 prompt 不可编辑、Responses 才应用
  effort、Chat/Anthropic 会显示未应用，并说明清空 instruction 的行为。

- [ ] **Step 4: 运行 Copilot 回归并提交**

  Run: `node --test tests/ai-copilot.test.js tests/admin-ai.test.js tests/ai-profile-api.test.js`

  Expected: 全部通过，私有字段和指令全文不出现在 provider 请求之外的日志/审计响应。

  Commit: `feat: keep copilot prompt bounded and versioned`

## Task 3: 知识库配置、扫描、缓存与检索（TDD）

**Files:**

- Create: `server/knowledge-base.js`
- Create: `tests/knowledge-base.test.js`
- Create: `scripts/reindex-knowledge.js`
- Modify: `server/config.js`
- Modify: `.env.example`
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: 写失败测试，覆盖配置、路径和检索契约**

  在 `tests/knowledge-base.test.js` 使用 `fs.mkdtempSync` 创建两个根目录，写入 `.md`、
  `.txt` 和不支持扩展名文件，断言只收录白名单文件；写入隐藏目录和 `logs`/`data` 子目录，
  断言跳过。用 `path.relative` 对根目录外文件和越界软链接做失败断言；若当前 Windows
  权限不允许创建 symlink，测试只跳过 symlink 分支并仍验证越界路径。断言大文件/过多文件
  被报告而不是让扫描失控，分块和搜索排序可重复，结果只包含 root ID、相对路径、标题、
  chunk 文本和内部 source ID，不含绝对路径。

  ```js
  const result = await reindex({ roots: [{ id: "a", name: "A", path: rootA }] });
  assert.equal(result.summary.indexedFiles, 2);
  assert.equal(result.chunks.every((item) => !path.isAbsolute(item.relativePath)), true);
  assert.deepEqual(searchIndex(result, "登录按钮"), searchIndex(result, "登录按钮"));
  ```

- [ ] **Step 2: 运行测试确认新模块尚未实现**

  Run: `node --test tests/knowledge-base.test.js`

  Expected: 因模块/导出不存在而失败。

- [ ] **Step 3: 实现受限根目录解析和扫描**

  在 `server/config.js` 解析 `AI_KNOWLEDGE_BASE_DIRS` JSON 数组，保留安全的
  `{ id, name, path }` 配置和解析错误状态；使用正斜杠示例避免 `.env` 反斜杠转义。
  在 `server/knowledge-base.js` 实现 `parseRoots`、`scanRoot`、`reindex`：仅接受
  `.md/.txt`，限制根目录数、文件数、单文件/总字节数，跳过隐藏/运行目录；每个文件先
  `realpath`，再用 `path.relative(realRoot, realFile)` 拒绝空相对路径、`..` 和绝对路径。

  ```js
  const relativePath = path.relative(realRoot, realFile);
  if (!relativePath || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    return { skipped: true, reason: "outside-root" };
  }
  ```

- [ ] **Step 4: 实现标题/段落分块和原子缓存**

  按 Markdown heading 与空行分段，纯文本按空行分段；超过单 chunk 上限时按 Unicode
  字符切分。为每个 chunk 保存 `rootId`、POSIX `relativePath`、`title`、`text`、
  `contentHash`、`mtimeMs` 和稳定内部 ID。将 `{version, builtAt, roots, chunks, warnings}`
  写到 `data/ai-knowledge-index.json.tmp-<pid>`，`fs.renameSync` 原子替换；失败不覆盖
  旧缓存。实现 `loadIndex` 对版本不匹配返回空/不可用状态，不扫描目录。

- [ ] **Step 5: 实现确定性关键词检索和 CLI**

  复用 Copilot 的 Unicode token/中文双字思想，导出 `searchIndex(index, query, options)`；
  支持 `rootId` 为空表示跨库，最多返回 6 个 chunk 和总上下文字节上限，按 score、rootId、
  relativePath、chunkIndex 稳定排序。新增 CLI：读取当前 config，调用 `reindex`，成功输出
  扫描统计，失败返回非零码且不打印文档正文/绝对路径；在 `package.json` 增加
  `"reindex-knowledge": "node scripts/reindex-knowledge.js"`，并确认 `.gitignore` 忽略
  `data/ai-knowledge-index.json*`。

  ```js
  if (require.main === module) {
    reindexFromConfig().then((summary) => process.stdout.write(`${JSON.stringify(summary)}\n`))
      .catch(() => process.exitCode = 1);
  }
  ```

- [ ] **Step 6: 运行知识库单测并提交**

  Run: `node --test tests/knowledge-base.test.js tests/config.test.js`

  Expected: 全部通过；临时目录清理完成，仓库不出现索引缓存。

  Commit: `feat: add bounded local knowledge indexing`

## Task 4: 知识历史数据库与设置（TDD）

**Files:**

- Modify: `tests/ai-db.test.js`
- Modify: `server/db.js`
- Modify: `server/config.js`
- Modify: `tests/config.test.js`

- [ ] **Step 1: 写失败测试，锁定三数据库兼容函数**

  为 SQLite 测试增加 `ai_knowledge_settings` 默认值 `autoCleanup: true`、问答创建、分页
  查询、关键词/root 筛选、单条删除和按 `expires_at` 清理。断言保存的引用 JSON、usage、
  `prompt_version` 和过期时间能完整取回。对 MySQL/PostgreSQL schema 生成函数断言包含
  相同列和 expiry/created 索引。

  ```js
  const id = await db.createAiKnowledgeAnswer({ question: "问题", answer: "回答", basis: "document", sources: [{ sourceId: "s1" }] });
  const rows = await db.listAiKnowledgeAnswers({ page: 1, pageSize: 20 });
  assert.deepEqual(rows[0].sources, [{ sourceId: "s1" }]);
  ```

- [ ] **Step 2: 运行数据库聚焦测试确认失败**

  Run: `node --test tests/ai-db.test.js tests/config.test.js`

  Expected: 新函数/schema 断言失败，既有设置和 AI suggestion 测试不受影响。

- [ ] **Step 3: 增加跨驱动 schema 与 JSON 设置**

  在 SQLite/MySQL/PostgreSQL schema statements 增加 `ai_knowledge_answer`：`id`、有界问题/答案/
  caveats、`basis`、`sources_json`、`root_id`、profile/protocol/model、`usage_json`、
  `prompt_version`、`created_at`、`expires_at` 和创建/过期索引。增加
  `AI_KNOWLEDGE_SETTINGS_KEY`、默认 `autoCleanup: true`，实现归一化读写并保持未知字段丢弃。

- [ ] **Step 4: 实现历史 CRUD 与有界序列化**

  实现 `createAiKnowledgeAnswer`、`getAiKnowledgeAnswerById`、
  `listAiKnowledgeAnswers`、`deleteAiKnowledgeAnswer`、`deleteExpiredAiKnowledgeAnswers`。
  所有文本、JSON 和分页参数在 DB 边界再次截断/校验；SQL 使用现有 `placeholder`/`execute`/
  `queryAll`，不得拼接用户关键词到 SQL。列表返回 `expired` 标记所需时间，不返回机器路径。

- [ ] **Step 5: 增加 retention 环境配置并验证**

  在 `config.rawInput`/`config.knowledge` 增加 `AI_KNOWLEDGE_HISTORY_RETENTION_DAYS`，
  默认 30、运行时校验范围 1–3650；新增 config 测试覆盖边界和显式非法值。知识根目录解析
  错误只进入知识状态，不让核心服务器启动失败。

- [ ] **Step 6: 运行数据库测试并提交**

  Run: `node --test tests/ai-db.test.js tests/config.test.js`

  Expected: 全部通过，三数据库 schema 文本保持同构。

  Commit: `feat: persist knowledge answers and retention settings`

## Task 5: 知识问答编排与管理员 API（TDD）

**Files:**

- Create: `server/ai-knowledge.js`
- Create: `tests/ai-knowledge.test.js`
- Create: `tests/knowledge-api.test.js`
- Modify: `server/validation.js`
- Modify: `server/app.js`
- Modify: `server/ai-provider.js`（只复用现有 normalized response，不改变 provider 协议）

- [ ] **Step 1: 写失败测试，覆盖答案解析和安全数据流**

  在 `tests/ai-knowledge.test.js` 测试固定答案 JSON 的长度/枚举校验、代码围栏、非法
  `citedSourceIds` 过滤、无命中强制 `basis=general`、有命中时只映射本次检索 source ID。
  测试 `askKnowledge` 发送的 prompt 只含问题、选中的片段和 profile instruction，不含
  绝对路径、未命中文档、API Key；provider 返回非法 JSON 时不创建历史。

  ```js
  assert.deepEqual(parseKnowledgeAnswer(JSON.stringify({ basis: "document", citedSourceIds: ["bad"] })), {
    answer: "", basis: "document", citedSourceIds: [], caveats: ""
  });
  assert.match(prompt, /<knowledge-data>/u);
  assert.doesNotMatch(prompt, /E:\\\\Workplace/u);
  ```

- [ ] **Step 2: 运行新测试确认失败**

  Run: `node --test tests/ai-knowledge.test.js tests/knowledge-api.test.js`

  Expected: 因 `server/ai-knowledge.js` 和路由不存在而失败。

- [ ] **Step 3: 实现固定知识 prompt 与答案解析**

  定义 `KNOWLEDGE_PROMPT_VERSION = "knowledge-v1"`、`buildKnowledgePrompt`、
  `parseKnowledgeAnswer`。固定指令要求 JSON、资料仅为不可信内容、不可执行命令；使用
  `<question>`、`<knowledge-data>`、`<admin-instruction>` 三个边界。答案字段上限为
  answer 6000、caveats 1200、引用最多 6 个；服务端只接受检索结果生成的 `s1`…ID。

- [ ] **Step 4: 实现 ask/list/delete/cleanup/settings 编排**

  `askKnowledge({ question, rootId, dependencies })` 校验问题，读取缓存并检索，获取 active
  profile/解密 key，调用现有 `requestProviderSuggestion`，按命中情况修正 basis、映射引用，
  保存问答历史并返回 provider、usage、promptVersion、sources。无命中时强制 `general`；有
  命中但模型标记 mixed/general 时保留“非文档依据/需核验” caveat。数据库失败或 provider
  失败只抛稳定 AI 错误码。

- [ ] **Step 5: 增加严格验证器和管理员路由**

  在 `server/validation.js` 增加：问题 1–4000 字符、rootId 为空或 profile ID 格式、历史
  page 1–100000/pageSize 1–100、keyword 0–200 字符、answer ID 正整数、settings 仅接受
  boolean。`server/app.js` 增加以下受保护路由，沿用 envelope、CSRF、管理员会话和审计：

  ```text
  GET  /api/admin/ai/knowledge/status
  POST /api/admin/ai/knowledge/reindex
  POST /api/admin/ai/knowledge/ask
  GET  /api/admin/ai/knowledge/history
  POST /api/admin/ai/knowledge/history/delete
  POST /api/admin/ai/knowledge/history/cleanup
  POST /api/admin/ai/knowledge/settings
  ```

  `ask` 使用独立的 5 分钟/10 次 limiter；reindex 使用单进程锁。状态只返回库名、相对路径、
  chunk/file 统计、builtAt、warnings、retention 和 autoCleanup，不返回索引正文或绝对路径。
  写操作审计只记录 rootId、answerId、计数、开关值和安全错误码。

- [ ] **Step 6: 实现启动/每小时自动清理**

  在 `server/app.js` 的 `initializeDatabase()` 后调用 `cleanupKnowledgeHistoryIfEnabled()`；
  同函数以 60 分钟 `setInterval(...).unref()` 注册。函数读取设置，只有 `autoCleanup === true`
  才调用 DB 删除，失败记录脱敏日志而不退出进程。手动 cleanup 路由无论开关状态都执行。

  ```js
  async function cleanupKnowledgeHistoryIfEnabled() {
    const settings = await getAiKnowledgeSettings();
    if (settings.autoCleanup) await deleteExpiredAiKnowledgeAnswers(new Date().toISOString());
  }
  ```

- [ ] **Step 7: 运行 API/编排测试并提交**

  Run: `node --test tests/ai-knowledge.test.js tests/knowledge-api.test.js tests/admin-ai.test.js tests/security.test.js`

  Expected: 新 API 的匿名访问为 401，跨源写入为 403，成功问答能查询/删除/清理历史，普通
  反馈、WorkTask 和通知测试继续通过。

  Commit: `feat: add citation-based admin knowledge assistant`

## Task 6: 管理员知识助手 UI 与共享直角样式（TDD + smoke）

**Files:**

- Modify: `public/admin/index.html`
- Modify: `public/admin/admin.js`
- Modify: `public/admin/ai-model.js`
- Modify: `public/workstation.css`
- Modify: `tests/admin-ai-model.test.js`
- Modify: `tests/admin-ui-model.test.js`

- [ ] **Step 1: 写失败的静态 UI 契约测试**

  断言管理员 HTML 存在 `tabKnowledge`、`moduleKnowledge`、索引状态/重建按钮、问题输入、
  库筛选、回答/引用、历史筛选/删除/清理和自动清理开关；断言动态 AI 按钮都带
  `type="button"` 与共享 `btn`/层级类；断言 `.pagebar button`、`.ai-suggestion-actions button`
  和管理员登录/分页按钮命中共享 CSS 选择器且没有 `border-radius` 非零规则。

  ```js
  assert.match(html, /id="tabKnowledge"/u);
  assert.match(html, /id="knowledgeReindexBtn"/u);
  assert.match(css, /\.pagebar button/u);
  assert.doesNotMatch(css, /\.pagebar button[^}]*border-radius:\s*(?!0)/u);
  ```

- [ ] **Step 2: 运行 UI 测试确认失败**

  Run: `node --test tests/admin-ai-model.test.js tests/admin-ui-model.test.js`

  Expected: 新 ID/selector 断言失败。

- [ ] **Step 3: 重构管理员设置布局为清晰网格**

  给 `<body>` 加 `class="admin-page"`，把 profile 表单、知识状态、提问、回答/引用和历史
  分成语义 section；移除重复的 inline button/input CSS，保留页面特有网格规则。新增明确
  控件 ID：`knowledgeRootFilter`、`knowledgeQuestion`、`knowledgeAskBtn`、
  `knowledgeAnswer`、`knowledgeSources`、`knowledgeHistoryList`、`knowledgeCleanupBtn`、
  `knowledgeAutoCleanup`、`knowledgeSettingsSaveBtn`。

- [ ] **Step 4: 实现知识助手状态与交互**

  在 `admin.js` 增加 `state.knowledge`，实现 `loadKnowledgeStatus`、`reindexKnowledge`、
  `askKnowledge`、`loadKnowledgeHistory`、`deleteKnowledgeAnswer`、`cleanupKnowledge`、
  `saveKnowledgeSettings`。所有请求使用现有 `api`/`withButtonBusy`；渲染时对问题、回答、
  来源和历史内容统一 `escapeHtml`，来源只显示库名、POSIX 相对路径、标题和段落信息。
  `basis=general` 显示“非文档依据/未验证”，`mixed` 分开展示文档引用和模型推断。
  未登录时不读取任何知识状态。

  ```js
  const data = await api("/api/admin/ai/knowledge/ask", { question, rootId });
  knowledgeAnswer.textContent = data.answer || "暂无回答";
  knowledgeBasis.textContent = data.basis === "general" ? "非文档依据/未验证" : data.basis;
  ```

- [ ] **Step 5: 接入 profile 字段和 effort 提示**

  在 profile 编辑/保存流程中回填 `reasoningEffort`、`promptInstruction`；当 protocol 不是
  `openai-responses` 时在 effort 控件旁显示“不发送到当前协议”，但仍允许保存值以便日后
  切换协议。知识问答复用 active profile，不增加第二套 API Key 配置。

- [ ] **Step 6: 完成共享按钮样式和 B 风格层次**

  在 `public/workstation.css` 增加统一规则：`appearance:none`、直角边框、冷蓝主按钮、
  次按钮、危险按钮、`.is-busy` spinner、disabled 对比度、`focus-visible` 和 dark theme。
  明确覆盖 `.pagebar button`、`.ai-suggestion-actions button`、`.ai-profile-actions button`、
  `#loginBtn`、`.theme-btn`、`.tab`、`.toolbar button`、`.ops button`；所有状态保持
  `border-radius: 0 !important`。通过 `.admin-page` 作用域收敛页面布局，避免再次出现
  原生默认 button。

- [ ] **Step 7: 运行静态检查并做浏览器 smoke**

  Run: `node --check public/admin/admin.js; node --check public/admin/ai-model.js; node --check public/theme.js; node --test tests/admin-ai-model.test.js tests/admin-ui-model.test.js`

  Expected: 语法与静态契约通过。手动浏览器 smoke 依次验证登录、profile effort/instruction、
  知识状态/重建/提问/引用/历史/删除/清理开关、收件箱 AI 动作、上一页/下一页、亮暗主题、
  720px 窄屏和 Tab/Enter/Space 键盘操作；截图中不得出现圆角控件或原生 button 外观。

  Commit: `feat: add admin knowledge workspace and sharp controls`

## Task 7: 文档、运维配置与后续路线图

**Files:**

- Modify: `.env.example`
- Modify: `docs/api/reference.md`
- Modify: `docs/operations/configuration.md`
- Modify: `docs/operations/ai-copilot.md`
- Modify: `docs/plans/ai-assistant.md`
- Modify: `docs/product/feature-status.md`
- Modify: `docs/plans/roadmap.md`
- Modify: `README.md`

- [ ] **Step 1: 更新部署环境示例和路径说明**

  在 `.env.example` 增加注释和安全示例：

  ```dotenv
  # JSON array; use a corresponding Linux absolute path in production.
  AI_KNOWLEDGE_BASE_DIRS=[]
  AI_KNOWLEDGE_HISTORY_RETENTION_DAYS=30
  ```

  说明目录必须由部署流程同步/挂载、应用只读、不要提交仓库、Windows 路径需合法 JSON 转义。

- [ ] **Step 2: 更新 API/运维契约**

  在 API reference 记录七个知识路由、请求/响应字段、`basis` 语义、来源 ID 映射、限流和
  稳定错误码；在配置/AI 运维文档记录 reindex CLI、缓存路径、`.md/.txt` 白名单、软链接
  边界、Responses effort 映射、instruction 限制、保留期和 autoCleanup 启动/每小时行为，
  并给出生产发布顺序：同步目录 → `npm run reindex-knowledge` → 管理员问答验证。

- [ ] **Step 3: 更新产品状态和路线图**

  将管理员 AI Copilot 标为“已实现/P1 增强”，知识助手标为本任务新增已实现；将 Provider
  诊断、指标、prompt 对比、建议对比/批量摘要保留为 P1-B 后续；明确 Account 联动和自动
  执行仍暂缓。

- [ ] **Step 4: 运行文档链接/差异检查并提交**

  Run: `rg -n "AI_KNOWLEDGE|reasoning_effort|knowledge" README.md docs .env.example; git diff --check`

  Expected: 路由、变量、CLI 和回滚边界在文档中可找到，Markdown 无空白错误。

  Commit: `docs: document knowledge assistant operations`

## Task 8: 全量质量门禁与交付

**Files:**

- Modify: `.trellis/spec/backend/external-boundaries.md`（仅在确认产生新通用边界时）
- Modify: `.trellis/spec/backend/quality-guidelines.md`（仅在确认产生新测试约定时）
- Modify: `.trellis/spec/frontend/component-guidelines.md`（仅在确认产生新控件约定时）
- Modify: `.trellis/tasks/08-31-p1-ai-enhancement-ui/`（进度和完成记录）

- [ ] **Step 1: 运行逐层质量检查**

  Run: `node --check server/config.js; node --check server/ai-profiles.js; node --check server/ai-provider.js; node --check server/ai-copilot.js; node --check server/knowledge-base.js; node --check server/ai-knowledge.js; node --check server/db.js; node --check server/validation.js; node --check server/app.js; node --check scripts/reindex-knowledge.js`

  Expected: 所有命令退出码为 0。

- [ ] **Step 2: 运行全部测试与依赖审计**

  Run: `npm test; npm audit --omit=dev`

  Expected: 全部 node:test 通过，审计无新增漏洞；若测试环境有 native SQLite ABI 问题，
  按既有 Node 24 基线重建 `better-sqlite3` 后重新运行并记录证据。

- [ ] **Step 3: 做跨层隐私/契约检查**

  Run: `git diff --check; rg -n "apiKey|keyEnvelope|absolutePath|process\.env|adminNote|accountEmailSnapshot" server/ai-knowledge.js server/knowledge-base.js public/admin/ai-model.js public/admin/admin.js tests`

  Expected: API/页面 DTO 不出现密钥或绝对路径；知识 prompt 不包含未命中文档/管理员私密字段；
  新路由均经过 `requireAdminSession` 和 CSRF/限流路径。

- [ ] **Step 4: 根据质量检查决定是否更新 Trellis spec**

  若实现确认了“外部只读根目录必须 realpath 校验”“索引缓存必须原子替换”“动态按钮必须
  统一 `type="button"`/共享类”等可复用约定，更新对应 `.trellis/spec/` 文件并加入同一
  提交；若没有新通用知识，记录检查结论而不改无关规范。

- [ ] **Step 5: 完成最终交付前检查**

  复核 PRD 每项 acceptance criterion 都有测试或 smoke 证据；确认生产 `.env`、数据库、
  知识库原目录和索引缓存均未加入 Git；确认失败时普通反馈/WorkTask/通知继续可用；生成
  发布说明和回滚步骤，不执行 push。

  Commit: `chore: verify AI knowledge and UI iteration`

## 执行顺序与回滚点

1. Task 1–2 先建立 profile/provider/prompt 契约，失败可单独回滚且不影响知识库。
2. Task 3–4 再建立索引缓存和数据库加法迁移；扫描失败保留旧缓存，旧代码回滚不删除新表。
3. Task 5 接通 API/worker；若 Provider 或数据库失败，只关闭知识路由，不回滚普通业务。
4. Task 6 接入 UI；若样式回归，优先回滚共享 CSS/管理员 HTML，保留已验证后端。
5. Task 7–8 更新文档、规范和证据后再归档 Trellis 任务。
