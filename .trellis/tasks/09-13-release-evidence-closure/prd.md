# 生产发布证据收口

## Goal

在不改变产品行为和数据库业务数据的前提下，补齐当前云服务器发布的生产证据，确认
PostgreSQL、PM2/3088、导出与审计、AI 指标、通知 outbox 和备份恢复链路可观测、可回滚，
并把真实结果以脱敏形式记录到私有发布材料。该任务的产物是可复核的发布门禁证据，不是
新的业务功能。

## Confirmed facts

- 当前代码基线已经包含三数据库抽象、`npm run backup-db:rdbms`、服务端 CSV 导出、
  `admin_audit`、AI Provider 诊断/指标和通知 outbox/handoff；对应本地自动测试已覆盖。
- 当前云服务器由用户维护，数据库为 PostgreSQL，进程管理器为 PM2，应用端口为 `3088`，
  外部入口由宝塔 Nginx 提供 HTTPS 反向代理；不要重新假设端口为 `3000`，不要同时启用
  systemd 项目 unit。
- Work Hub 已完成云端核心和浏览器状态验收；本任务不重新实现 Work Hub，也不改变
  KyanetAccount 暂缓边界。
- 用户已完成 AI profile 真实诊断并确认结果正常；本任务需要确认该结果对应的指标可查、
  不含密钥/完整 URL/响应正文，而不是再次盲目发送请求。
- PostgreSQL 恢复方案已确定为方案 A：在当前 PostgreSQL 实例创建唯一临时数据库，使用
  `pg_restore --exit-on-error` 恢复，完成核对后显式删除；执行账号必须具备创建/删除临时库
  的受控权限，证据只记录隔离名称和清理结果，不记录连接串或凭据。

## Requirements

### R1. 发布基线与监听边界

- 记录发布提交、Node/npm/ABI、`npm ci`/原生模块探针、PM2 `status/show/save`、实际
  cwd、应用监听地址和 `GET /api/health`。
- 从 HTTPS 代理入口复核 health；确认应用端口只在预期回环/私网边界可达，Nginx 配置
  检查通过，生产 `.env`、数据库、备份、日志和 PM2 cwd 不被 Git 同步覆盖。
- 只记录键名、状态和脱敏摘要，不记录数据库 URL、Cookie、密钥、真实收件人或完整日志。

### R2. PostgreSQL 备份与隔离恢复

- 在维护窗口执行 `npm run backup-db:rdbms`，保留备份文件 basename、SHA-256、创建时间、
  权限和清理结果；不把备份文件带回 Git 工作树。
- 将 custom-format dump 恢复到隔离的临时 PostgreSQL 数据库/实例，不覆盖生产库；使用
  `pg_restore` 的错误退出语义，并核对 schema、关键表存在性和脱敏行数摘要。
- 在隔离库上使用匹配 Node 24 运行时完成初始化/只读应用冒烟（health、管理员列表或等价
  查询），结束后删除临时数据库/实例并记录未触碰生产库的证据。

### R3. 导出与审计实链路

- 在管理员会话下分别执行 Feedback/WorkTask 正常筛选导出，确认 CSV MIME、BOM、表头、
  `X-Export-Count`、中文/逗号转义和筛选结果；查询对应 `admin_audit`，确认动作、结果、
  request ID 和白名单元数据可见且无正文/联系方式/凭据。
- 超限拒绝、流中断和审计写入失败继续以自动测试为证据；不为了制造大量生产数据而批量
  插入或删除真实记录。若需要实链路超限演练，必须在隔离数据库执行。

### R4. AI 指标与通知恢复

- 在管理员页面读取最近 24 小时 AI 指标，确认已完成诊断（以及已有 Copilot/知识问答时）
  的 operation、协议、状态、耗时和 usage 汇总可见；不显示 API Key、Provider URL、
  prompt、响应正文或业务内容。
- 检查通知 outbox 是否存在 pending/retrying/failed/handoff 记录，确认成功记录、重试
  状态、PM2 重启后的继续处理和管理员查询边界；不让通知失败回滚业务记录。
- 失败演练使用隔离/不可达测试目标或已有失败记录，不触发未批准的真实收件人或第三方
  provider 投递；失败记录必须可脱敏查询并能在恢复目标后人工重试/闭环。用户已批准执行
  一次受控失败→重试→恢复演练。

### R5. 证据、停止条件与回滚

- 按 `docs/operations/release-evidence-template.md` 记录通过项、未覆盖项、备份 checksum、
  隔离恢复清理、代理/TLS、PM2、通知和 AI 指标证据；实际记录仅放在被忽略的
  `docs/internal/` 或部署系统。
- 任一 health、数据库恢复、权限、代理边界、outbox journal 或数据完整性异常都停止发布，
  保留备份和日志，按上一提交/上一进程配置回滚；不得执行 `DROP TABLE`、`git clean -fdx`
  或强制覆盖生产目录。

## Acceptance Criteria

- [ ] 发布提交、运行时、PM2/3088、监听边界、Nginx/TLS 和 health 证据完整且脱敏。
- [ ] PostgreSQL custom dump 已生成并校验；已在隔离库恢复、读取关键表、完成清理，生产库
      未被覆盖。
- [ ] Feedback/WorkTask 正常 CSV 导出和 `admin_audit` 查询在生产 PostgreSQL 上可复核；
      敏感字段未出现在导出之外的审计/响应中。
- [ ] AI 指标汇总可读且脱敏；真实诊断前后 active profile 未被意外切换。
- [ ] 通知 outbox/handoff 状态可查询；成功、失败/重试（若有隔离演练）和 PM2 重启恢复边界
      有证据，业务写入不因通知失败回滚。
- [ ] 所有自动门禁仍通过：`npm test`、`npm audit --omit=dev`、`git diff --check`、
      相关 `node --check`；未引入业务代码或 schema 变更。
- [ ] 证据文件不包含真实地址、凭据、Cookie、收件人、数据库 URL、Provider URL、Key、
      prompt、完整响应或用户正文。

## Out of scope

- 不新增功能、API、数据库表/列、ORM、实时服务或新的外部监控平台。
- 不切换 PM2/systemd，不改变 Nginx、DNS、证书、防火墙或生产端口配置。
- 不在生产库批量造数、删除真实记录、执行破坏性恢复或回滚演练。
- 不推进 KyanetAccount 联动、用户侧 AI、Kanban 高级功能或公共 Work Hub。
