# P2 项目管理基础能力技术设计

## 1. 设计目标与边界

本设计在现有 Node.js 24 + Express + 原生静态前端 + SQLite/MySQL/PostgreSQL 路线上，增加
轻量项目容器、里程碑、Feedback/WorkTask 归属和分层公开视图。项目是组织层，不替换现有两类
来源表，也不新增统一 `work_items` 表。

本版本的几个硬边界：

- 只有单管理员权限模型；所有管理写接口继续使用现有管理员会话、同源和 JSON 中间件。
- 一个 Feedback/WorkTask 最多归属一个项目；未归类记录继续合法存在。
- 项目归档是软状态。归档项目可查看、编辑、解绑和整理已有关系，但新增里程碑/新增绑定前必须恢复。
- 里程碑撤销是软状态，撤销后不计入完成度并解除工作项里程碑关联，恢复不会自动重绑。
- 公开端只读取显式安全投影，公共 URL 使用随机 `publicKey`，不公开内部自增 ID 或来源内容。
- AI、通知、KyanetAccount 和现有反馈/WorkTask 原生流程不被项目功能驱动或自动写入。

## 2. 现有边界与新增模块

继续遵循当前目录结构，不引入 controller/service 框架：

| 层 | 现有文件 | 本次职责 |
|---|---|---|
| 数据访问 | `server/db.js` | 三驱动 schema、项目/里程碑/关联 CRUD、映射、完成度计算、孤儿清理 |
| 输入校验 | `server/validation.js` | 项目、里程碑、来源关系、列表和公开 key 的长度/枚举/类型校验 |
| HTTP 编排 | `server/app.js` | 管理/公共路由、会话与同源中间件、错误码、审计调用 |
| 审计 | `server/admin-audit-metadata.js`、`server/admin-audit.js` | 项目动作允许的脱敏元数据及写入 |
| 管理模型 | 新增 `public/admin/project-model.js`（或合并到现有模型时保持单一投影解码点） | 管理项目/里程碑/来源摘要的规范化与展示辅助 |
| 管理页面 | `public/admin/index.html`、`public/admin/admin.js` | 一级项目标签、列表、hash 详情、单条绑定操作 |
| 公共页面 | `public/index.html`、`public/index/main.js`、新增 `public/project/index.html`、`public/project/main.js` | 首页项目卡片和独立公开详情页 |
| 样式 | `public/workstation.css` | 直角控件、卡片、泳道、公开详情响应式样式 |

`server/app.js` 只编排请求，不拼接 SQL；所有行到对象的转换集中在 `db.js`，前端不从原始数据库
字段推断公开权限。

## 3. 数据模型

### 3.1 `project`

逻辑字段如下，三套 schema 使用各驱动现有主键/布尔类型约定：

| 字段 | 语义 |
|---|---|
| `id` | SQLite `INTEGER`、MySQL `BIGINT`、PostgreSQL `BIGSERIAL` 内部主键 |
| `public_key` | UUID 文本，唯一、创建时生成且永不修改 |
| `name` | 1–120 个 Unicode 字符，必填 |
| `description` | 最多 2000 个 Unicode 字符，空字符串表示无说明 |
| `status` | `active` 或 `archived` |
| `public_basic` | 是否公开名称/说明，默认 false |
| `public_milestones` | 是否公开有效里程碑，默认 false |
| `public_updated_at` | 是否公开更新时间，默认 false |
| `public_completion` | 是否公开完成度，默认 false |
| `completion_mode` | `auto` 或 `custom`，默认 `auto` |
| `custom_completion` | 可空的 0–100 整数；`auto` 模式保存为 NULL |
| `created_at` / `updated_at` | ISO 文本时间 |

索引：唯一 `public_key`，以及 `(status, updated_at)` 供管理列表和活跃项目读取。

### 3.2 `project_milestone`

| 字段 | 语义 |
|---|---|
| `id` | 内部自增主键 |
| `project_id` | `project(id)` 外键 |
| `title` | 1–160 个 Unicode 字符 |
| `description` | 最多 2000 个 Unicode 字符 |
| `target_date` | 可空 ISO 日历日期文本 `YYYY-MM-DD`，不携带时区或时间 |
| `is_completed` | 布尔完成标记，默认 false |
| `sort_order` | 0–100000 的整数，默认 0；同值以 `id` 稳定排序 |
| `status` | `active` 或 `revoked` |
| `created_at` / `updated_at` | ISO 文本时间 |

