# P1 AI Copilot 参数、知识助手及 UI 统一实施计划

完整的人类可读计划位于 `docs/superpowers/plans/2026-08-31-ai-copilot-knowledge-ui.md`。
本文件是 Trellis 执行入口，按以下顺序实施；每一项完成后运行聚焦测试并提交，未通过
不得进入下一项。

## 1. Profile 与 Provider 契约

- 先在 `tests/ai-provider.test.js`、`tests/ai-profile-api.test.js`、
  `tests/admin-ai-model.test.js` 写失败测试。
- 修改 `server/validation.js`、`server/ai-profiles.js`、`server/ai-provider.js` 和
  `public/admin/{index.html,admin.js,ai-model.js}`：增加空值或
  `low/medium/high/xhigh/max` 的 `reasoningEffort`、最多 2000 字的
  `promptInstruction`；只在 Responses body 加 `reasoning.effort`，Chat/Anthropic 省略。
- 验证：
  `node --test tests/ai-provider.test.js tests/ai-profile-api.test.js tests/admin-ai-model.test.js`
- 提交：`feat: add bounded AI reasoning and profile instructions`

## 2. Copilot 受控 Prompt

- 在 `tests/ai-copilot.test.js` 先覆盖 `<admin-instruction>`、长度上限、固定安全段和
  `promptVersion`。
- 修改 `server/ai-copilot.js`：定义 `COPILOT_PROMPT_VERSION="copilot-v2"`，把 profile
  指令置于独立边界，保存版本但不记录指令全文；扩展 `docs/operations/ai-copilot.md`。
- 验证：
  `node --test tests/ai-copilot.test.js tests/admin-ai.test.js tests/ai-profile-api.test.js`
- 提交：`feat: keep copilot prompt bounded and versioned`

## 3. 外部 Markdown/TXT 知识库

- 在 `tests/knowledge-base.test.js` 先覆盖多根目录、扩展名、隐藏/运行目录、越界路径/软
  链接、大小上限、稳定分块和检索排序。
- 新建 `server/knowledge-base.js`、`scripts/reindex-knowledge.js`；修改 `server/config.js`、
  `.env.example`、`package.json`、`.gitignore`。使用 `AI_KNOWLEDGE_BASE_DIRS` JSON 数组，
  只读、realpath 校验、版本化 JSON 缓存和原子 rename；增加
  `npm run reindex-knowledge`。
- 验证：`node --test tests/knowledge-base.test.js tests/config.test.js`
- 提交：`feat: add bounded local knowledge indexing`

## 4. 历史表与自动清理设置

- 在 `tests/ai-db.test.js`、`tests/config.test.js` 先覆盖 SQLite CRUD、分页/root/关键词筛选、
  过期清理、默认 `autoCleanup=true` 和三数据库 schema 同构。
- 修改 `server/db.js`、`server/config.js`：增加跨 SQLite/MySQL/PostgreSQL 的
  `ai_knowledge_answer`、`ai_knowledge_settings`，问题/回答/引用/usage/版本均有界；
  `AI_KNOWLEDGE_HISTORY_RETENTION_DAYS` 默认 30、范围 1–3650。
- 验证：`node --test tests/ai-db.test.js tests/config.test.js`
- 提交：`feat: persist knowledge answers and retention settings`

## 5. 知识问答服务与 API

- 在 `tests/ai-knowledge.test.js`、`tests/knowledge-api.test.js` 先覆盖答案 JSON、来源 ID
  映射、document/mixed/general、无命中强制 general、隐私和错误不落库。
- 新建 `server/ai-knowledge.js`；修改 `server/validation.js`、`server/app.js`。实现固定
  `knowledge-v1` prompt、问答编排、历史/删除/清理/设置 API、独立 5 分钟/10 次限流，
  并在启动及每小时 worker 按 `autoCleanup` 删除过期记录；所有写操作走 CSRF、会话和审计。
- 验证：
  `node --test tests/ai-knowledge.test.js tests/knowledge-api.test.js tests/admin-ai.test.js tests/security.test.js`
- 提交：`feat: add citation-based admin knowledge assistant`

## 6. 管理员 UI 与直角控件

- 先在 `tests/admin-ai-model.test.js`、`tests/admin-ui-model.test.js` 增加知识标签、控件 ID、
  共享 selector 和无圆角契约测试。
- 修改 `public/admin/index.html`、`public/admin/admin.js`、`public/admin/ai-model.js`：加入
  索引状态/重建、问题/知识库筛选、回答/引用、历史/删除/清理和自动清理开关；所有动态
  按钮显式 `type="button"` 并使用 `escapeHtml`。
- 修改 `public/workstation.css`：以 `.admin-page` 作用域整理网格，统一 pagebar、AI 动作、
  profile、登录、工具栏和表单按钮的 primary/secondary/danger/hover/disabled/busy/focus
  状态；所有控件 `border-radius: 0`，亮暗主题和窄屏单列保持可用。
- 验证：
  `node --check public/admin/admin.js; node --check public/admin/ai-model.js; node --test tests/admin-ai-model.test.js tests/admin-ui-model.test.js`
  再完成登录、重建、提问、引用、历史、清理、主题、窄屏和键盘 smoke。
- 提交：`feat: add admin knowledge workspace and sharp controls`

## 7. 文档与运维

- 修改 `.env.example`、`README.md`、`docs/api/reference.md`、`docs/operations/configuration.md`、
  `docs/operations/ai-copilot.md`、`docs/plans/ai-assistant.md`、`docs/product/feature-status.md`、
  `docs/plans/roadmap.md`，记录环境变量、Linux 挂载/同步、CLI、API、引用/依据、保留期、
  自动清理和回滚顺序。
- 验证：`rg -n "AI_KNOWLEDGE|reasoning_effort|knowledge" README.md docs .env.example; git diff --check`
- 提交：`docs: document knowledge assistant operations`

## 8. 全量质量门禁与 Trellis 收尾

- 运行所有变更 JavaScript 的 `node --check`、`npm test`、`npm audit --omit=dev`、
  `git diff --check`；确认原有 123+ 测试与新增测试均通过。
- 按 `.trellis/spec/backend` 与 `.trellis/spec/frontend` 的 quality check 做跨层复核；若
  产生通用 realpath/原子缓存/动态按钮约定，更新对应 spec，否则记录“无需更新”。
- 复核 PRD 每个 acceptance criterion、生产 `.env`/数据库/知识库未入 Git、普通业务故障
  隔离和 rollback；提交：`chore: verify AI knowledge and UI iteration`。

## 执行状态（2026-08-31）

- [x] Profile/Provider 参数契约：`reasoningEffort` 枚举、Responses 映射、受控附加指令和
  旧 profile 兼容。
- [x] Copilot Prompt 固定安全段、版本标识和审计摘要。
- [x] 外部 Markdown/TXT 知识库：多根目录、realpath 边界、确定性检索、版本化原子缓存。
- [x] 三数据库问答历史表、自动清理设置、保留期和跨驱动 CRUD。
- [x] 管理员知识问答 API：引用映射、依据标识、分页/删除/清理/设置、限流和审计。
- [x] 管理员知识工作区和全站直角 HUD 控件：双主题、窄屏、键盘焦点和 busy 状态。
- [x] 文档、运维说明、架构边界及 Trellis backend/frontend 规范同步。
- [x] 质量门禁：变更 JavaScript 语法检查、聚焦测试、全量测试、官方 registry 审计、
  `git diff --check` 和浏览器 smoke 均通过；生产 `.env`、数据库、知识库与索引缓存未纳入 Git。
