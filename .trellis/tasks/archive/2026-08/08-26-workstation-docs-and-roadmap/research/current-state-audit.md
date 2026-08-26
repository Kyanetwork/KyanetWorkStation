# Current-state audit

审计日期：2026-08-26。仅记录公开代码、测试、配置和文档证据；未读取 `.env` 内容，未执行外部写入。

## Product and architecture evidence

- Express 中间件、CSP、请求日志和 JSON 解析：`server/app.js:92-112`。
- 公共、Account、反馈、WorkTask、管理员和状态路由：`server/app.js:355-839`。
- 数据库驱动选择及跨 SQLite/MySQL/PostgreSQL schema：`server/db.js:1-14,158-429`。
- 外部 MeowStatus 请求和超时处理：`server/meowstatus.js:1-100`。
- 管理页筛选、分页、CSV、通知测试和状态设置：`public/admin/admin.js:187-235,265-445,674-814`。
- 跨平台备份脚本：`scripts/backup-db.js`、`scripts/backup-db-rdbms.js`、`scripts/backup-db.ps1`、`scripts/backup-db.sh`。

## Documentation drift

- `PLAN.md:3` 仍以 2026-04 为当前状态，且 `PLAN.md:20-46` 的未完成项没有反映 Account/MeowStatus 的最新代码。
- `Feedback_CloudbaseVer.md:1-35,37-108,476-520` 描述已废弃 CloudBase 架构和已实现功能前的状态。
- `migration2localweb_reference_guide.md:1-13,301-448` 是迁移参考，不是当前运行手册。
- `README.md:80-103` 的项目树遗漏 `account-auth.js`、`account-session.js`、`meowstatus.js`、`security.js`；`README.md:116-358` 遗漏 MeowStatus 公共路由和状态设置路由。
- `README.md:574-625` 与 `server/config.js:79-81`、`.env.example:42-70` 不完整一致，遗漏 MeowStatus 配置。
- `.gitignore:11-15` 忽略当前规划文件，破坏规划基线。

## Confirmed defects and risks to plan

1. `server/db.js:1385-1420` 的主页 highlights 查询包含 content，`server/app.js:382-388` 无鉴权公开返回；需最小化 DTO。
2. `server/app.js:462-470` 调用的 Account 列表映射包含 `adminNote` 等内部字段；需安全 DTO。
3. `server/app.js:424-443` 的 Account 回调没有 state 绑定；旧联动移除任务仍应记录未来重构要求。
4. `server/security.js:17-66` 对转发头的信任需要与 `TRUST_PROXY` 和受信代理边界一致。
5. `public/index/main.js:168-170` 允许外部 data:image favicon；需限制协议/MIME/尺寸或服务端过滤。
6. `server/meowstatus.js:65-96` 缺少响应体大小上限；需在未来 P0 任务中补齐。
7. `server/app.js:247-282` 的通知是进程内 fire-and-forget 重试，进程退出可能丢失；需规划持久化投递记录/人工重试。
8. `server/validation.js:284-309` 与 `server/db.js:1367-1395` 使 WorkTask arrange 无法清空负责人/计划时间。
9. Node 24 与 `better-sqlite3` ABI 不匹配，当前 `npm test` 不能作为绿证据；需锁定 Node 版本并在匹配环境重建依赖。
10. `npm audit --omit=dev --registry=https://registry.npmjs.org` 报告 4 个依赖漏洞，其中 Nodemailer high；需记录升级/缓解结论。
11. 现有测试未覆盖真实浏览器、SMTP/Webhook 网络、MySQL/PostgreSQL、备份恢复和发布冒烟；需列为验证缺口。
