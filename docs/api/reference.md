# API 参考

本文档描述当前代码中的 HTTP 路由。旧 KyanetAccount 联动已移除；当前已实现的项目 Kanban 基础接口也在本文件中记录。

## 通用约定

- 成功响应通常为 `{ "ok": true, "data": ... }`。
- 错误响应为 `{ "ok": false, "error": { "code": "...", "message": "..." } }`。
- 管理写接口要求 JSON，并默认要求同源 `Origin`/`Referer`；`ADMIN_ALLOW_HEADERLESS_MUTATION=true` 只用于受控调试。
- 管理接口需要管理员会话 Cookie；公共提交接口受提交限流和输入校验约束。
- 管理列表请求使用 `page`/`pageSize`，服务端将 `pageSize` 限制在 100 以内。
- 管理员导出和审计查询使用 POST JSON；导出成功响应是 CSV 流，不使用 JSON 成功 envelope。

## 公共接口

| 方法与路径 | 用途 | 认证 |
|---|---|---|
| `GET /api/health` | 健康检查；可选返回计数 | 无 |
| `GET /api/public/config` | 返回展示时区、语言和 MeowStatus 刷新间隔 | 无 |
| `GET /api/public/highlights` | 返回主页公开进展 | 无；只应返回公开投影 |
| `GET /api/public/meowstatus` | 返回状态设置、个人状态和 Minecraft widgets | 无；`state` 为 `disabled`、`unavailable` 或 `ok`，不阻塞核心提交 |
| `POST /api/feedback` | 提交反馈 | 无；受限流和输入校验保护 |
| `POST /api/worktask` | 提交 WorkTask | 无；受限流和输入校验保护 |

反馈请求字段：`type`（`Bug`、`功能建议`、`体验问题`、`其他`）、`title`（1-80）、`content`（1-2000）、`contact`（1-100）、`images`（最多 8 项，每项最多 500 字符）。

WorkTask 请求字段：`type`（`WorkTask提交`、`工单提交`、`任务安排`、`协作请求`、`其他`）、`title`（1-100）、`content`（1-3000）、`contact`（1-100）、`priority`（`low`、`medium`、`high`、`urgent`）、可选 `expectedAt` 和 `tags`。

## 管理员认证与设置

| 方法与路径 | 用途 |
|---|---|
| `POST /api/admin/login` | JSON 用户名/密码登录并设置 HttpOnly 会话 Cookie |
| `GET /api/admin/me` | 检查管理员会话 |
| `POST /api/admin/logout` | 注销管理员会话 |
| `GET /api/admin/status/settings` | 读取 MeowStatus 设置 |
| `POST /api/admin/status/profile` | 更新个人状态 API 地址、超时和启用状态 |
| `POST /api/admin/status/minecraft` | 更新 Minecraft 状态展示开关 |
| `POST /api/admin/notify/smtp-test` | 发送 SMTP 测试邮件 |
| `POST /api/admin/notify/webhook-test` | 发送 Webhook 测试消息 |

### 管理员项目管理

项目是 Feedback 与 WorkTask 的组织层；两类来源仍使用各自原生表、状态和处理接口，单条来源最多
归属一个项目。项目、里程碑和来源关系接口均要求管理员会话，写接口还要求 JSON 与同源请求。

