# API 参考

本文档描述当前代码中的 HTTP 路由。旧 KyanetAccount 联动已移除；本文件不把计划中的新接口当作当前接口。

## 通用约定

- 成功响应通常为 `{ "ok": true, "data": ... }`。
- 错误响应为 `{ "ok": false, "error": { "code": "...", "message": "..." } }`。
- 管理写接口要求 JSON，并默认要求同源 `Origin`/`Referer`；`ADMIN_ALLOW_HEADERLESS_MUTATION=true` 只用于受控调试。
- 管理接口需要管理员会话 Cookie；公共提交接口受提交限流和输入校验约束。
- 管理列表请求使用 `page`/`pageSize`，服务端将 `pageSize` 限制在 100 以内。

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

## 反馈管理

| 方法与路径 | 用途 |
|---|---|
| `POST /api/admin/feedback/list` | 按状态/关键词分页查询，返回 items、summary、totalPages |
| `POST /api/admin/feedback/status` | 更新 `new/reviewed/resolved/notplanned` |
| `POST /api/admin/feedback/delete` | 删除反馈 |
| `POST /api/admin/feedback/home-display` | 更新主页展示开关 |
| `POST /api/admin/feedback/note-reply` | 保存管理员备注和对外回复 |

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
| `GET /api/admin/notifications` | 查询持久化通知投递记录 |
| `POST /api/admin/notifications/retry` | 触发指定通知记录的人工重试 |

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

常见错误码包括 `INVALID_PAYLOAD`、`UNAUTHORIZED`、`AUTH_FAILED`、`CSRF_BLOCKED`、`UNSUPPORTED_MEDIA_TYPE` 和 `RATE_LIMITED`。列表响应包含 `items`、`page`、`pageSize`、`total`、`summary`、`totalPages` 等字段；客户端不得假定数据库原始列全部公开。
