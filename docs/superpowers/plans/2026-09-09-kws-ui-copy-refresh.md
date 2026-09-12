# KWS UI与文案整理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** 在不改变现有 API、数据库和静态前端架构的情况下，完成管理员设置分组、AI 配置可读性、项目/主页布局和中文文案统一。

**Architecture:** 继续使用单页管理员 HTML + 页面 IIFE + 共享 `workstation.css`。设置仅作为现有管理员模块的一个新显示分支；公开项目使用文本 `<article>` 加单一详情 `<a>`；所有 API/DTO/数据库和安全边界保持原样。

**Tech Stack:** Node.js 24、Express、原生 HTML/CSS/JavaScript、Node `node:test`、现有 Trellis 规范。

---

## 文件变更地图

- Modify: `public/admin/index.html` — 增加末尾“设置”选项卡和设置模块，重排 AI/本人任务/项目文案与表单分组。
- Modify: `public/admin/admin.js` — 注册 `settings` 模块切换，保留现有设置加载/写入行为，统一用户可见 AI 配置和项目分区文案。
- Modify: `public/workstation.css` — 添加设置、AI 配置、本人任务、项目详情和公开项目列表的稳定网格/间距/响应式规则。
- Modify: `public/index/main.js` — 将公开项目从整块链接卡片改为文本项目块 + “查看详情”链接。
- Modify: `public/index.html` — 将徽标改为 `KWS Work Hub`，仅在必要处调整主页结构类名。
- Modify: `tests/admin-ui-model.test.js` — 增加设置模块、AI 配置文案和文案边界的静态回归。
- Modify: `tests/project-static-ui.test.js` — 增加公开项目详情入口语义和“分区”文案回归。
- Modify: `docs/api/reference.md`, `docs/architecture/current.md`, `docs/product/feature-status.md`, `docs/plans/roadmap.md`, `docs/testing/release-checklist.md`, `.trellis/spec/backend/project-management.md` — 更新当前有效文档中的“泳道”术语和设置/公开页面描述；不改历史归档设计。
- Create: `.trellis/tasks/09-09-kws-ui-copy-refresh/prd.md`, `.trellis/tasks/09-09-kws-ui-copy-refresh/design.md` and `docs/superpowers/specs/2026-09-09-kws-ui-copy-refresh-design.md` — 已完成的规划工件。

### Task 1: 先锁定静态 UI 契约

**Files:**
- Modify: `tests/admin-ui-model.test.js`
- Modify: `tests/project-static-ui.test.js`

- [ ] **Step 1: 增加管理员设置和文案的失败断言**

在现有静态测试中加入以下可观察契约：

```js
assert.match(html, /id="tabSettings"/u);
assert.match(html, /id="moduleSettings"/u);
assert.match(html, />设置</u);
assert.match(html, />保存配置</u);
assert.doesNotMatch(html, />保存 profile</u);
assert.match(html, /id="aiProfileName"[\s\S]*id="aiProfileProtocol"/u);
```

项目静态测试增加：

```js
assert.match(html, /反馈分区/u);
assert.match(html, /WorkTask 分区/u);
assert.doesNotMatch(html, /泳道/u);
assert.match(homeJs, /project-home-card-action/u);
```

- [ ] **Step 2: 运行聚焦测试确认新增契约当前失败**

Run: `node --test tests/admin-ui-model.test.js tests/project-static-ui.test.js`

Expected: FAIL only on newly added settings/文案 assertions; existing tests should still report their current baseline results.

- [ ] **Step 3: 保留失败输出作为执行依据**

记录失败断言对应的缺口，不修改测试去适配旧实现；后续每个 UI 任务完成后重跑相同命令。

### Task 2: 管理员设置模块和 AI/任务表单结构

**Files:**
- Modify: `public/admin/index.html`
- Modify: `public/admin/admin.js`

- [ ] **Step 1: 移动设置 DOM 并新增选项卡**

在现有业务标签后加入：

```html
<button class="tab" id="tabSettings" type="button" aria-controls="moduleSettings" aria-selected="false">设置</button>
```