使用 `(project_id, status, sort_order, id)` 索引。产品不提供硬删除；底层外键对意外删除使用
`ON DELETE SET NULL` 保护关联。

### 3.3 `project_item`

| 字段 | 语义 |
|---|---|
| `id` | 内部自增主键 |
| `project_id` | `project(id)` 外键，项目硬删除时级联（产品无此入口） |
| `source_type` | 应用层 allow-list：`feedback` 或 `worktask` |
| `source_id` | 对应来源表的内部 ID；没有跨表外键 |
| `milestone_id` | 可空，同项目有效里程碑的 ID；底层删除置空 |
| `created_at` / `updated_at` | ISO 文本时间 |

唯一约束 `(source_type, source_id)` 保证单项目归属；索引 `(project_id, source_type)`、
`(project_id, milestone_id)` 供详情和完成度读取。多态来源存在性、单项目归属和里程碑同项目
关系由服务端校验。

### 3.4 完成度读取规则

只统计 `status='active'` 的里程碑。若 `completion_mode='custom'` 且值有效，返回该值；否则
计算 `round(completedActive / activeTotal * 100)`。`activeTotal=0` 时返回空值，前端显示“未设置”。
项目自定义值与里程碑/来源状态分离，修改其中一方不会写另一方。

## 4. 数据流与事务边界

### 4.1 管理项目详情读取

```text
浏览器 hash
  → GET /api/admin/project/:id
  → requireAdminSession
  → db.getProjectDetail(id)
      ├─ project 摘要与完成度
      ├─ milestones（active + revoked）
      ├─ project_item 关联
      ├─ 批量读取 feedback/worktask 安全管理摘要
      └─ 过滤/清理不存在来源和已撤销 milestone 关联
  → admin project-model 规范化
  → 两个来源泳道渲染
```

### 4.2 单条关联写入

`assign` 先验证项目状态、来源存在、唯一约束和里程碑归属，再创建关联；若来源已在其他项目，
返回 409，不隐式移动。`item/update` 只修改同一项目内的里程碑，`unassign` 要求当前项目 ID
匹配。成功后客户端重新请求详情，避免把本地乐观状态当作事实。

### 4.3 里程碑撤销

撤销操作先把里程碑标记为 `revoked`，再将 `project_item.milestone_id` 置空；两次写入均按
同一 ID 条件执行并可重复。现有 `db.js` facade 没有事务 helper，本版本不宣称跨驱动原子性。
第二步失败时记录日志和失败审计；详情读取把撤销项视为未关联，下一次维护请求执行幂等修复。

### 4.4 来源硬删除与孤儿

反馈/WorkTask 现有删除成功后调用按来源清理关联；若清理失败不回滚来源删除，而是在日志中记录。
项目详情查询批量确认来源存在，过滤不可见孤儿并执行受限清理。不会因为孤儿阻断现有来源删除或
管理员收件箱。

## 5. HTTP 契约

### 5.1 管理接口

管理读取接口仍受管理员会话保护；写接口还经过现有同源和 JSON 中间件。

| 方法/路径 | 请求要点 | 成功数据 |
|---|---|---|
| `POST /api/admin/project/list` | `status`、`keyword`、`page`、`pageSize` | 分页项目摘要 |
| `GET /api/admin/project/item` | `sourceType`、`sourceId` 查询参数 | 当前项目/里程碑或 null |
| `GET /api/admin/project/:id` | 路径为正整数 | `{project,milestones,items}` |
| `POST /api/admin/project/item-candidates` | 来源类型、关键词、分页、默认未归属 | 可绑定的安全来源摘要 |
| `POST /api/admin/project/create` | 名称、说明、公开开关、完成度配置 | 新项目摘要（含 `id/publicKey`） |
| `POST /api/admin/project/update` | `id` + 出现的可编辑字段 | 更新后的项目摘要 |
| `POST /api/admin/project/archive` / `restore` | `id` | 当前项目状态 |
| `POST /api/admin/project/milestone/create` | `projectId`、标题；其余可选 | 新里程碑 |
| `POST /api/admin/project/milestone/update` | `id` + 出现的字段 | 更新后的里程碑 |
| `POST /api/admin/project/milestone/revoke` / `restore` | `id` | 当前里程碑状态 |
| `POST /api/admin/project/item/assign` | `projectId`、来源类型/ID，可选 `milestoneId` | 关联摘要 |
| `POST /api/admin/project/item/update` | 项目、来源类型/ID、`milestoneId`（可空） | 关联摘要 |
| `POST /api/admin/project/item/unassign` | 项目、来源类型/ID | `{removed:true}` |

