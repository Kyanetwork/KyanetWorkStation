# R-002 服务端流式 CSV 导出与操作审计实施计划

> **For agentic workers:** 在 `task.py start` 将任务置为 `in_progress` 后，按顺序执行以下步骤。每个任务都应先写失败测试，再写最小实现；完成每个阶段后运行对应验证，不得把未授权的生产配置、数据库或真实 Provider 纳入提交。

**Goal:** 用服务端有界分批 CSV 导出替换浏览器全量拼接，并为高影响管理员操作增加动作级脱敏审计。

**Architecture:** `server/config.js` 提供可调整的导出上限；`server/admin-export.js` 负责 CSV 列、转义、分批和背压；`server/admin-audit-metadata.js` 负责共享的元数据白名单，`server/admin-audit.js` 负责安全审计写入；`server/db.js` 负责三数据库 schema、计数、批次读取和审计查询；`server/app.js` 只编排已认证路由；管理员页面一次 POST 下载服务端流。

**Tech Stack:** Node.js 24 CommonJS、Express 原生响应流、现有 SQLite/MySQL/PostgreSQL 适配、原生 HTML/CSS/JavaScript、Node `node:test`。

---

## 依赖与变更边界

执行顺序固定为：配置与校验 → 数据库审计/schema → CSV 导出模块 → 审计辅助与动作接入 → API 与前端下载 → 文档同步 → 全范围质量门禁。

预计变更文件：

- 修改 `server/config.js`、`.env.example`、`server/validation.js`、`server/db.js`、`server/app.js`。
- 新建 `server/admin-export.js`、`server/admin-audit.js`、`server/admin-audit-metadata.js`。
- 修改 `public/admin/admin.js`；仅在需要展示导出上限/拆分提示时更新 `public/admin/index.html` 的对应文案。
- 新增/修改 `tests/config.test.js`、`tests/validation.test.js`、`tests/admin-export.test.js`、`tests/admin-audit.test.js`、`tests/account-submission.test.js` 或独立管理 API 测试。
- 同步 `docs/api/reference.md`、`docs/operations/configuration.md`、`docs/operations/observability.md`、`docs/operations/security.md`、`docs/testing/release-checklist.md`、`docs/architecture/current.md`、`docs/product/feature-status.md`、`docs/plans/known-defects.md`、`docs/plans/roadmap.md`、`README.md`。

明确不改：数据库内容、生产 `.env`、备份/日志、KyanetAccount 联动、React/TypeScript/ORM/队列、复杂审计前端、真实云服务器配置。

## Task 1: 导出配置与筛选校验

**Files:**

- Modify: `server/config.js` 的 `rawInput`、`config` 和 `validateRuntimeConfig`。
- Modify: `.env.example`。
- Modify: `server/validation.js`，新增导出/审计查询验证器并导出。
- Test: `tests/config.test.js`、`tests/validation.test.js`。

- [ ] **Step 1: 写失败测试**：断言缺失 `ADMIN_EXPORT_MAX_ROWS` 得到 `10000`；显式 `100`、`100000` 通过；`99`、`100001`、`1.5`、`abc` 使 `validateRuntimeConfig` 返回错误且不回显敏感内容。断言反馈导出接受 `status/keyword`，WorkTask 导出接受 `status/priority/keyword`，审计查询拒绝非法 `entityId`/时间范围并将 pageSize 限制为 100。
- [ ] **Step 2: 运行聚焦测试确认失败**：运行 `node --test tests/config.test.js tests/validation.test.js`，预期新断言因配置字段/验证器不存在而失败。
- [ ] **Step 3: 实现最小配置与验证**：使用 `parseIntOrDefault` 默认 10000；把原始环境变量放入 `rawInput.adminExportMaxRows`；在正整数检查中加入 100–100000 范围；新增 `validateFeedbackExportPayload`、`validateWorktaskExportPayload`、`validateAuditListPayload`，复用现有枚举/关键词/ID/日期规则，不接受业务正文。
- [ ] **Step 4: 运行通过测试**：重复运行上述命令，预期通过；运行 `node --check server/config.js server/validation.js`。
- [ ] **Step 5: 更新示例配置**：在 `.env.example` 增加 `ADMIN_EXPORT_MAX_ROWS=10000` 及“100–100000、修改后重启、不要填无限大”的说明；运行 `git diff --check`。

## Task 2: 审计表与数据库函数

**Files:**

- Modify: `server/db.js` 的三数据库 schema、映射、过滤、导出函数和 `module.exports`。
- Modify: `scripts/verify-sqlite-backup.js`，将 `admin_audit` 纳入关键表检查。
- Test: `tests/admin-audit.test.js`、`tests/backup-sqlite.test.js`（审计表加入关键表/初始化回归）。

