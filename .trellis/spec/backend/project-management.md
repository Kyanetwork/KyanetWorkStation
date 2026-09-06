# 项目管理数据与 API 规范

## 1. Scope / Trigger

本规范适用于 Workstation 项目管理首版：项目容器、轻量里程碑、Feedback/WorkTask
多态归属、管理员项目接口和公共项目投影。它触发于三驱动 schema、跨层 API 合同和
公开字段边界的变化。

项目是组织层，不替换 Feedback/WorkTask 原表，也不把两类来源合并为统一业务状态。
KyanetAccount、AI 自动写操作、成员权限和复杂 Kanban 关系不属于本规范。

## 2. Signatures

- `ensureProjectSchema() -> Promise<void>`：幂等创建 `project`、`project_milestone`、
  `project_item` 及索引。
- `createProject(input) -> Promise<number>`、`getProjectById(id) -> Promise<Project|null>`、
  `getProjectDetail(id) -> Promise<ProjectDetail|null>`。
- `createProjectMilestone(input)`、`updateProjectMilestone(input)`、
  `revokeProjectMilestone(id)`、`restoreProjectMilestone(id)`。
- `assignProjectItem(input)`、`updateProjectItemMilestone(input)`、
  `unassignProjectItem(input)`：一个来源最多保留一条归属。
- `GET /api/public/projects`、`GET /api/public/projects/:publicKey`：只返回公共 allow-list。
- `POST /api/admin/project/*`、`GET /api/admin/project/:id`：全部受管理员会话保护；写请求
  继续经过同源和 JSON 中间件。

## 3. Contracts

- `project` 保存不可变随机 `publicKey`、名称、说明、`active/archived` 状态、四个独立
  公开开关、`auto/custom` 完成度配置和时间戳。
- `project_milestone` 保存项目内标题、说明、可空目标日期、完成标记、排序和
  `active/revoked` 状态。撤销先标记再解除关联；恢复不自动重绑。撤销清理必须在每次
  请求执行，即使数据库驱动把重复状态更新报告为 0 行，以便重试此前失败的清理。
- `project_item` 使用 `(source_type, source_id)` 唯一约束，来源类型只允许 `feedback`/
  `worktask`，里程碑必须属于同一项目且有效。
- 完成度仅统计有效里程碑；无有效里程碑返回空值。自定义模式接受 0–100 整数，关闭
  自定义后恢复自动计算。
- 公共列表只返回 `publicKey`、名称和说明。公共详情以基础信息公开且项目未归档为前提，
  仅按开关返回 `milestones`、`updatedAt`、`completion`；不得返回内部 ID、来源、正文、
  联系方式、管理员字段、密钥或 URL。

## 4. Validation & Error Matrix

| 条件 | 结果 |
|---|---|
| 名称/标题为空或超过 Unicode 长度、ID/日期/布尔值/枚举非法 | 400 `INVALID_PAYLOAD` |
| 管理项目、里程碑或来源不存在 | 404 `NOT_FOUND` |
| 来源已有其他项目归属，或解绑时项目不匹配 | 409 `PROJECT_ITEM_CONFLICT` |
| 里程碑跨项目、已撤销或不存在 | 409 `PROJECT_MILESTONE_CONFLICT` |
| 归档项目新增里程碑或绑定来源 | 409 `PROJECT_STATE_CONFLICT` |
| 公共 key 无效、项目未公开、已归档或不存在 | 统一 404 `NOT_FOUND`，不泄露原因 |

## 5. Good / Base / Bad Cases

- Good：路由先调用 `validate*`，数据层使用参数化 SQL 和显式 row mapper；写入完成后由
  管理页面重新读取详情。
- Base：旧数据库启动时追加三张表和索引，旧代码忽略新表；SQLite/MySQL/PostgreSQL
  保持相同字段语义。
- Bad：用项目状态替换来源原生状态、隐式抢占其他项目的来源、按公共 key 查询后返回
  管理详情，或把 SQL/正文/联系方式放进审计和公共响应；用 `affectedRows` 判断重复撤销
  后跳过关联清理。

## 6. Tests Required

- SQLite 初始化两次后断言三表、索引和历史数据仍在；静态检查三驱动表名、唯一约束和索引。
- 数据层覆盖完成度、排序、撤销/恢复、单来源冲突、跨项目里程碑和来源删除清理。
- API 覆盖匿名 401、输入 400、资源 404、归属/状态 409、同源/JSON 中间件和公共字段缺失。
- 管理模型/静态页面覆盖缺省值、hash、两个来源泳道、按钮 `type`、转义、亮暗主题和窄屏。
- 发布前执行 `node --check`、`npm test`、`git diff --check` 和真实部署目标的管理员/公共冒烟；
  不将本地自动测试描述为云端证据。