项目 `update` 是部分更新：至少提供一个允许字段；`completionMode=auto` 清除自定义值，
`custom` 必须是 0–100 整数。归档项目的元数据和已有关系可整理；`milestone/create` 与
`item/assign` 在归档项目上返回 `409 PROJECT_STATE_CONFLICT`，恢复后重试。

统一错误：

```json
{ "ok": false, "error": { "code": "PROJECT_ITEM_CONFLICT", "message": "该来源已归属其他项目" } }
```

- `400 INVALID_PAYLOAD`：类型、长度、枚举、`YYYY-MM-DD` 日期、ID 或跨字段组合错误。
- `404 NOT_FOUND`：管理员资源不存在；公共未公开、归档和不存在也统一使用此结果。
- `409 PROJECT_ITEM_CONFLICT`：来源已属于其他项目或解绑项目不匹配。
- `409 PROJECT_MILESTONE_CONFLICT`：里程碑不存在、跨项目、已撤销或关联不合法。
- `409 PROJECT_STATE_CONFLICT`：归档项目尝试新增里程碑/绑定。
- 未预期数据库错误沿用现有 `INTERNAL_ERROR`，不把 SQL/堆栈返回客户端。

### 5.2 管理投影

`project` 摘要字段：`id`、`publicKey`、`name`、`description`、`status`、四个公开开关、
`completionMode`、`customCompletion`（仅管理端）、`completion` 管理统计、来源数量、里程碑
数量、`createdAt`、`updatedAt`。

来源摘要只允许：`sourceType`、`sourceId`、`title`、`type`、`status`、WorkTask 的
`priority/assignee/scheduledAt/expectedAt`、`updatedAt`、`milestoneId`。禁止 `content`、
`contact`、`images`、`adminNote`、账号快照和 provider 字段。

### 5.3 公共投影

`GET /api/public/projects` 返回固定上限的 `{items:[{publicKey,name,description}]}`，只查询
`status='active' AND public_basic=true`，按 `updated_at DESC, id DESC` 排序。

`GET /api/public/projects/:publicKey` 先以 key 查询活跃且基础公开项目；未命中统一 404。基础
字段总是返回；仅在相应开关开启时加入：

- `milestones`：有效里程碑的标题、说明、目标日期和完成标记，按排序返回；
- `updatedAt`：项目更新时间；
- `completion:{value}`：有效的自动或自定义 0–100 整数；自动模式无有效里程碑时省略。

公共投影不返回项目内部 `id`、来源关联、来源状态、工作项内容、联系方式或管理员字段。关闭
开关时省略字段而不是返回 `null`，让客户端无法误把关闭解释成空数据。

## 6. 权限、审计和隐私

- 公共 GET 不需要认证，但只走公共查询函数；不复用返回完整管理员行的查询。
- 管理项目所有 GET/POST 都要求现有会话；写入沿用 `requireSameOriginForAdminMutation` 和
  `requireJsonForAdminMutation`，不接受表单或跨域 JSON。
- 新增审计动作：`project.create/update/archive/restore`、`project.milestone.create/update/revoke/restore`、
  `project.item.assign/update/unassign`。实体类型使用 `project`、`project_milestone`、`project_item`。
- 审计 metadata 只记录内部 ID、来源类型/ID、变更字段、状态、数量、公开开关和结果；不记录项目名、
  说明、里程碑正文、来源正文、URL、密钥或完整请求体。`admin-audit-metadata.js` 增加对应 allow-list。
- `publicKey` 由 Node `crypto.randomUUID()` 生成并只读；管理端可显示，公共 URL 只带 key，不带内部 ID。

## 7. 页面交互设计

### 7.1 管理员页面

在现有 tabs 中增加 `项目` 和 `moduleProjects`。状态最小化为：当前筛选、分页、列表、当前 hash
项目详情、加载/错误状态和候选来源缓存。hash 使用 `#projects`、`#projects/<id>`；页面加载/浏览器
`popstate` 时重新读取对应数据。

Express 路由注册时先声明 `/api/admin/project/item` 等静态子路径，再声明
`/api/admin/project/:id` 动态详情路径，避免把 `item` 误解析为项目 ID。

详情交互：

