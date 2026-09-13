# Frontend Component Guidelines

## What a component means here

This project has no React/Vue component model or component library. A
“component” is a semantic HTML section plus the page-local render or event
functions that operate on its DOM nodes. Do not add a framework component just
to reuse one card or form.

Use stable IDs and data-action attributes as the local contracts. For example,
public/admin/index.html defines feedbackList and worktaskList, while
public/admin/admin.js attaches one click listener to each list and dispatches
by data-action.

## Rendering pattern

Keep render functions pure with respect to their input and write only to the
target node. The existing patterns are:

- renderList in public/index/main.js for public showcase items.
- renderFeedbackList and renderWorktaskList in public/admin/admin.js for
  repeated admin records.
- showMessage/showToast for status feedback.

When a template uses innerHTML, escape every API or user value first with
escapeHtml (or linkifySafeText, which escapes before adding safe links).
Prefer textContent, classList, and createElement for one-off text or state
updates. Keep external links target="_blank" only with
rel="noopener noreferrer".

~~~js
container.innerHTML = items.map(renderItem).join("");
~~~

The renderItem function must escape every dynamic field before it is inserted.

## Inputs and composition

HTML forms define the field names and browser constraints (required, maxlength,
and type="datetime-local"). The submit handler trims values, converts local
date-time to ISO when needed, sends JSON, and restores the button in finally.
Keep the DOM field name, payload key, and backend validator key aligned.

Use small page-local functions rather than a prop system. If two pages really
share behavior, first extract a narrow function with an explicit argument
shape; do not create a speculative component framework.

## Styling and accessibility

Use `public/workstation.css` as the shared base for cold-color tokens, square
geometry, focus rings, status messages, and responsive behavior. Keep only
page-specific layout rules in each page's style block, and load the shared
stylesheet after those blocks so the square-control contract cannot be
reintroduced accidentally. Preserve the existing CSS variables, responsive
breakpoints, light/dark `data-theme` selector, and reduced visual complexity.
Every `<button>` must declare an explicit `type`: `submit` only for the form's
primary submission, `button` for tabs, pagination, reset, cleanup, and other
actions. Dynamic buttons rendered through `innerHTML` must include the same
attribute and a semantic class (`primary`, `secondary`, or `danger`) when the
action needs a hierarchy. Under `.admin-page`, the shared stylesheet enforces
`border-radius: 0`, hover/active/disabled/busy states, and a visible
`focus-visible` outline; do not add page-local rounded overrides.
Every form control should retain its associated label, visible validation/status
text should use `textContent`, and notifications should keep
`aria-live="polite"` as in the admin toast region. Images need meaningful `alt`
text or an intentionally empty alt for decorative icons.

## Common mistakes

- Inserting raw feedback content, contact details, or provider payloads into
  innerHTML.
- Reading a DOM node before the page script is loaded.
- Mutating a list item without reloading the server projection after a write.
- Replacing the established theme variables with a page-specific palette.
- Leaving a button without `type`, which makes it an accidental form submit and
  causes browser default styling to leak into the HUD contract.
- Rendering knowledge citations or history with unescaped API values; use
  `escapeHtml` for templates and `textContent` for answer/status text.
- Adding React props/hooks or a component package to a static page.

Reference files: public/index/main.js:101-185,
public/admin/admin.js:281-364, public/admin/index.html:118-217, and
public/theme.js.

## AI diagnostics and metrics panels

The admin AI diagnostics and metrics areas are page-local server state. Render
only the normalized projections from `public/admin/ai-model.js`: profile name,
protocol/model summary, fixed endpoint suffix, bounded check/status fields,
aggregate counts, and safe error codes. Never render a Provider URL, key,
prompt, response body, or unbounded usage/request identifier. Diagnostic buttons
must remain explicit `type="button"`, show a busy state, and restore their
label/disabled state in `finally`; a failed diagnostic must not replace the
profile list or active-profile state. Metric refresh uses the bounded 24 h/7 d/
30 d selectors and renders no individual request rows.

## Admin settings and public project entries

The admin page keeps cross-cutting configuration controls in the terminal
`settings` tab (`#tabSettings` / `#moduleSettings`). SMTP/Webhook tests, status
display controls, and AI configuration/diagnostics belong there; business tabs
must not render a second copy of those controls. Switching tabs must toggle the
module's `hidden` state while preserving the existing element IDs and event
handlers.

