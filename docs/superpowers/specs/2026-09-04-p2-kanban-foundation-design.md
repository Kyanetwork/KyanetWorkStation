# P2 Kanban 基础能力设计

## 1. 目标与边界

本任务在已实现的项目容器之上增加管理员 Kanban 视图。Kanban 只负责按状态查看和调整已经归属项目的 Feedback/WorkTask；项目关系、里程碑和公开投影继续由现有关系视图及公共 API 负责。

已确认的产品边界：

- Feedback 与 WorkTask 保持两条独立泳道，不做跨来源状态映射。
- Feedback 列为 `new`、`reviewed`、`resolved`、`notplanned`；WorkTask 列为 `new`、`scheduled`、`in_progress`、`completed`、`cancelled`。
- 列内按现有 `updatedAt DESC, id DESC` 排序，不新增手动排序字段，不提供拖拽排序。
- 卡片使用状态下拉框和明确的保存按钮，不依赖拖拽；首版仅管理员可见。
- Kanban 与现有关系视图并存，关系视图默认显示并继续负责绑定、解绑和里程碑操作。
- Kanban 状态实际发生变化时更新项目 `updatedAt`；不改变里程碑完成度计算，也不扩展现有普通状态接口的更新时间行为。
- 不建设子任务、依赖、批量跨项目操作、实时协作、甘特图、用户侧/公共 Kanban 或新的前端运行时。

## 2. 现状与复用点

项目详情接口 `GET /api/admin/project/:id` 已返回管理员安全 DTO：项目摘要、里程碑和按 Feedback/WorkTask 摘要展开的 `items`。来源摘要只包含标题、类型、状态、更新时间，以及 WorkTask 的优先级、负责人和安排时间等必要字段，不包含正文、联系方式、管理员备注、Account 快照或 Provider 信息。

现有状态更新接口和校验分别处理两类来源：

- `POST /api/admin/feedback/status` + `validateStatusPayload`；
- `POST /api/admin/worktask/status` + `validateWorktaskStatusPayload`。

它们已经提供来源状态枚举、管理员会话保护和 `feedback.status`/`worktask.status` 审计。项目详情当前有两条关系泳道，可直接扩展为“关系视图 / Kanban”切换，而不替换原有绑定和里程碑控件。

## 3. 后端 API 与数据流

### 3.1 项目范围状态接口

新增：`POST /api/admin/project/item/status`

请求体：

```json
{
  "projectId": 1,
  "sourceType": "feedback",
  "sourceId": 12,
  "status": "reviewed"
}
```

请求处理顺序：

1. 通过现有 `/api/admin` 管理员会话、同源、JSON Content-Type 和限流中间件。
2. 新增组合校验：正整数 `projectId/sourceId`、`feedback/worktask` 来源类型，以及与来源类型匹配的状态集合。
3. 数据层确认项目存在且为 `active`，并通过 `project_item` 唯一来源关系确认来源属于该项目；关系不存在返回 404，属于其他项目返回 409。
4. 确认原始来源仍存在。来源删除与项目孤儿清理沿用既有逻辑。
5. 只更新对应来源表的状态。状态值不写入 `project_item`，里程碑关联保持不变。
6. 当新状态与当前状态不同时，更新项目 `updated_at`；同值保存视为成功但不重复更新时间。
7. 返回更新后的项目/来源标识、来源类型、新状态和项目更新时间；前端随后重新读取现有项目详情 DTO，不把该响应作为长期缓存。
8. 写入 `project.item.status` 审计，实体为 `project_item`；成功和失败都只记录白名单元数据。

成功响应示例：

```json
{
  "ok": true,
  "data": {
    "projectId": 1,
    "sourceType": "feedback",
    "sourceId": 12,
    "status": "reviewed",
    "projectUpdatedAt": "2030-01-02T03:04:05.000Z"
  }
}
```

错误语义：

