# 技术设计：生产发布证据收口

## 1. 目标与边界

本任务把已经部署到云服务器的 KyanetWorkStation 发布状态整理为一份可复核、可脱敏、可回滚的
私有证据。它不是业务功能开发，不改变 Express 路由、数据库 schema、ORM/驱动、前端页面或
进程管理方案。

执行主体是维护窗口中的部署操作者；当前工作区只保留规划工件。真实主机名、端口外的拓扑、
数据库连接信息、管理员会话、收件人、Provider 地址/密钥、用户正文和完整日志只能留在部署
系统或被 `.gitignore` 忽略的 `docs/internal/`，不能写入公开仓库。

## 2. 证据产物

- 公开模板：`docs/operations/release-evidence-template.md`，只保留占位符。
- 私有记录：从模板复制到 `docs/internal/` 或部署系统；建议文件权限为 `600`，仅记录
  basename、计数、状态、耗时、版本和脱敏错误摘要。
- 本任务不把 PostgreSQL dump、临时数据库导出、通知 payload 或 AI prompt/response 复制回
  工作树。备份只在服务器受控目录保存，并按既有保留策略清理。

## 3. 端到端数据流

```text
发布基线/监听快照
        │
        ├── PostgreSQL custom dump ──> SHA-256 ──> 唯一临时数据库
        │                                      │
        │                                      ├── pg_restore --exit-on-error
        │                                      ├── schema/关键表计数
        │                                      └── Node 24 隔离应用 health/只读冒烟
        │                                      └── 停止临时应用并删除临时数据库
        │
        ├── 管理员导出 ──> CSV 头/BOM/筛选计数 ──> admin_audit 脱敏查询
        ├── AI 既有诊断/指标 ──> operation/协议/状态/耗时/usage 摘要
        └── 隔离通知失败演练 ──> retry/handoff/重启恢复 ──> 成功或可解释阻塞

脱敏复核 ──> 私有证据 ──> 门禁结论（通过/暂停/部分通过）
```

所有验证都遵循“先确认目标，再读取/写入”的顺序。生产 PostgreSQL 只做备份、只读核对，
以及已批准的管理员导出所必需的受控审计写入；通知失败→重试→恢复在隔离数据库/临时应用
完成，不使用真实收件人或第三方目标。

## 4. 分项设计

### R1：发布基线与监听边界

记录发布提交、上一回滚提交、Node/npm/ABI/N-API、依赖安装和 `better-sqlite3` 探针结果；
用 `pm2 status`、`pm2 show`、保存状态和实际 cwd 确认唯一的 PM2 单实例。应用端口固定按本次
生产事实使用 `3088`，应用应仅监听预期回环/私网地址，外部请求经宝塔 Nginx HTTPS 进入。

health 需要同时从 `127.0.0.1:3088` 和 HTTPS 代理入口验证；`nginx -t`、HTTP→HTTPS、
Host/Proto 转发和公网直连阻断分别记录。任何 `.env`、数据库、备份、日志、handoff 或 PM2
运行时配置都不得被 Git 同步覆盖。

### R2：PostgreSQL 备份与隔离恢复

`npm run backup-db:rdbms` 生成 custom-format `postgres_<db>_<timestamp>.dump`。证据只写
basename、创建时间、权限和 SHA-256；不写连接串或数据库行。

恢复采用方案 A：在同一 PostgreSQL 实例中由受控账号创建带时间/进程后缀的唯一临时数据库。
连接参数通过当前部署的秘密管理方式注入 `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE` 或
等价的临时连接串，绝不回显。执行 `pg_restore --exit-on-error --no-owner --no-privileges`
到临时库，不对生产库使用 `--clean` 或恢复命令。