Public project lists use an `article.project-home-card` as the visual boundary.
Project name and description are text nodes, not links; only the explicit
"查看详情" link navigates to `/project/?key=<encoded public key>`. Keep
`overflow-wrap: anywhere` (or an equivalent bounded rule) on the title and
description so mixed-language content cannot widen the page.

Public project details keep work items in two independent sections:
`#projectItemsSection` contains `#projectPublicFeedbackList` and
`#projectPublicWorktaskList`. Render only the server allow-list fields
(`sourceType`, title, native status, optional `publicReply`, and `updatedAt`)
with `textContent`/`createElement`; do not infer or display internal IDs,
relationship IDs, source content, contacts, administrator notes, or Kanban
state. When the API omits `items`, hide the whole section; when a section is
present but empty, show its safe empty state.

## Admin Work Hub module

### 1. Scope / Trigger

本规范适用于管理员页的 Work Hub 总览标签、四个摘要分区和既有详情跳转。它触发于
跨来源聚合展示或管理员列表精确定位，不创建第二套编辑/状态操作界面。

### 2. Signatures

- `loadWorkHub() -> Promise<void>`：通过 `GET /api/admin/work-hub/overview` 读取一次安全投影。
- `renderWorkHub(data)`、`renderWorkHubSection(config, section)`：仅写入 Work Hub 自身 DOM。
- `data-action="work-hub-open-item|work-hub-open-project|work-hub-retry"`：事件代理入口。

### 3. Contracts

- `#tabWorkHub` 与 `#moduleWorkHub` 独立存在；登录后仍默认进入工作收件箱。
- 四个分区固定为逾期、近期计划、未分配、最近更新，各自含数量、列表和 `aria-live` 状态节点；
  请求使用递增 request ID，登出时清空，不写 localStorage、不启动定时刷新。
- 标题、类型、状态、优先级、负责人、项目名和时间进入 `innerHTML` 前必须 `escapeHtml`；
  摘要标题不是链接，按钮统一显式 `type="button"`。
- 单来源错误显示分区级失败/重试；两来源均失败显示整页重试；不展示后端异常原文或上次缓存。
  条目按钮切换到现有 Feedback/WorkTask 列表并携带 `id`，项目按钮复用现有 `#projects/<id>` hash。
- 共享样式沿用冷色、亮暗主题、直角控件、`focus-visible` 和窄屏规则，不添加圆角或新框架。

### 4. Validation & Error Matrix

| 条件 | 结果 |
|---|---|
| 加载中 | 四区 `aria-busy="true"`，显示短加载状态，刷新按钮进入忙碌态 |
| 空分区 | 数量为 0，显示“当前没有符合条件的记录” |
| 分区 `error`/`partial` | 显示可理解状态和“重试 Work Hub”按钮，保留可用摘要 |
| 请求失败 | 四区显示安全失败占位，页面状态提示检查登录后重试 |
| 用户点击条目/项目 | 进入既有列表或项目详情，不新增写入逻辑 |

### 5. Good / Base / Bad Cases

- Good：键盘可聚焦刷新、重试和跳转按钮，长中文/混合标题换行不撑宽，亮暗主题均保持对比度。
- Base：工作项无项目时显示“未归属”，缺失字段使用短安全占位。
- Bad：把摘要标题渲染成未经转义的链接、把完整正文/联系方式插入卡片，或让 Work Hub 自己保存状态。

### 6. Tests Required

- 静态 DOM：tab/module、四个分区、`aria-live`、动态按钮 `type`、操作 data-action 和 `escapeHtml`。
- 状态渲染：加载、空、单来源失败、部分成功、全失败重试和过期响应不覆盖新状态。
- 手工浏览器：管理员登录、摘要跳转、项目 hash、Tab 键焦点、亮暗主题、约 620px 窄屏及长标题。

### 7. Wrong vs Correct

#### Wrong

```js
list.innerHTML = `<a href="/admin/${item.sourceId}">${item.title}</a>`;
```

#### Correct

```js
list.innerHTML = `<h4>${escapeHtml(item.title)}</h4>
  <button type="button" data-action="work-hub-open-item">查看条目</button>`;
```

## External icon boundary

The MeowStatus adapter is the authoritative validator for Minecraft favicon
data URLs. The static page must retain a second lightweight check before
building an `<img>` attribute: allow only `data:image/png|jpeg|jpg|gif|webp`
base64 URLs and reject values longer than 256 KiB. Always pass accepted values
through `escapeHtml`; never render an external URL or SVG returned by an
upstream service. Invalid icons render as the existing hidden placeholder and
must not prevent the status card from showing its text state.