将 SMTP/Webhook、状态设置和 AI Copilot 区块放入：

```html
<section id="moduleSettings" class="hidden settings-shell" aria-labelledby="settingsTitle">
  <div class="settings-header"><h2 id="settingsTitle">系统设置</h2><p>配置通知、状态展示和 AI 辅助。</p></div>
  <!-- 保留原有输入/button id，仅改变父级与分组类名 -->
</section>
```

设置模块必须只出现一份原有 id；知识助手模块不移动。

- [ ] **Step 2: 把 AI profile 单行 toolbar 改为语义网格**

把原 `toolbar-spaced` 包装替换为 `.ai-profile-form`，保留字段 id 与原顺序，用户可见按钮使用：

```html
<button class="primary" id="aiProfileSaveBtn" type="button">保存配置</button>
```

配置列表的空态、active 状态、编辑/诊断/删除按钮和提示文案统一使用“AI 配置”；`data-action`、`data-id`、API 负载不变。

- [ ] **Step 3: 按分组包装本人任务录入**

保留 `createType`、`createPriority`、`createStatus`、`createShowOnHome`、`createTitle`、`createAssignee`、`createExpectedAt`、`createScheduledAt`、`createTags`、`createContent`、`createPublicReply`、`createAdminNote` 及现有按钮 id，只新增语义区块和 CSS 类：基本信息、负责人和时间、标签与说明、公开与内部、提交操作。

- [ ] **Step 4: 更新项目/知识/主页文案**

在静态 HTML 中将关系标题和按钮改为“反馈分区”“WorkTask 分区”“添加反馈”；将知识助手 placeholder 改成通用问题提示；将徽标文本改为 `KWS Work Hub`。不要更改项目 API 的 data 属性或模型字段。

- [ ] **Step 5: 在 admin.js 中接入 settings 状态**

新增 `tabSettings`、`moduleSettings` 引用和 `isSettings` 分支：

```js
const isSettings = module === "settings";
tabSettings.classList.toggle("active", isSettings);
moduleSettings.classList.toggle("hidden", !isSettings);
```

同步维护 `aria-selected`，保留现有其他模块加载分支；添加 `tabSettings.addEventListener("click", () => switchModule("settings"));`。刷新设置时重读现有设置/AI 状态，不触发 SMTP、Webhook 或 Provider 请求。

- [ ] **Step 6: 更新动态 AI/项目文案**

在 `renderAiProfiles`、`renderAiStatus`、`renderAiDiagnostics` 和相关 toast 文案中仅替换用户可见文本：`profile` → `AI 配置`，`active` → `当前配置`；保留变量、对象键和 API 字段。将 `renderProjectKanban` 的 `${sourceLabel} 泳道` 改为 `${sourceLabel} 分区`。

### Task 3: 共享布局和项目详情视觉修复

**Files:**
- Modify: `public/workstation.css`

- [ ] **Step 1: 添加设置和 AI 配置网格**

新增命名空间规则（保持直角）：

```css
.admin-page .settings-shell,
.admin-page .settings-section { display: grid; gap: var(--ws-space-4); }
.admin-page .ai-profile-form { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:var(--ws-space-3); }
.admin-page .ai-profile-form .field-wide { grid-column:1 / -1; }
```

为标签和字段设置稳定的 `min-width: 0`、整行 textarea、足够的区块 padding；760px 左右切换单列。

- [ ] **Step 2: 添加本人任务分组和项目详情间距**

为 `.worktask-create-group`、`.project-edit-form`、`.project-public-options`、`.project-inline-form`、`.project-subsection` 增加统一 gap、标题层级和 `minmax(0, 1fr)`，在 620px 以下单列并保持按钮可用宽度。

- [ ] **Step 3: 保持主页/项目列表风格一致**

将 `.project-home-card` 适配为非链接容器；`.project-home-card-action` 仅作用于详情链接，移除 text-decoration，增加明确 border/focus/hover 状态；标题/描述使用 `overflow-wrap:anywhere`。保留桌面两列和窄屏单列。

- [ ] **Step 4: 运行 CSS/HTML 静态门禁**

Run: `git diff --check`