- [ ] **Step 1: 写失败测试**：临时 SQLite 初始化两次，断言 `admin_audit` 可用；调用 `createAdminAudit` 写入脱敏 metadata，调用 `listAdminAudits` 按 action/entity/actor/from/to/page/pageSize 查询；metadata 超过 2048 字节或包含未允许结构被安全降级；旧表数据保持可读。
- [ ] **Step 2: 运行失败测试**：运行 `node --test tests/admin-audit.test.js`，预期因表和函数不存在而失败。
- [ ] **Step 3: 增加三数据库 schema**：在 SQLite/MySQL/PostgreSQL schema 中加入同语义 `admin_audit` 表和时间、动作、实体、管理员索引；使用各驱动现有 ID/文本类型，`CREATE TABLE IF NOT EXISTS`，不删除旧列/表。
- [ ] **Step 4: 实现数据库接口**：新增 `createAdminAudit(input)`、`countExportRows(entityType, filters)`、`listFeedbackExportBatch(filters, limit, offset)`、`listWorktaskExportBatch(filters, limit, offset)`、`listAdminAudits(filters)`；所有 SQL 使用 `placeholder` 与参数绑定，返回 camelCase，metadata 解析失败返回 `{}`。
- [ ] **Step 5: 运行通过测试**：运行 `node --test tests/admin-audit.test.js tests/backup-sqlite.test.js`；运行 `node --check server/db.js`。

## Task 3: CSV 分批流模块

**Files:**

- Create: `server/admin-export.js`。
- Test: `tests/admin-export.test.js`。

- [ ] **Step 1: 写失败测试**：构造可控批次回调，断言导出写出 BOM、稳定表头、逗号/双引号/换行/Unicode 转义；批次大小为 250；总量超过限制时不调用 writer；writer 返回 false 时等待 `drain`；错误只返回脱敏 stream error。
- [ ] **Step 2: 运行失败测试**：运行 `node --test tests/admin-export.test.js`，预期因模块不存在而失败。
- [ ] **Step 3: 实现最小模块**：导出 `EXPORT_BATCH_SIZE=250`、反馈/WorkTask 列定义、`csvEscape`、`writeCsvExport({res,total,maxRows,filename,columns,fetchBatch,recordProgress})`；先检查上限，再设置 `Content-Type/Content-Disposition/Cache-Control/X-Export-Count`，循环 `fetchBatch(limit,offset)` 并写入，背压等待 `drain`，不保存全量 rows。
- [ ] **Step 4: 运行通过测试**：重复聚焦测试；运行 `node --check server/admin-export.js`。

## Task 4: 审计安全辅助与管理员动作接入

**Files:**

- Create: `server/admin-audit.js`。
- Create: `server/admin-audit-metadata.js`。
- Modify: `server/app.js` 各管理员写路由与导出路由。
- Test: `tests/admin-audit.test.js`、管理 API 回归测试。

- [ ] **Step 1: 写失败测试**：对状态、删除、主页展示、备注/回复、WorkTask 创建/安排、AI decision、通知 retry 和两类导出发起管理员请求，断言出现稳定点号 action；未找到/超限结果分别为 `not_found`/`rejected`；模拟审计数据库异常时业务成功响应仍保持原语义。
- [ ] **Step 2: 运行失败测试**：运行相关管理 API 测试，预期因路由未调用审计而失败。
- [ ] **Step 3: 实现安全记录器**：`recordAdminAuditSafely({req, action, entityType, entityId, result, metadata})` 只接受代码构造的白名单 metadata、长度不超过 2048；调用 DB 失败时用 `logger.warn({event:"admin.audit.write.error",requestId,action,errorCode},...)`，不向上抛错。
- [ ] **Step 4: 接入路由**：在现有业务调用完成后记录成功/未找到；导出超限记录拒绝，流结束/中止记录成功/失败；AI profile 与 suggestion、notification retry/status settings 等既有高影响管理员动作补齐 action。导出路由在业务层之前完成验证和 count，响应头发送前才能返回 JSON 错误。
- [ ] **Step 5: 运行通过测试**：运行管理 API 聚焦测试和 `node --check server/app.js server/admin-audit.js`。

## Task 5: 审计查询 API 与服务端导出 API

**Files:**

- Modify: `server/app.js` 路由注册和 imports。
- Modify: `server/validation.js`（若 Task 1 验证器需补全）。
- Test: `tests/account-submission.test.js` 或新建 `tests/admin-export-api.test.js`。

- [ ] **Step 1: 写失败 API 测试**：登录管理员后调用两个导出接口和 `/api/admin/audit/list`；断言未登录导出/查询为 401；超限为 413 `EXPORT_LIMIT_EXCEEDED` 且 JSON envelope；成功响应的 headers/body/筛选/审计记录正确。
- [ ] **Step 2: 运行失败测试**：运行 `node --test tests/admin-export-api.test.js`，预期路由未注册而失败。
- [ ] **Step 3: 实现路由**：新增 `POST /api/admin/feedback/export`、`POST /api/admin/worktask/export`、`POST /api/admin/audit/list`，沿用管理员 middleware；用 `sendError` 处理发送前错误，用 `writeCsvExport` 处理流；审计查询只暴露安全 DTO。
- [ ] **Step 4: 运行通过测试**：重复聚焦测试；运行 `node --check server/app.js server/validation.js`。