| 方法与路径 | 用途 |
|---|---|
| `POST /api/admin/project/list` | 分页查询项目；`status` 支持 `all`、`active`、`archived`，可按关键词筛选 |
| `GET /api/admin/project/:id` | 读取项目详情、全部里程碑和按 Feedback/WorkTask 分开的安全来源摘要 |
| `GET /api/admin/project/item?sourceType=...&sourceId=...` | 查询单条来源当前项目归属 |
| `POST /api/admin/project/item-candidates` | 按来源类型和关键词分页查询可绑定候选项 |
| `POST /api/admin/project/create` | 创建项目 |
| `POST /api/admin/project/update` | 部分更新项目名称、说明、公开开关和自动/自定义完成度 |
| `POST /api/admin/project/archive` / `restore` | 软归档或恢复项目；关系和来源记录保留 |
| `POST /api/admin/project/milestone/create` | 为活跃项目新增里程碑 |
| `POST /api/admin/project/milestone/update` | 更新里程碑标题、说明、目标日期、完成标记和排序 |
| `POST /api/admin/project/milestone/revoke` / `restore` | 软撤销或恢复里程碑；撤销会解除关联且不自动重绑 |
| `POST /api/admin/project/item/assign` | 将 Feedback/WorkTask 绑定到活跃项目，可选同项目有效里程碑 |
| `POST /api/admin/project/item/update` | 调整同项目内的里程碑关联 |
| `POST /api/admin/project/item/status` | 在项目范围内更新已绑定 Feedback/WorkTask 的原生状态；供管理员 Kanban 使用 |
| `POST /api/admin/project/item/unassign` | 解除来源项目归属 |

项目创建/更新字段包括 `name`（1–120 个 Unicode 字符）、`description`（最多 2000）、四个独立公开
开关 `publicBasic`/`publicMilestones`/`publicUpdatedAt`/`publicCompletion`，以及
`completionMode`（`auto`/`custom`）和 0–100 的 `customCompletion`。自动完成度按有效里程碑的完成比例
四舍五入；无有效里程碑时为“未设置”。归档项目可以整理元数据和已有关系，但不能新增里程碑或绑定。

#### 项目工作项状态（Kanban 基础）

`POST /api/admin/project/item/status` 仅供管理员在项目详情的 Kanban 视图中使用。请求需要管理员会话、
JSON 内容类型和同源来源检查，并沿用管理写接口的限流边界。请求体为：

```json
{
  "projectId": 12,
  "sourceType": "feedback",
  "sourceId": 34,
  "status": "reviewed"
}
```

`sourceType` 只能是 `feedback` 或 `worktask`，且状态必须匹配来源类型：

- Feedback：`new`、`reviewed`、`resolved`、`notplanned`
- WorkTask：`new`、`scheduled`、`in_progress`、`completed`、`cancelled`

成功返回 HTTP 200，数据只包含项目和来源标识、已保存状态及项目更新时间，不返回来源正文、联系方式、
管理员备注、账号快照或内部关系 ID：

```json
{
  "ok": true,
  "data": {
    "projectId": 12,
    "sourceType": "feedback",
    "sourceId": 34,
    "status": "reviewed",
    "projectUpdatedAt": "2030-01-01T00:00:00.000Z"
  }
}
```

服务端会再次确认项目存在、项目为 `active`、来源关系属于当前项目且来源记录存在，然后复用对应来源的
状态更新函数。状态实际变化时同步更新项目 `updatedAt`；保存相同状态仍成功但不更新时间。成功和失败均
写入管理员审计，动作固定为 `project.item.status`，失败 metadata 只保留稳定错误码及必要的项目/来源字段。

该接口的主要错误为：

| HTTP | 错误码 | 触发条件 |
|---|---|---|
| 400 | `INVALID_PAYLOAD` | 项目 ID、来源类型/ID 或来源专属状态不合法 |
| 404 | `NOT_FOUND` | 项目、来源关系或来源记录不存在 |
| 409 | `PROJECT_ITEM_CONFLICT` | 来源关系属于其他项目，或与请求项目不匹配 |
| 409 | `PROJECT_STATE_CONFLICT` | 项目已归档，不能更新工作项状态 |

管理员项目详情 `GET /api/admin/project/:id` 仍是 Kanban 的读取数据源；浏览器按 Feedback/WorkTask 及其原生
状态分成两个独立分区。公共项目列表和详情继续只返回各自公开开关允许的项目投影，不返回工作项、关系数据
或任何 Kanban 分区。

公共项目接口不需要认证：

| 方法与路径 | 用途 |
|---|---|
| `GET /api/public/projects` | 返回基础信息公开且未归档项目的 `publicKey`、名称和说明 |
| `GET /api/public/projects/:publicKey` | 按不可猜测的随机 key 返回公共详情；里程碑、更新时间、完成度按独立开关省略或返回 |