## 7. Wrong vs Correct

### Wrong

```js
// 将公共请求转给管理员详情，会泄露内部 ID 和来源摘要。
app.get("/api/public/projects/:key", async (req, res) => {
  res.json({ ok: true, data: await getProjectDetailByPublicKey(req.params.key) });
});
```

### Correct

```js
const key = validatePublicProjectKey(req.params.publicKey);
if (!key.valid) return sendError(res, 404, "NOT_FOUND", "项目暂不可用");
const data = await getPublicProjectByKey(key.value);
if (!data) return sendError(res, 404, "NOT_FOUND", "项目暂不可用");
return res.json({ ok: true, data });
```

## 8. 项目范围 Kanban 状态更新

### 8.1 Scope / Trigger

该契约适用于管理员项目详情的 Kanban 基础视图：它允许在一个已绑定项目项的
范围内调整来源原生状态，但不把 Feedback 与 WorkTask 合并成新的业务状态，
也不改变公共投影或关系/里程碑模型。

### 8.2 Signatures

- `validateProjectItemStatusPayload(payload) -> { valid, data?, message? }`
- `updateProjectItemStatus({ projectId, sourceType, sourceId, status }) -> Promise<{ projectItemId, projectId, sourceType, sourceId, status, projectUpdatedAt }>`
- `POST /api/admin/project/item/status`：管理员会话 + 同源 + JSON + 管理员限流

### 8.3 Contracts

- 请求字段：`projectId`、`sourceId` 必须为正整数；`sourceType` 只能为
  `feedback` 或 `worktask`。
- Feedback 状态只允许 `new`、`reviewed`、`resolved`、`notplanned`；WorkTask
  状态只允许 `new`、`scheduled`、`in_progress`、`completed`、`cancelled`。
- 数据层必须确认项目存在且为 `active`、来源关系当前属于该项目、来源记录仍存在，
  然后复用 `updateFeedbackStatus` 或 `updateWorktaskStatus`。
- 只有来源状态实际变化时才更新来源 `updated_at` 后触碰项目 `updated_at`；同值保存
  返回成功且项目时间保持原值。`project_item` 的项目和里程碑关联不变。
- 成功响应只返回项目/来源标识、保存后的状态和 `projectUpdatedAt`；不返回正文、联系方式、
  管理员字段、账号快照或关系内部 ID。成功和失败都写入 `project.item.status` 脱敏审计。

### 8.4 Validation & Error Matrix

| 条件 | 结果 |
|---|---|
| 未登录、同源失败或非 JSON 管理写请求 | 现有 401/403/415 envelope；不进入业务写入 |
| ID、来源类型或来源专属状态非法 | 400 `INVALID_PAYLOAD` |
| 项目、关系或来源记录不存在 | 404 `NOT_FOUND` |
| 关系属于其他项目 | 409 `PROJECT_ITEM_CONFLICT` |
| 项目已归档 | 409 `PROJECT_STATE_CONFLICT`，提示“归档项目不能更新工作项状态” |

### 8.5 Good / Base / Bad Cases

- Good：路由先校验来源专属状态，数据层再次检查项目和关系归属，状态改变后更新项目时间并重读安全详情。
- Base：无工作项项目和归档项目仍可读取管理员详情；归档 Kanban 只读，公共接口不增加工作项字段。
- Bad：用统一 Kanban 状态覆盖来源原值、跳过 `project_item` 归属检查，或把正文/联系方式/密钥写进响应或审计。

### 8.6 Tests Required

- Validator：合法 Feedback/WorkTask payload、跨来源状态、非法来源类型和 ID。
- DB：两类来源状态更新、项目时间变化、同值不变、里程碑保留、跨项目/归档/未绑定/来源缺失错误。
- API：匿名 401、共享错误码、成功响应字段 allow-list、审计动作和 metadata 脱敏。
- Admin UI/model：两条独立原生状态泳道、固定空列和排序、归档控件禁用、保存后详情重读和公共页面无 Kanban。

### 8.7 Wrong vs Correct

#### Wrong

```js
// 直接更新来源，无法确认它仍属于当前项目，也不会同步项目更新时间。
await updateFeedbackStatus(sourceId, status);
```

#### Correct

```js
const result = await updateProjectItemStatus({ projectId, sourceType, sourceId, status });
// helper 先做项目/关系/来源检查，并在实际变化时同步 project.updated_at。
```