## Task 6: 管理员页面改为服务端下载

**Files:**

- Modify: `public/admin/admin.js` 导出辅助函数和两个导出按钮事件。
- Modify: `public/admin/index.html`，如需补充上限/拆分提示只改文案。
- Test: `tests/admin-ui-model.test.js` 或新增最小前端单元断言；浏览器手工冒烟。

- [ ] **Step 1: 写失败前端断言**：静态检查导出事件使用一次 `/api/admin/feedback/export` 或 `/api/admin/worktask/export` POST，不再调用 `fetchAllFeedbackForExport`/`fetchAllWorktaskForExport`；错误 envelope 能显示 `EXPORT_LIMIT_EXCEEDED`。
- [ ] **Step 2: 运行失败检查**：运行 `node --test tests/admin-ui-model.test.js`（或新增测试），预期旧实现仍分页拉取而失败。
- [ ] **Step 3: 实现最小下载**：删除/停用全量抓取辅助；使用 `fetch` 发送 JSON，成功将响应 Blob 交给临时 `<a download>`，失败解析 JSON 后调用现有 `notify`；不写 localStorage，不改变筛选状态或业务表单。
- [ ] **Step 4: 运行通过检查**：运行 `node --check public/admin/admin.js`；浏览器验证未登录、成功下载、超限提示、亮暗主题、键盘焦点和 620px 窄屏。

## Task 7: 文档同步

**Files:** `README.md`、`docs/api/reference.md`、`docs/operations/configuration.md`、`docs/operations/observability.md`、`docs/operations/security.md`、`docs/testing/release-checklist.md`、`docs/architecture/current.md`、`docs/product/feature-status.md`、`docs/plans/known-defects.md`、`docs/plans/roadmap.md`。

- [ ] **Step 1: 更新 API/配置**：记录环境变量默认/范围/重启要求、两个导出接口、审计查询接口、headers、413 错误和 CSV 列；明确审计不保存正文/联系方式/密钥。
- [ ] **Step 2: 更新架构/运维**：补充分批背压流程、无长事务快照边界、审计写入失败降级、数据库备份保留和调低上限回滚步骤。
- [ ] **Step 3: 更新状态/缺陷/路线图**：将 R-002 标记已实现/待发布验证，保留 V-005 真实 RDBMS 缺口；修正 `docs/testing/release-checklist.md` 中旧的测试数量为最近一次实际基线。
- [ ] **Step 4: 一致性检查**：运行 `rg -n "ADMIN_EXPORT_MAX_ROWS|EXPORT_LIMIT_EXCEEDED|admin_audit|/api/admin/(feedback|worktask)/export|/api/admin/audit/list" README.md docs .env.example`，确认无互相矛盾或真实配置泄露。

## Task 8: 全范围质量门禁与回滚检查

- [ ] **Step 1: 语法与聚焦测试**：运行所有变更 JavaScript 的 `node --check`，再运行 Task 1–6 的全部聚焦测试。
- [ ] **Step 2: 完整测试与审计**：运行 `npm test`、`npm audit --omit=dev --registry=https://registry.npmjs.org`、`git diff --check`。
- [ ] **Step 3: 跨层复核**：按 `.trellis/spec/backend` 和 `.trellis/spec/frontend` Quality Check 检查 API envelope、认证/同源/JSON middleware、SQL 参数化、metadata 白名单、页面错误/键盘/主题/窄屏。
- [ ] **Step 4: 隔离部署冒烟**：临时 SQLite 验证导出、审计和旧表启动；不修改生产 `.env`、数据库、备份或真实 Provider。若要云服务器验证，由用户另行执行 git 同步/备份/PM2 重启并回传结果。
- [ ] **Step 5: Trellis 校验**：运行 `python ./.trellis/scripts/task.py validate .trellis/tasks/08-29-r002-server-csv-audit`，确认文档、测试和上下文有效；最后由 `trellis-check` 做全范围检查。

## 回滚点

- 配置压力：将 `ADMIN_EXPORT_MAX_ROWS` 调低至安全范围并重启 PM2。
- 功能异常：回滚代码版本；旧分页列表仍可工作，旧版本忽略新增 `admin_audit` 表。
- 数据安全：不删除审计表、业务数据、备份或日志；不覆盖生产 `.env`。

## 当前验证记录（2026-08-29）

- 变更 JavaScript 全部通过 `node --check`；`npm test`：123/123；
  `npm audit --omit=dev --registry=https://registry.npmjs.org`：0 vulnerabilities；
  `git diff --check` 和 `task.py validate` 通过。审计 metadata 对 URL 形态的
  `model` 值做丢弃处理，并有回归覆盖。
- 隔离 SQLite 浏览器冒烟：管理员登录、反馈超限错误提示、筛选后反馈 CSV 成功提示、
  WorkTask CSV（0 条）成功提示、亮暗主题切换、方框控件、键盘焦点环和 620px 窄屏无横向
  溢出均已验证。测试数据库、临时进程和临时目录已清理；未触碰生产 `.env`、数据库、
  备份、日志、Provider 或云服务器。
