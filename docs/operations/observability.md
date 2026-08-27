# 日志与观测

## 请求日志

`server/logger.js` 使用 Pino 输出结构化日志，包含服务名、环境、时间、request ID、方法、路径、状态码和耗时。健康检查可通过 `ACCESS_LOG_SKIP_HEALTH=true` 跳过。

状态码和耗时决定日志级别：5xx 为 error，4xx 为 warn，超过 `ACCESS_LOG_SLOW_MS` 的请求为 warn，其余为 info。请求路径中的敏感查询参数会脱敏。

## 应用日志

日志级别由 `LOG_LEVEL` 控制，可通过 `LOG_TO_FILE=true` 写入 `LOG_DIR/app.log`。生产环境应由 PM2、Nginx 或系统日志服务负责轮转和权限隔离；不要让日志无限增长。

## 健康检查

`GET /api/health` 返回服务名和时间；`HEALTH_EXPOSE_COUNTS=true` 时还返回业务计数，不建议公开启用。health 通过不代表外部 MeowStatus、SMTP、Webhook 或备份可用，发布门禁需要分别检查。

## 通知观测

通知采用数据库 `notification_delivery` outbox。反馈/WorkTask 写入成功后，为已启用的 SMTP/Webhook provider 建立 pending 记录；进程启动时和每 30 秒处理到期记录，失败按最多 3 次指数退避重试，最终状态为 `failed`。Webhook 多目标投递若部分成功，会记录成功/失败计数，并把失败目标索引写入脱敏的 `target` 标签；后续重试只发送失败目标，避免重复通知已成功目标。数据库只保存 provider、事件/业务 ID、脱敏目标标签、次数、时间和截断错误，不保存密码、签名或完整联系方式。管理员可通过 `/api/admin/notifications` 查询并通过 `/api/admin/notifications/retry` 触发人工重试。通知失败不回滚已经成功写入的反馈或 WorkTask。

## 排障顺序

1. 用响应头中的 request ID 定位应用日志。
2. 检查状态码、耗时和错误级别，区分客户端输入、认证、外部服务和数据库错误。
3. 查看 PM2/反向代理日志及磁盘空间。
4. 对外部服务检查超时、响应大小、TLS 和凭据配置，不把密钥复制到工单。
5. 若涉及数据风险，先保留备份和脱敏证据，再进行重启或回滚。
