# Work Hub 总览增强设计

## 1. 设计范围

本任务只增加管理员侧的只读“Work Hub”总览。数据仍由 `server/db.js` 访问，
Express 只负责会话边界和响应封装，管理员静态页继续使用原生 HTML/CSS/JavaScript。
不新增表、索引、缓存、定时任务或外部服务，不改变 Feedback/WorkTask 状态机和项目
公开数据。

实现目标是把“关注什么”与“如何处理”分开：Work Hub 只提供摘要和入口，完整字段、
状态更新、备注、通知和项目关系操作继续由现有收件箱/专项管理/项目详情负责。

## 2. 数据读取边界

### 2.1 数据库函数

在 `server/db.js` 增加一个命名函数（建议 `getWorkHubOverview`），由它生成一次
`generatedAt`，计算 7 天窗口，并执行只读查询。查询只选择以下来源字段和项目上下文：

| 来源 | 允许字段 |
|---|---|
| Feedback | `id`、`type`、`title`、`status`、`updated_at` |
| WorkTask | `id`、`type`、`title`、`priority`、`status`、`assignee`、`scheduled_at`、`updated_at` |
| 关系/项目 | `project_item.project_id`、`project.name` |

每个查询都通过 `placeholder()` 绑定时间、状态和数量参数，并在映射函数中转换为
camelCase。不得调用 `mapFeedbackRow` 或 `mapWorktaskRow`，也不得选择正文、联系方式、
管理员备注、图片、Account 快照或通知字段。

### 2.2 分区查询与排序

Feedback 只参与“最近更新”；WorkTask 参与四个分区。对每个来源使用硬编码的安全
SQL 片段和 `LIMIT 10`，再在服务端按统一比较器合并同一分区。建议条件如下（时间均为
同一次请求生成的 ISO 字符串）：

- `overdue`：有效 `scheduled_at < generatedAt`，且 `status NOT IN ('completed','cancelled')`。
- `upcoming`：有效 `scheduled_at >= generatedAt AND scheduled_at < windowEnd`，且非终止状态。
- `unassigned`：`assignee IS NULL OR TRIM(assignee) = ''`，且非终止状态。
- `recent`：有效 `updated_at >= windowStart AND updated_at <= generatedAt`，Feedback 与
  WorkTask 均可进入。

数据库结果按对应时间字段倒序、`source_type`、`id` 稳定排序。映射层再次验证日期可被
`Date.parse` 解析；无效/缺失时间直接排除，不降级为“现在”，因此不会产生虚假的逾期或
近期记录。历史数据若含异常字符串，允许该分区少于 10 条。

项目通过 `LEFT JOIN project_item` 与 `LEFT JOIN project` 一次读取；没有关系或关系
指向不存在项目时返回 `project: null`，前端显示“未归属”。不对每条摘要追加项目请求。

### 2.3 来源隔离与错误结果

`getWorkHubOverview` 分别调用 Feedback 与 WorkTask 的读取单元，并使用
`Promise.allSettled` 汇总。单元失败时只记录有限的结构化 warning（来源和稳定错误码，
不写 SQL/正文），不把数据库错误传给浏览器。

响应中的 `sources` 和 `sections` 使用固定形状；`sources.*.status` 取 `ok` 或 `error`，
分区 `status` 取 `ok`、`partial` 或 `error`（`partial` 只适用于同时依赖两类来源的
`recent`）：

```json
{
  "generatedAt": "2026-09-12T20:00:00.000Z",
  "windowDays": 7,
  "limit": 10,
  "sources": {
    "feedback": { "status": "ok" },
    "worktask": { "status": "ok" }
  },
  "sections": {
    "overdue": { "status": "ok", "items": [] },
    "upcoming": { "status": "ok", "items": [] },
    "unassigned": { "status": "ok", "items": [] },
    "recent": { "status": "ok", "items": [] }
  }
}
```

失败时对应分区仍返回 `items: []` 和稳定的 `errorCode`（例如
`WORK_HUB_SOURCE_UNAVAILABLE`），不含异常消息。全来源失败仍返回 200 的安全数据包，
由页面显示整页重试；未预期的路由/认证错误继续走现有 `sendError`。

单条摘要对象固定为：

```json
{
  "sourceType": "worktask",
  "sourceId": 7,
  "title": "示例任务",
  "type": "任务安排",
  "status": "scheduled",
  "priority": "high",
  "assignee": "",
  "scheduledAt": "2026-09-14T08:00:00.000Z",
  "updatedAt": "2026-09-12T12:00:00.000Z",
  "project": { "id": 1, "name": "Kyanetwork Projects" }
}
```

