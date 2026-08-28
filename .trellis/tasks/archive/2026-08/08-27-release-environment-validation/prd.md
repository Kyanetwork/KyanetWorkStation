# Release environment verification and deferred hardening

## Goal

把 P0 发布前仍缺失的真实环境证据变成可重复、可审计的验收流程，并在不改变
Node.js + Express + 原生静态前端 + SQLite/MySQL/PostgreSQL 基本架构的前提下，
关闭已经确认的两个本地缺口：MeowStatus 外部资源边界（D-007）和通知 outbox
入队异常的人工补偿记录（R-004）。

## Background and confirmed evidence

- 父任务 `08-26-p0-stability-security-hardening` 的自动化门禁已经通过，当前工作区
  为 Node.js `v24.19.0`、npm `12.0.2`、ABI `137`。
- `deploy/nginx.kyanet-workstation.conf`、`deploy/Caddyfile.kyanet-workstation`
  和 `deploy/iis.web.config.template` 仍使用示例域名或证书路径；D-004 必须在实际
  反向代理来源、监听地址和 TLS 拓扑已知后验证，不能用本地 header stub 代替。
- `tests/backup-sqlite.test.js` 已覆盖合成 SQLite 备份、SHA-256、隔离恢复和关键表
  可读性；本机 V-002 脱敏演练已完成，发布目标仍需目标环境备份及回滚记录。
- `tests/webhook.test.js` 与 `tests/notification-outbox.test.js` 已覆盖 stub 的成功、
  失败、部分失败和重试；V-003 仍需要至少一条真实 SMTP/Webhook 链路及重启后恢复
  证据，凭据不得进入仓库或日志。
- `server/meowstatus.js` 的外部 JSON 与 `data:image` favicon 路径仍需明确大小、
  MIME、解码和超时限制；`server/app.js` 的 outbox 入队异常目前只记录日志并继续
  返回业务成功，缺少可查询的人工补偿记录。

## Requirements

### R1. 发布环境验证工件

- 提供一份按实际部署值填写的验证记录模板，覆盖 Node/npm/ABI、配置键摘要、
  反向代理来源边界、TLS、health/API 冒烟、备份恢复、通知链路、观测和回滚。
- 示例域名、服务器地址、证书位置、数据库 URL、管理员凭据和第三方密钥只允许
  出现在被忽略的 `docs/internal/` 或部署系统，不写入公开文档、测试输出或提交。
- 每个无法执行的门禁必须记录责任人、前置条件和阻塞原因，不得以 stub 或“脚本
  退出 0”冒充真实证据。

### R2. D-004 反向代理与 TLS

- 在实际代理边界确认后，验证应用只监听预期地址，`TRUST_PROXY` 与代理跳数/来源
  一致，直连请求不能伪造转发头通过同源管理写入。
- 验证 HTTP→HTTPS 跳转、证书链、Host/Proto 转发、健康检查和回滚路径；不修改
  未获批准的生产 DNS、证书或防火墙配置。

### R3. V-002 真实脱敏备份恢复

- 使用发布前脱敏备份在独立临时路径/实例恢复，记录 SHA-256、数据库类型、schema
  和关键行读取、耗时及清理结果；上一版本回滚属于发布目标的单独证据。
- 恢复验证不得覆盖生产数据库，证据中不得包含提交内容、数据库 URL 或凭据。

### R4. V-003 真实通知链路

- 至少选择 SMTP 或 Webhook 一条真实 provider，验证成功、失败、有限重试、进程
  重启后继续处理和管理员人工重试；失败不回滚已成功写入的业务记录。
- 记录 provider、时间、状态、脱敏目标标签、尝试次数和错误摘要，不记录密码、签名、
  完整收件人或请求体。

### R5. 本地加固（已确认纳入）

- D-007：为 MeowStatus JSON、favicon MIME/大小/解码和超时建立明确上限与测试，
  外部异常只影响状态卡片，不阻塞反馈/WorkTask。
- R-004：outbox 入队失败写入可查询的人工补偿记录或等价持久化 handoff 状态，
  管理员可识别、重试或导出失败原因；不得静默丢失。

## Constraints and out of scope

- 不启用新的 KyanetAccount 联动；历史 schema/数据继续保留，不自动认领匿名记录。
- 不引入 ORM、队列服务、React/TypeScript、微服务或新的部署平台。
- 不在没有用户提供的真实部署参数、凭据和备份文件时猜测或执行生产变更。
- P1 统一首页、工作收件箱和 AI Copilot 不属于本子任务实现范围。

## Acceptance Criteria

- [x] 发布验证模板可由操作者按步骤填写，且公开仓库不包含真实环境值。
- [x] D-004 的代理来源、监听地址、TLS 和直连伪造测试已有真实部署证据；PM2
      重启恢复、回环监听、源站 `:3000` 公网阻断、Nginx Host/Proto 转发、HTTP→HTTPS
      和 HTTPS health 均已记录。直连伪造请求在网络层被阻断，未伪称应用层 403。
- [x] V-002 已使用 `.env` 指向的真实本机 SQLite 生成脱敏副本，并在独立临时路径完成 checksum、schema、关键表读取、应用启动和清理；本机未执行上一版本回滚，发布到其他数据库/主机时仍需按模板重演备份与回滚。
- [x] V-003 已使用 `.env` 中真实 SMTP 与 Feishu provider 完成成功发送，并在隔离不可达目标完成失败、有限重试、重启恢复和管理员人工重试；日志与 outbox 查询未泄露秘密。
- [x] D-007 与 R-004 有实现、回归测试和运维文档，并继续在路线图/缺陷表保持可追踪。
- [x] `npm test`（69/69）、`npm audit --omit=dev --registry=https://registry.npmjs.org`、
      JavaScript 语法检查和 Trellis 校验继续通过。

## Confirmed scope decision

用户已确认选择 A：同一子任务完成 D-007、R-004 本地加固，并同步建立
D-004/V-002/V-003 的真实发布验证工件。该选择优先关闭已知 P0 缺口，允许本轮
增加少量代码和测试，但不改变基本技术架构。
