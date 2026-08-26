# 已知缺陷与验证缺口

严重性：P0 表示发布前必须处理；P1 表示工作台建设前处理；P2 表示后续增强；信息缺口表示需要证据但不一定是代码错误。

## 确认缺陷

| ID | 严重性 | 现象与影响 | 证据 | 计划验证 |
|---|---|---|---|---|
| D-001 | P0 | 公开主页 highlights 查询并返回了不必要的 content，可能泄露反馈/任务细节 | `server/db.js:1385-1420`、`server/app.js:382-388` | 公共响应断言不含 content/contact/adminNote/账号快照 |
| D-002 | P0 | 旧 Account 私有列表直接返回映射整行，包含 adminNote 等内部字段 | `server/app.js:462-470`、`server/db.js:1078-1125` | 安全 DTO 单测和接口回归 |
| D-003 | P0 | 当前 Account 回调无 state/nonce 绑定，存在登录 CSRF/会话注入风险 | `server/app.js:424-443` | 旧联动移除；未来新协议做 state 重放测试 |
| D-004 | P0 | 转发头来源校验未将信任边界严格绑定到受信代理配置，直暴露端口时可能被伪造 | `server/security.js:17-66` | 代理/直连 spoof 测试 |
| D-005 | P0 | Node 24 与已安装 better-sqlite3 ABI 不匹配，服务/集成测试可能无法启动 | `package.json:18-24`、`docs/testing/release-checklist.md:15-20` | 锁定 Node 版本，干净安装后启动和 npm test |
| D-006 | P0 | npm audit 报告 4 个依赖漏洞（body-parser/qs 为 moderate，Nodemailer 为 high） | `package.json:25-31`、`package-lock.json:448-479`、`npm audit --omit=dev --registry=https://registry.npmjs.org` | 升级、替代或书面风险接受，并重跑 audit |
| D-007 | P1 | 外部 data:image favicon 和外部 Dashboard 响应边界偏宽，存在资源/解析风险 | `public/index/main.js:168-170`、`server/meowstatus.js:65-96` | MIME、大小、超时和异常响应测试 |
| D-008 | P1 | 通知使用进程内 fire-and-forget 重试，进程退出会丢失投递 | `server/app.js:247-282` | 持久化投递记录、失败状态和人工重试测试 |
| D-009 | P0 | WorkTask arrange 无法表达清空负责人/计划时间，管理员无法可靠撤销安排 | `server/validation.js:284-309`、`server/db.js:1338-1360` | clear/unassign 语义测试 |

## 高概率风险

| ID | 严重性 | 风险 | 证据/原因 | 计划 |
|---|---|---|---|---|
| R-001 | P0 | 配置 URL、端口和外部服务当前多为宽松字符串，错误可能运行到请求时才暴露 | `server/config.js:1-106` | 启动配置 schema 和清晰错误 |
| R-002 | P1 | 管理端浏览器分页导出大数据会增加内存和等待时间，且缺少操作审计 | `public/admin/admin.js:385-410,674-700` | 服务端流式导出、上限和审计 |
| R-003 | P1 | 单管理员模型限制协作和追责 | `server/auth.js`、管理员路由 | 未来按规模评估 RBAC，不在当前 P0 扩张 |

## 验证缺口与文档欠账

| ID | 优先级 | 缺口 | 处理方式 |
|---|---|---|---|
| V-001 | P0 | 没有稳定的 health → 提交 → 登录 → 列表 API 冒烟 | 建立可重复的临时 DB/端口脚本 |
| V-002 | P0 | 没有真实备份恢复演练记录 | 在临时环境恢复并保存脱敏证据 |
| V-003 | P0 | 没有真实 SMTP/Webhook 网络链路证据 | 测试环境至少验证一条，记录失败和重试 |
| V-004 | P1 | 没有真实浏览器 UI 回归 | P1 首页/收件箱实现时加入浏览器验收 |
| V-005 | P1 | MySQL/PostgreSQL 只有脚本参数测试，缺少真实集成 | 选择性加入 CI/预发布矩阵 |
| V-006 | P1 | README/旧文档遗漏 MeowStatus 路由和配置 | 本次文档重构补齐并设置唯一权威来源 |