公共投影不返回内部 ID、来源关联、Kanban 工作项/分区、正文、联系方式、管理员字段或 provider 数据。基础信息未公开、项目归档、
不存在或 key 不合法时统一返回 404。项目关系冲突返回 `PROJECT_ITEM_CONFLICT`，跨项目/撤销里程碑关联返回
`PROJECT_MILESTONE_CONFLICT`，归档项目新增操作返回 `PROJECT_STATE_CONFLICT`。

### 管理员 AI Copilot

| 方法与路径 | 用途 |
|---|---|
| `GET /api/admin/ai/status` | 读取 AI 开关、可用性、当前 AI 配置和掩码 AI 配置列表 |
| `POST /api/admin/ai/profiles` | 新建或更新 Provider AI 配置；更新时 `key` 为空表示保留原密文 |
| `POST /api/admin/ai/profiles/active` | 设置或清空唯一当前 AI 配置 |
| `POST /api/admin/ai/profiles/delete` | 删除 AI 配置；删除当前配置后不会自动切换 |
| `POST /api/admin/ai/profiles/diagnose` | 对指定已保存 AI 配置发起一次真实固定探针诊断；不切换当前配置，可能消耗少量 token |
| `GET /api/admin/ai/metrics?hours=24` | 读取有界时间窗内的 AI 请求聚合指标，不返回逐请求内容 |
| `POST /api/admin/ai/suggest` | 针对一条 `feedback` 或 `worktask` 生成短期建议 |
| `GET /api/admin/ai/suggestions` | 按 `entityType`、`entityId` 查询未过期建议 |
| `POST /api/admin/ai/suggestions/decision` | 接受/拒绝候选字段并记录管理员审计，不改业务表 |

Profile 的 `protocol` 只能是 `openai-chat`、`openai-responses` 或
`anthropic-messages`。前者覆盖 OpenAI 官方、兼容中转站、DeepSeek 与 GLM/Z.ai；
认证头由协议固定生成，不接受任意自定义 Header。API Key 永不出现在响应、日志或浏览器
存储中。可选 `reasoningEffort`（接口也接受输入别名 `reasoning_effort`）只能是空值、
`low`、`medium`、`high`、`xhigh` 或 `max`；只有 `openai-responses` 会将它映射为
`reasoning.effort`，Chat/Anthropic 会省略。可选 `promptInstruction` 最多 2000 个
Unicode 字符，只作为独立的风格补充，不能覆盖系统安全约束。

`diagnose` 请求体只接受 `{ profileId }`，使用保存的 profile 发出固定 sentinel 探针
`KWS_DIAGNOSTIC_OK`，成功响应只会在 HTTP、JSON、文本提取和 sentinel 全部通过时标记
`status=passed`；响应不会包含 Base URL、API Key 或 Provider 原文。Responses profile
的推理强度会随请求发送，但一次诊断不代表模型具备完整推理能力。

`metrics` 的 `hours` 只接受 1–720，返回总请求数、成功/失败/超时、平均耗时、已知 token
合计、未知用量计数以及最多 100 个 operation/protocol 分组。指标 operation 固定为
`copilot_suggest`、`knowledge_ask`、`provider_diagnostic`，写入失败不影响 AI 主请求。

建议请求字段为 `{ entityType, entityId }`；返回值包含 `suggestion`、`similarItems`、
`provider`、`generatedAt`、`expiresAt` 和有界 `usage`。出站输入只包含标题、正文和必要
工作字段，不包含联系方式、管理员备注、账号快照或通知载荷。接受/拒绝只更新
`ai_copilot_suggestion`，管理员仍须使用原有接口保存业务字段。

### 管理员知识助手

知识库相关接口均要求管理员会话；写接口还遵守现有 JSON、CSRF、同源来源检查和审计
约定。知识根目录只来自服务端 `AI_KNOWLEDGE_BASE_DIRS`，请求不能传入路径。状态和引用
只返回配置库名称、POSIX 相对路径及有界统计，不返回绝对路径、索引正文或未选中文档。