恢复后只读取 `to_regclass`/schema 存在性和 `feedback`、`worktask`、`admin_audit`、
`notification_delivery`、`workstation_setting`、项目相关表的脱敏行数摘要。用 Node 24、
随机临时端口和关闭通知/AI 的临时环境启动同一提交，完成 health 和管理员列表或等价只读
查询；管理员列表只能使用在隔离库内新生成的一次性凭据/会话，禁止复用生产 Cookie、密码或
会话，不修改生产 `.env`。停止临时进程后，先核对数据库名符合本次唯一前缀，再显式删除临时库，
记录清理成功。删除目标不匹配时立即停止，不执行任何 DROP。

### R3：CSV 导出与审计

在现有管理员会话中分别以正常筛选执行 Feedback/WorkTask 导出，只记录响应状态、CSV MIME、
`Cache-Control`、`X-Export-Count`、BOM、表头和筛选计数；中文、逗号、换行的转义用结构化
断言记录，不把真实正文写入证据。

随后查询对应 `admin_audit`，核对导出动作、结果、request ID 和白名单 metadata。禁止出现
正文、联系方式、管理员备注、Cookie、凭据、完整 URL 或 Provider payload。超限、流中断和
审计写入失败继续使用既有自动测试作证；不在生产库批量造数或删除数据。

### R4：AI 指标与通知恢复

AI 使用用户已完成的真实诊断记录，不默认再次请求 Provider。读取最近 24 小时汇总，确认
operation、协议、状态、耗时和 usage/未知用量可见；比较诊断前后 active profile，确保没有
意外切换。若必须补做诊断，必须由管理员显式点击并接受少量 token 成本提示。

通知先查询生产 outbox/handoff 的脱敏状态；没有记录时明确记录“无待处理记录”，不能把空集
误报为成功投递。一次失败→重试→恢复演练在隔离数据库完成：不可达的 loopback webhook
或 SMTP 端口制造 `retrying/failed`，临时 sink 恢复目标后按 delivery/handoff ID 人工重试，
中间重启临时应用以确认 pending 状态来自数据库而非内存。只记录 ID、provider 类型、状态、
次数和时间；journal 不可写、业务写入回滚或 payload 泄露均为停止条件。

## 5. 兼容性与发布形状

- Node 24.x LTS、npm 12 和 `better-sqlite3 ^13.0.3` 是当前发布基线；Node ABI 数字不能替代
  登录/API 冒烟。
- PM2 是唯一应用进程管理器；不启用项目级 systemd unit，不改 Nginx、DNS、证书、防火墙
  或 `3088` 端口。
- 没有业务 schema 迁移。临时应用允许在恢复库上执行已有幂等初始化，但不得把任何 DDL/数据
  写回生产库。
- KyanetAccount、用户侧 AI、Kanban 高级能力和公共 Work Hub 不在本任务范围。

## 6. 停止条件与回滚

遇到 health/权限/代理边界异常、`pg_restore` 非零、关键表缺失、临时库目标不确定、outbox
journal 不可写、业务记录因通知失败回滚、AI/导出返回敏感数据或证据无法脱敏时立即暂停。
保留备份和必要日志，恢复上一提交/上一 PM2 配置后重新检查 health、监听、数据和通知；不执行
`DROP TABLE`、`git clean -fdx`、强制覆盖生产目录或对生产库执行破坏性恢复。

## 7. 验收映射

| PRD 要求 | 主要证据 | 通过条件 |
|---|---|---|
| R1 | 版本、PM2、监听、Nginx、health 快照 | 目标唯一、代理可达、直连边界符合预期 |
| R2 | dump basename/hash、临时库恢复/清理、只读冒烟 | `pg_restore` 0、关键表存在、临时目标已删除 |
| R3 | 两类 CSV 头/计数、audit 脱敏查询 | 筛选正确、CSV 合同满足、无敏感字段 |
| R4 | AI 24h 指标、active 稳定性、outbox/handoff 状态 | 指标可读且脱敏；隔离失败演练可恢复 |
| R5 | 私有证据复核、自动门禁、回滚/停止记录 | 公开仓库无真实部署数据，门禁结论可复核 |