Expected: no whitespace errors; no page-local `border-radius` override reintroduces rounded controls.

### Task 4: 公开项目渲染边界

**Files:**
- Modify: `public/index/main.js`
- Modify: `public/index.html`

- [ ] **Step 1: 重写 renderPublicProjects 的容器语义**

保持 API 过滤和 `publicKey` 编码，使用 DOM API 创建：

```js
const card = document.createElement("article");
card.className = "project-home-card";
appendTextElement(card, "h3", "project-home-card-title", name);
appendTextElement(card, "p", "project-home-card-description", project.description || "暂无项目说明。");
const action = document.createElement("a");
action.className = "project-home-card-action";
action.href = `/project/?key=${encodeURIComponent(project.publicKey.trim())}`;
action.textContent = "查看详情";
action.setAttribute("aria-label", `查看项目详情：${name}`);
card.appendChild(action);
```

不把项目标题或描述作为链接；不将未转义 API 字符串插入 innerHTML。

- [ ] **Step 2: 运行首页静态契约测试**

Run: `node --test tests/project-static-ui.test.js`

Expected: 公开项目保留 `/api/public/projects` 与编码链接契约，同时通过无整块 `<a>` 的渲染边界断言。

### Task 5: 当前文档术语同步

**Files:**
- Modify: `docs/api/reference.md`
- Modify: `docs/architecture/current.md`
- Modify: `docs/product/feature-status.md`
- Modify: `docs/plans/roadmap.md`
- Modify: `docs/testing/release-checklist.md`
- Modify: `.trellis/spec/backend/project-management.md`

- [ ] **Step 1: 只替换当前有效说明中的术语**

把描述当前 UI/数据投影的“Feedback 泳道”“WorkTask 泳道”“两条泳道”改为“反馈分区”“WorkTask 分区”“两个来源分区”；历史归档任务和已批准的历史设计文档不改写。

- [ ] **Step 2: 记录 AI 配置展示规则**

在当前 AI Copilot 操作说明中注明用户界面使用“AI 配置”，内部 API/数据库仍使用 `profile`/`profileId`，避免文档和界面重新出现混合文案。

- [ ] **Step 3: 运行文档引用搜索**

Run: `rg -n -S '泳道|保存 profile|active profile|Simple Entry|TYUTland 的登录流程' public docs .trellis/spec --glob '!**/archive/**'`

Expected: 只剩本轮规划工件中为解释“原词 → 新词”而保留的引用，以及明确的内部字段说明；产品/操作界面不再出现旧用户文案。

### Task 6: 全量验证和交付门禁

**Files:**
- Test: `tests/admin-ui-model.test.js`, `tests/project-static-ui.test.js`, relevant existing tests

- [ ] **Step 1: 运行变更脚本语法检查**

Run: `node --check public/admin/admin.js; node --check public/index/main.js; node --check public/project/main.js`

Expected: all commands exit 0.

- [ ] **Step 2: 运行聚焦测试**

Run: `node --test tests/admin-ui-model.test.js tests/project-static-ui.test.js tests/project-model.test.js tests/ai-profiles.test.js`

Expected: PASS.

- [ ] **Step 3: 运行完整测试基线**

Run: `npm test`

Expected: all tests pass; if the active Node/better-sqlite3 ABI prevents loading SQLite, record the exact blocker and do not claim a full pass.

- [ ] **Step 4: 手工浏览器冒烟**

使用本地管理员页面，验证：设置 tab 只显示设置内容；AI 配置字段双列/单列、按钮和列表文案；项目详情“反馈分区/WorkTask 分区”；主页项目标题/描述不可点击且只有“查看详情”导航；知识助手通用 placeholder；亮/暗主题、Tab 焦点和 620px 无水平溢出。不要点击 SMTP/Webhook 测试或真实 Provider 诊断。

- [ ] **Step 5: 完成 Trellis 质量检查和提交**

运行 `git diff --check`，确认 diff 只包含本任务文件和规划工件，更新任务验收项/开发日志后提交单一 UI 文案整理提交；不修改用户已有 `.env`、数据库或部署目录。