| 方法与路径 | 用途 |
|---|---|
| `GET /api/admin/ai/knowledge/status` | 返回索引是否可用、版本/构建时间、库名称、文件/片段统计、警告、保留期和自动清理开关 |
| `POST /api/admin/ai/knowledge/reindex` | 按环境配置只读扫描 `.md`/`.txt` 根目录并原子替换索引；不接受请求体路径 |
| `POST /api/admin/ai/knowledge/ask` | 提交 `{ question, rootId? }`，检索最多 6 个片段并调用当前 AI 配置 |
| `GET /api/admin/ai/knowledge/history` | 分页读取问答历史；支持 `page`、`pageSize`、`keyword`、`rootId` 筛选 |
| `POST /api/admin/ai/knowledge/history/delete` | 提交 `{ id }` 或 `{ answerId }` 删除一条历史 |
| `POST /api/admin/ai/knowledge/history/cleanup` | 删除已过期历史；不受自动清理开关限制 |
| `POST /api/admin/ai/knowledge/settings` | 提交 `{ autoCleanup: boolean }` 更新自动清理开关 |

`ask` 成功数据包含 `answer`、`basis`、`caveats`、`sources`、`provider`、`usage`、
`promptVersion`、创建/过期时间和服务端生成的记录 ID。`basis` 取 `document`、`mixed` 或
`general`；无命中时强制为 `general`，并在 `caveats` 标注“非文档依据/需核验”。`sources`
中的 `sourceId` 仅对当前回答有效，服务端会将模型返回的 ID 映射回库名、相对路径、标题和
有界摘录，模型不能自行指定文件路径。

问题长度限制为 1–4000 个 Unicode 字符，历史 `pageSize` 最大 100。问答接口使用独立的
单管理员 5 分钟 10 次限流；索引重建使用单进程互斥。错误码包括
`KNOWLEDGE_CONFIG_INVALID`、`KNOWLEDGE_REINDEX_FAILED`、`KNOWLEDGE_BUSY`、
`AI_KNOWLEDGE_PERSIST_FAILED` 以及通用 `AI_UNAVAILABLE`、`AI_TIMEOUT`、
`AI_PROVIDER_FAILED`、`AI_INVALID_RESPONSE`。AI 或索引失败不会阻塞反馈、WorkTask、
通知和导出。

## 反馈管理

| 方法与路径 | 用途 |
|---|---|
| `POST /api/admin/feedback/list` | 按状态/关键词分页查询，返回 items、summary、totalPages |
| `POST /api/admin/feedback/status` | 更新 `new/reviewed/resolved/notplanned` |
| `POST /api/admin/feedback/delete` | 删除反馈 |
| `POST /api/admin/feedback/home-display` | 更新主页展示开关 |
| `POST /api/admin/feedback/note-reply` | 保存管理员备注和对外回复 |
| `POST /api/admin/feedback/export` | 按状态/关键词筛选生成服务端 CSV |

## WorkTask 管理

| 方法与路径 | 用途 |
|---|---|
| `POST /api/admin/worktask/list` | 按状态/优先级/关键词分页查询 |
| `POST /api/admin/worktask/create` | 管理员创建本人任务 |
| `POST /api/admin/worktask/status` | 更新 `new/scheduled/in_progress/completed/cancelled` |
| `POST /api/admin/worktask/arrange` | 更新负责人、计划时间和可选状态；字段显式传 `null`/空字符串可清空 |
| `POST /api/admin/worktask/delete` | 删除 WorkTask |
| `POST /api/admin/worktask/home-display` | 更新主页展示开关 |
| `POST /api/admin/worktask/note-reply` | 保存管理员备注和对外回复 |
| `POST /api/admin/worktask/export` | 按状态/优先级/关键词筛选生成服务端 CSV |
| `GET /api/admin/notifications` | 查询持久化通知投递记录 |
| `POST /api/admin/notifications/retry` | 触发指定通知记录的人工重试 |
| `GET /api/admin/notification-handoffs` | 查询 outbox 入队失败的脱敏人工补偿记录 |
| `POST /api/admin/notification-handoffs/retry` | 按 handoff UUID 重新入队；成功后由后台 worker 投递 |

