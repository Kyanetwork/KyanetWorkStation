# Work Hub 总览增强实施计划

> 用户已批准规划并执行 `task.py start`；以下清单记录本任务的实际实现与验证状态。

## 完成定义

- 管理员可从独立 Work Hub 标签看到四个固定规则的关注分区，并能返回现有收件箱、
  Feedback/WorkTask 管理和项目详情。
- 新的只读聚合读取只返回 allow-list 字段，兼容三种数据库，不改变 schema 或旧列表
  响应；单来源失败按分区降级，全部失败可重试。
- 摘要可通过既有详情渲染定位到准确来源条目；项目上下文可进入现有项目 hash 详情。
- 相关纯函数、数据库/API、敏感字段、降级和静态 UI 测试通过，完整回归与手工浏览器
  检查结果有记录。

## 0. 启动前门禁（`task.py start` 后）

- [x] 用户明确批准最新规划摘要；任务目录为
      `.trellis/tasks/09-12-work-hub-overview`。
- [x] 执行 `python ./.trellis/scripts/task.py start .trellis/tasks/09-12-work-hub-overview`，
      确认状态变为 `in_progress`。
- [x] 加载 `trellis-before-dev`，读取本任务 PRD、设计、计划和 backend/frontend 规范。
- [x] 保存分支、`git status --short`、Node/npm 版本与现有测试基线；当前运行环境为
      `main`、Node `v24.19.0`、npm `12.0.2`，未覆盖用户已有改动。
- [x] 若任务仍使用 Codex auto/sub-agent 模式，确认 `implement.jsonl` 与 `check.jsonl`
      已有真实规范条目；若为 inline 模式，跳过 JSONL 门禁并在主会话执行。

## 1. 先写失败测试与契约

**预期文件：** `tests/work-hub.test.js`（或按现有测试布局拆分）、
`tests/validation.test.js`、`tests/project-static-ui.test.js`、必要的前端静态测试。

- [x] 为时间分类写纯函数测试：`scheduledAt === generatedAt` 进入近期而非逾期；
      `scheduledAt === windowEnd` 不进入近期；终止状态不进入逾期/近期/未分配；
      最近更新只接受 `[now - 7d, now]`；缺失/无效时间被排除。
- [x] 为排序和截断写测试：对应时间倒序、来源类型/ID 稳定排序、每区最多 10 条。
- [x] 为 WorkTask 空白负责人、Feedback 不适用字段、项目未归属和禁止字段写测试。
- [x] 为可选正整数 `id` 列表过滤写验证器/数据库契约测试，确保旧请求和响应形状不变。
- [x] 为管理员 API 写 401、成功 envelope、四区数据、项目映射和全来源失败安全形状测试。
- [x] 为前端静态结构写失败断言：`tabWorkHub`、`moduleWorkHub`、四区容器、显式按钮
      `type`、摘要跳转、错误/重试状态和转义调用。

## 2. 后端安全聚合读取

**预期文件：** `server/db.js`、必要时 `server/app.js`、`server/validation.js`。

- [x] 在 `db.js` 增加 Work Hub 专用映射和读取函数；不要复用管理员完整行 mapper，
      不选择正文、联系方式、图片、管理员备注、Account 快照或通知字段。
- [x] 以同一个 `generatedAt` 计算 7 天起止时间；分别构造 Feedback 最近更新和
      WorkTask 四类查询，所有时间/状态/数量使用 `placeholder()` 参数绑定。
- [x] 使用固定安全 SQL 片段、`LEFT JOIN project_item/project` 和有限 `LIMIT`；
      映射层再次排除无法解析的日期并生成 `{ id, name }` 项目上下文或 `null`。
- [x] 对 Feedback/WorkTask 读取使用 `Promise.allSettled` 或等价隔离；将失败转换为
      稳定 `status`/`errorCode`，只写有限结构化 warning，不返回 SQL/异常文本。
- [x] 在 `app.js` 注册 `GET /api/admin/work-hub/overview`，置于管理员会话后，
      成功和部分失败均返回 `{ ok: true, data }`；认证/未预期错误沿用现有 envelope。
- [x] 在现有列表验证器、过滤构造和 `listFeedback`/`listWorktask` 中加入可选正整数
      `id`，保持其他筛选、分页、排序和响应不变，以支持 Work Hub 精确定位。

## 3. 管理员 Work Hub 模块

**预期文件：** `public/admin/index.html`、`public/admin/admin.js`、
`public/workstation.css`，必要时独立的 `public/admin/*-model.js`。

- [x] 增加独立 Work Hub tab/module，保留登录后默认收件箱；四个分区使用语义化标题、
      数量、列表和 `aria-live` 状态节点，所有动态按钮显式 `type="button"`。