不适用的字段可省略；`project` 为空时前端显示“未归属”。标题、类型、状态和项目名
均经过现有长度规范化。

## 3. HTTP 接口

新增 `GET /api/admin/work-hub/overview`，置于管理员会话中间件之后，调用
`getWorkHubOverview()` 并返回 `{ ok: true, data }`。该接口无可调查询参数，窗口和上限
由服务端固定，避免客户端绕过边界。接口不写审计、不改变旧列表接口响应，也不增加公共
路由。请求异常按现有错误中间件处理，来源级读取错误在数据包内表达。

为保证摘要能准确定位到已有详情，给现有 Feedback/WorkTask 列表请求增加可选的正整数
`id` 过滤（保持响应形状不变）。Work Hub 点击来源按钮时切换到对应专项管理标签，
以 `id` 过滤加载完整现有条目，继续复用原有渲染、编辑和状态操作；用户重新搜索时
清除该临时定位。项目按钮写入现有 `#projects/<id>` hash 并调用原有项目详情加载。
这是对既有列表读取的窄扩展，不创建第二套详情或写入逻辑。

## 4. 管理员前端

### 4.1 结构和状态

在 `public/admin/index.html` 的现有 tabs 中增加 `tabWorkHub` 与 `moduleWorkHub`，
放在“工作收件箱”之前；收件箱仍是登录后的默认模块。Work Hub 模块包含规则说明、
刷新按钮、四个语义化分区，每个分区有标题、数量、列表容器和 `aria-live` 状态节点。

在 `admin.js` 的 page-local `state` 增加：

```text
workHub: {
  loaded: false,
  loading: false,
  requestId: 0,
  data: null
}
```

`switchModule("workHub")` 首次进入时调用 `loadWorkHub()`；刷新当前板块只重置该
模块状态并重新请求。登出时清理该状态，不写入 localStorage，不创建定时刷新。

### 4.2 渲染和跳转

新增纯渲染函数负责规则、分区和摘要卡片。所有 API 字段进入 `innerHTML` 前经
`escapeHtml`，按钮统一 `type="button"`，不可信标题不作为 HTML 链接。每条卡片显示
来源、标题、原生状态、适用元数据、项目名/“未归属”和时间，并提供：

- “查看条目”：调用窄扩展的 `id` 列表过滤，进入 Feedback 或 WorkTask 管理页并复用
  既有详情操作。
- “查看项目”：仅当有项目 ID 时出现，进入现有项目 hash 详情。

加载中显示短状态；空数据显示“当前没有符合条件的记录”；`error`/`partial` 显示
“该分区暂时无法加载”和“重试 Work Hub”按钮。单来源失败不会清空另一来源仍可用的
最近更新分区；所有来源失败才显示整页重试提示。页面不显示后端错误原文。

## 5. 兼容性、性能与回滚

- 不改 schema，因此 SQLite、MySQL、PostgreSQL 只需验证参数占位符、`TRIM`、`LEFT JOIN`
  和 ISO 文本时间比较在现有驱动封装下均可执行。
- 每个来源/分区最多读取有限行，响应最多 40 条摘要；没有全表载入、N+1 项目请求或
  浏览器缓存。
- 旧管理员列表请求未传 `id` 时保持完全原语义；非法 `id` 返回现有 400 envelope。
- 若聚合查询或前端模块出现回归，可先移除 Work Hub tab/route 与新增读取函数；旧收件箱、
  专项管理、项目详情和数据库数据不受影响。
- 发布前只需代码切换和进程重启，不需要迁移；部署后验证登录、Work Hub、旧收件箱、
  项目详情和 health。

## 6. 测试设计

1. **纯函数/模型**：时间边界、无效日期、终止状态、未分配空白、稳定排序、项目缺失
   和 DTO 禁止字段。
2. **数据库/API**：临时 SQLite 创建两类来源和项目关系，验证四个分区、10 条上限、
   未归属项、`id` 定位过滤、管理员认证和 `{ ok, data }` 形状；静态检查 SQL 使用
   参数化且不选择敏感列。
3. **降级**：通过可替换读取单元或测试 stub 模拟单来源失败与全部失败，断言安全错误码、
   其他分区仍有数据、无 SQL/正文泄露。
4. **前端静态**：标签/模块 ID、按钮 type、escapeHtml、状态节点、跳转动作、亮暗主题
   和窄屏样式断言。
5. **回归/浏览器**：`node --check`、相关 `node:test`、`npm test`、`git diff --check`；
   手工登录后检查加载/空/部分失败/全失败、摘要跳转、键盘焦点、亮暗主题和约 620px
   宽度无水平溢出。