| 条件 | HTTP / code |
|---|---|
| 参数、来源类型或状态不合法 | 400 / `INVALID_PAYLOAD` |
| 项目、来源或项目关系不存在 | 404 / `NOT_FOUND` |
| 项目已归档 | 409 / `PROJECT_STATE_CONFLICT` |
| 来源属于其他项目或请求项目不匹配 | 409 / `PROJECT_ITEM_CONFLICT` |

现有普通 Feedback/WorkTask 状态接口保持兼容；Kanban 不通过模拟 HTTP 请求调用它们，而是在 `db.js` 复用其底层状态更新函数，并增加项目关系边界。

### 3.2 数据层边界

在 `server/db.js` 增加项目范围状态更新 helper，输入为 `projectId/sourceType/sourceId/status`：

- 复用 `getProjectById`、`getProjectItemBySource`、`getFeedbackById`/`getWorktaskById` 和现有来源状态更新函数；
- 归档项目在数据层拒绝写入，避免只依赖 UI 禁用；
- 成功改变来源状态后执行项目 `updated_at` 更新；
- 同值保存通过读取当前状态识别，不依赖 MySQL 的 affected-row 语义；
- 返回稳定的安全结果，避免把原始来源整行向上层泄露。

本任务不改 `project`、`project_milestone`、`project_item` 或来源表 schema，不新增 migration runner。现有单实例低并发架构没有统一跨驱动事务抽象，因此 helper 按“关系校验 → 来源更新 → 项目时间更新”的既有数据访问模式执行；若未来需要多实例强事务，再单独设计事务边界，不在本任务引入新的数据库基础设施。

项目 `updatedAt` 的更新时间只由本接口在状态实际变化时触发；关系绑定、解绑和现有普通状态接口的时间语义不在本任务扩大修改。

### 3.3 审计

成功与失败均调用现有 `recordAdminAction`：

- action：`project.item.status`；
- entityType：`project_item`；
- entityId：可解析的项目关系 ID，关系不存在时为 `null`；
- metadata：`projectId`、`sourceType`、`sourceId`、`status` 和必要的稳定错误码。

不记录正文、联系方式、管理员备注、前后全文、Cookie、Token 或内部 URL。现有审计过滤器已经允许 `project_item`，元数据规则已有项目/来源/状态字段，可沿用脱敏策略。

## 4. 管理员前端设计

### 4.1 视图状态

在 `public/admin/admin.js` 的项目详情状态中加入短生命周期的 `projectView`，取值为 `relations` 或 `kanban`，默认 `relations`。视图按钮使用可聚焦的 button、`aria-pressed` 和明确标签。`loadProjectDetail` 重新渲染时保留当前视图，切换项目或退出登录时恢复默认值。

### 4.2 Kanban 结构

`public/admin/project-model.js` 增加稳定的来源状态列定义和分组函数：

```text
Feedback  → new / reviewed / resolved / notplanned
WorkTask  → new / scheduled / in_progress / completed / cancelled
```

`renderProjectKanban` 根据现有 `detail.items` 先按来源分泳道，再按原生状态分列；每列显示标题、数量、空列提示和卡片列表。卡片使用模型归一化后的安全字段：

- 两类共有：来源类型、标题、状态、更新时间；
- WorkTask：优先级、负责人、计划/期望时间（有值才显示）。

卡片不显示来源正文、联系方式、管理员备注、Account 快照或数据库内部 ID。未知状态不应由正常 API 产生；模型测试仍保留安全 fallback，避免异常数据导致整个看板消失。

### 4.3 状态保存

每张卡片包含预选当前状态的下拉框和“保存状态”按钮。保存时：

1. 读取卡片上的来源类型、来源 ID、当前项目 ID 和选择值；
2. 调用 `/api/admin/project/item/status`；
3. 按按钮 busy 状态防止重复提交；
4. 成功后重新读取项目详情，保留 Kanban 视图并显示成功消息；
5. 失败时不触发成功刷新，保留用户当前选择并显示服务端错误消息。