1. 先保存项目元数据/公开设置；归档按钮要求确认，恢复立即可用。
2. 里程碑表格显示 active/revoked、目标日期、完成标记和排序；编辑、完成、撤销/恢复均为单条操作。
3. 两个来源泳道各有“添加已有工作项”入口，候选列表按来源和关键词分页；绑定时可选有效里程碑。
4. 已归属其他项目的候选项显示禁用状态和“先解绑”提示；不提供隐式移动。
5. 所有写入完成后重新 `GET` 详情；失败保留表单内容，409 显示可执行说明。

来源详情在展开时请求当前归属；已有来源操作区增加“项目/里程碑”摘要和跳转项目详情的链接，
可执行解绑或从候选项目中绑定，不复制来源完整内容。

### 7.2 公共首页与详情页

首页 `loadHomeShowcase` 并行读取项目列表；空列表隐藏整个区块。卡片只渲染转义后的名称、说明和
`/project/?key=<encoded publicKey>` 链接。

`public/project/index.html` 复用 `theme.js`、`workstation.css` 和公共配置；`main.js` 读取 key，
请求详情并按字段是否存在渲染基础信息、里程碑、更新时间、完成度。404 显示统一“项目暂不可用”状态，
其他网络错误显示可重试提示。所有文本使用 `textContent` 或安全转义，目标日期和更新时间使用公共
时区格式化器。

## 8. 迁移、发布与回滚

- 在 `sqliteSchemaStatements`、`mysqlSchemaStatements`、`postgresSchemaStatements` 中加入三表和
  索引；`initializeDatabase()` 仍先建基础 schema，再执行幂等项目 schema 检查。
- 这是纯增量建表，不修改 Feedback/WorkTask 字段，不需要历史数据回填。若后续版本新增列，按
  `ensure*` + 默认值方式兼容旧库，不引入通用 migration runner。
- 发布前备份并验证备份；部署后首次启动让初始化建表，然后执行管理员登录、项目 CRUD、公共列表/详情、
  归档 404 和现有 health/提交冒烟。
- 旧版本回滚只会忽略新表；不执行 `DROP TABLE`。数据库恢复只在备份校验和发布门禁确认后进行。
- MySQL/PostgreSQL 实例暂不在本地测试矩阵中运行时，至少执行静态 schema 等价检查，并在目标环境按
  运维手册补一次初始化/CRUD 冒烟。

## 9. 测试设计

### 单元与数据层

- `tests/validation.test.js`：项目/里程碑/关系列表 payload 的 Unicode 长度、空值、枚举、日期、
  自定义完成度、归档新增限制输入。
- 新增项目数据库测试：三表初始化、三驱动 schema/index 静态声明、项目 CRUD、public key 唯一、
  来源唯一归属、里程碑同项目校验、自动/自定义完成度、撤销清关联、孤儿过滤/清理、旧库增量启动。
- 映射测试断言管理来源摘要和公共投影字段集合，禁止敏感字段穿透。

### HTTP 与安全

- 新增项目 API 测试使用临时 SQLite、随机端口和管理员会话，覆盖登录、项目/里程碑/绑定全流程、
  未登录 401、同源/JSON 防护、400/404/409 错误 envelope、公共 404 和字段缺失。
- 现有 `tests/security.test.js`、提交/通知/AI 测试继续执行，确认新路由没有改变全局中间件顺序。

### 前端与发布冒烟

- 管理模型测试覆盖排序、hash 状态、来源分泳道、开关字段缺省和冲突后重读；静态 HTML 测试覆盖
  所有新增按钮类型、项目标签、公共页面和脚本端点。
- 浏览器冒烟覆盖登录、项目列表/详情、亮暗主题、窄屏、键盘焦点、公开首页卡片、公开详情开关、
  不存在项目错误页。
- 发布前运行 `node --check`、`npm test`、`npm audit --omit=dev`、`git diff --check` 和 Trellis check。

## 10. 风险与后续

- 关联表是多态关系，来源硬删除和撤销的双写无法在现有 facade 中完全原子；通过幂等修复、审计和
  详情读取清理降低风险，后续若出现并发写入问题再单独设计事务边界。
- 单管理员模型不支持成员级权限；若未来 Account 重构或团队规模扩大，必须另立权限设计，不能在本任务
  中把项目写接口直接绑定未来账号。
- 子任务、依赖、批量归属、逐里程碑公开和自动 AI 项目操作保持延期，避免首版扩大数据关系和副作用边界。