- [x] 扩展 page-local state、模块切换和刷新分支；请求带递增 request ID，避免过期响应
      覆盖新状态；登出清理，不使用 localStorage 或定时轮询。
- [x] 实现安全渲染：标题、类型、状态、项目名和时间全部 `escapeHtml`，不可信标题不
      作为链接；空、加载、部分失败、全失败和重试文案可理解。
- [x] “查看条目”切换到对应专项管理 tab，通过 `id` 过滤加载完整现有条目并复用已有
      操作监听；“查看项目”只在存在项目 ID 时写入 `#projects/<id>` 并调用既有详情加载。
- [x] 在共享 CSS 中补充 Work Hub 分区、摘要卡片、状态/重试和窄屏布局，延续冷色、
      亮暗主题、直角控件、focus-visible 和 reduced-motion 约束；不引入圆角或新框架。
- [x] 将刷新按钮接入 Work Hub；其他模块的刷新、筛选、分页和写入行为保持原样。

## 4. 测试与手工验证

- [x] 运行 `node --check server/db.js server/app.js server/validation.js public/admin/admin.js`
      及所有新增/修改的 JavaScript。
- [x] 运行聚焦测试：Work Hub 数据分类/DB/API、验证器、项目/静态 UI 测试，并确保
      临时数据库、进程、定时器在 `finally` 清理。
- [x] 运行 `npm test`、`git diff --check`、`python ./.trellis/scripts/task.py validate
      .trellis/tasks/09-12-work-hub-overview` 和 canonical registry 依赖审计；记录环境
      阻塞而不把未执行写成通过。
- [ ] 手工浏览器验证：管理员登录→Work Hub；真实逾期/近期/未分配/最近更新；未归属
      项目；摘要跳转并可返回；空数据；模拟单来源失败和全失败；刷新/重试；亮暗主题；
      Tab 焦点；约 620px 窄屏无水平溢出；长中文/混合文本不破版。
- [x] 用敏感字段审计确认响应与 DOM 不含 `content`、`contact`、`adminNote`、账号快照、
      凭据或通知载荷；确认没有新增公共路由或数据库文件变更。

### 4.1 自动验证记录（2026-09-12）

- `node --check`：`server/db.js`、`server/app.js`、`server/validation.js`、
  `public/admin/admin.js` 及新增/修改测试脚本均通过。
- Work Hub/验证器聚焦测试：29 项通过；其中 Work Hub 数据/API/降级/静态测试 7 项，
  验证器测试 22 项。
- `npm test`：218/218 通过。
- `npm audit --omit=dev --registry=https://registry.npmjs.org`：`found 0 vulnerabilities`。
- `python ./.trellis/scripts/task.py validate .trellis/tasks/09-12-work-hub-overview`：通过。
- `git diff --check`：通过（仅有 Git 对 LF/CRLF 的提示，无 whitespace error）。
- 当前自动测试环境：Node `v24.19.0`、npm `12.0.2`、SQLite 临时数据库；云端 PostgreSQL/
  PM2/3088 与浏览器窄屏/主题冒烟尚未在本任务中执行。

## 5. 文档与发布证据

- [x] 更新 `docs/api/reference.md`、`docs/architecture/current.md` 或相应现有文档，
      记录 Work Hub endpoint、DTO、时间规则和降级行为，并把已实现/验证中区分开。
- [x] 在当前任务目录记录测试命令、Node/npm/数据库类型摘要和手工浏览器结果；当前已记录
      自动测试和 `Node v24.19.0`/`npm 12.0.2`，云端浏览器结果待发布后补充；不写入
      生产主机、Cookie、凭据、完整用户内容或外部响应。
- [ ] 发布前备份数据库并按现有 PM2/3088 部署手册执行；部署后检查 health、管理员登录、
      Work Hub、收件箱和项目详情。不要把端口重新假设为 3000。

## 6. 回滚点与停止条件

| 回滚点 | 触发条件 | 动作 |
|---|---|---|
| H0 API 前 | 聚合 SQL、DTO 或认证测试失败 | 不接入 tab；撤回新增 route/db 函数，保留失败测试证据 |
| H1 列表定位前 | `id` 过滤改变旧分页/筛选语义 | 只回滚可选过滤扩展，Work Hub 改为等待重新设计，不改旧接口行为 |
| H2 前端接入前 | 转义、键盘、主题或窄屏回归 | 移除 tab/module 接入，保留后端只读代码供修正 |
| H3 发布前 | 真实 health/登录/数据库或 PM2 异常 | 停止切换，按既有备份与上一版本回滚；不重置生产数据库 |

任何需要 schema 变更、公共数据扩展、KyanetAccount 联动、新框架或删除非工作区文件的
情况都暂停并重新取得用户批准。