handoff 列表只返回 `handoffId`、`eventId`、业务类型/ID、`providers`、状态、次数、
时间和截断脱敏错误。retry 只接受 UUID；已解决记录不会重复入队，入队失败会保留
`retrying`/`failed` 状态而不回滚业务记录。

### 服务端 CSV 导出与操作审计

两个导出接口沿用列表筛选字段：

- `POST /api/admin/feedback/export`：`status`、`keyword`
- `POST /api/admin/worktask/export`：`status`、`priority`、`keyword`

服务端按固定 250 行批次查询并逐块写出，响应包含 UTF-8 BOM、稳定表头、
`Content-Disposition` 下载文件名、`Cache-Control: no-store` 和 `X-Export-Count`。
反馈表头为 `id,type,title,content,contact,status,accountUserId,accountEmailSnapshot,accountDisplayNameSnapshot,createdAt,updatedAt`；
WorkTask 另外包含 `priority`、`expectedAt`、`scheduledAt`、`assignee`、`tags`。
单次匹配总量超过 `ADMIN_EXPORT_MAX_ROWS` 时，在发送 CSV 头之前返回
`413 EXPORT_LIMIT_EXCEEDED`，不会静默截断。

`POST /api/admin/audit/list` 提供受管理员会话保护的分页审计查询。请求可按
`action`、`entityType`、`entityId`、`actor`、`from`、`to`、`page`、`pageSize` 筛选，
`pageSize` 最大 100。响应为 `{ ok: true, data: { items, page, pageSize, total, totalPages } }`。
审计只保存动作、管理员快照、结果和白名单脱敏元数据；不保存 CSV 内容、完整正文、
联系方式、Cookie、Token 或 Provider Key。

## 已移除的旧 Account 接口

以下历史路由已不再注册，访问时返回统一 `NOT_FOUND`：

| 方法与路径 | 当前用途 |
|---|---|
| `GET /auth/account/start` | 跳转旧 Account 登录入口 |
| `GET/POST /auth/account/callback` | 交换旧登录票据并建立本地 Account 会话 |
| `GET /api/account/me` | 读取旧 Account 会话用户 |
| `POST /api/account/logout` | 注销旧 Account 会话 |
| `GET /api/account/feedback` | 读取旧 Account 用户反馈列表 |
| `GET /api/account/worktask` | 读取旧 Account 用户任务列表 |

这些接口不应恢复或扩展；未来新 Account 协议另行设计。

## 错误与分页

常见错误码包括 `INVALID_PAYLOAD`、`UNAUTHORIZED`、`AUTH_FAILED`、`CSRF_BLOCKED`、`UNSUPPORTED_MEDIA_TYPE`、`RATE_LIMITED`、`NOT_FOUND` 和 `EXPORT_LIMIT_EXCEEDED`。AI 路由另有 `AI_UNAVAILABLE`、`AI_KEY_UNAVAILABLE`、`AI_BUSY`、`AI_RATE_LIMITED`、`AI_TIMEOUT`、`AI_PROVIDER_FAILED`、`AI_INVALID_RESPONSE`、`AI_PROFILE_CONFLICT` 和 `AI_SUGGESTION_CONFLICT`；知识助手还可能返回 `KNOWLEDGE_CONFIG_INVALID`、`KNOWLEDGE_REINDEX_FAILED`、`KNOWLEDGE_BUSY` 和 `AI_KNOWLEDGE_PERSIST_FAILED`。AI 不可用时普通提交、列表和通知流程继续工作。列表响应包含 `items`、`page`、`pageSize`、`total`、`summary`、`totalPages` 等字段；客户端不得假定数据库原始列全部公开。