归档项目的状态控件和保存按钮禁用；服务端仍执行最终拒绝。状态更新不会自动触发 AI、通知、里程碑完成或公开投影写入。

### 4.4 视觉与可访问性

新增样式沿用 `public/workstation.css` 的冷色变量、直角边框、亮暗主题和现有间距。桌面端每个泳道使用列网格；窄屏端改为纵向堆叠或可读的横向滚动容器，不以裁剪代替响应式布局。所有控件保留可见焦点、键盘顺序、文本标签和状态提示，不使用仅颜色表达状态，也不依赖拖拽。

## 5. 公共与集成边界

- `/api/public/projects`、`/api/public/projects/:publicKey` 和公共项目页不增加 Kanban 或工作项返回字段。
- 不改变项目基础信息、里程碑、更新时间和完成度的现有独立公开开关；Kanban 仅存在于管理员项目详情。
- 不改变 AI Copilot/知识助手的出站字段、建议决策或指标记录。
- 不改变 SMTP/Webhook outbox、MeowStatus、KyanetAccount 暂停边界或 PM2 部署方式。

## 6. 兼容、回滚与运行风险

- 旧项目、无工作项项目、已归档项目和含已撤销里程碑的项目都能读取；撤销里程碑的既有关联清理不变。
- 新接口为追加路由；回滚应用代码不会要求删除或降级数据库字段。
- 项目时间更新与来源状态更新使用现有单实例数据访问模式，测试覆盖顺序一致性和驱动幂等返回；多实例强事务列入后续基础设施评估。
- Kanban 只对已加载的项目关系发起写请求；服务端关系检查阻止过期页面把来源更新到错误项目。
- 依赖审计 D-006、KyanetAccount 重构、子任务/依赖和公共 Kanban 继续独立，不因本任务扩大。

## 7. 测试与验收

### 自动化

- `tests/project-db.test.js`：项目范围状态成功、项目时间更新、同值保存、跨项目关系、归档项目、来源不存在和里程碑关联保持；三驱动 schema 字符串保持不变。
- `tests/project-api.test.js`：匿名 401、非法 payload 400、跨项目/归档 409、关系/来源缺失 404、成功响应、项目更新时间和 `project.item.status` 脱敏审计。
- `tests/project-model.test.js`：两条泳道、原生状态列、更新时间排序、空列和未知状态 fallback。
- `tests/project-static-ui.test.js`：视图切换、Kanban 标记、状态保存入口、归档禁用、无公共 Kanban 文本泄露。
- 全量门禁：`npm test`、全部 JavaScript `node --check`、`git diff --check`、Trellis validate。

### 人工冒烟

1. 登录管理员并打开一个活跃项目，确认默认关系视图仍可绑定/解绑和调整里程碑。
2. 绑定至少一个 Feedback 和一个 WorkTask，切换 Kanban，确认两条泳道、原生状态列、数量和更新时间排序。
3. 分别在两条泳道保存一次合法状态，确认卡片进入目标列、项目更新时间变化、关系/里程碑不变且审计可查。
4. 打开归档项目，确认 Kanban 可读但状态控件禁用；直接请求接口确认返回 `PROJECT_STATE_CONFLICT`。
5. 使用错误项目 ID/错误状态请求，确认返回 400/409 且来源状态未被修改；公共项目页确认没有 Kanban 或工作项数据。
6. 在亮/暗主题、窄屏和键盘操作下检查文字、焦点、滚动和空列提示。

## 8. 发布顺序

生产发布继续遵循现有门禁：

```text
备份 → 同步代码 → npm ci --omit=dev → npm test → PM2 重启
→ /api/health → 管理员 Kanban 冒烟 → 发布证据记录
```

不修改生产 `.env`、数据库连接、反向代理或公共项目开关。若新接口或 UI 冒烟失败，保留备份并回滚应用代码；数据库无需回滚迁移。
