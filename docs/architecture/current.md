# 当前架构与数据流

## 运行拓扑

```text
Browser
  -> Nginx / IIS / Caddy（可选 TLS 与反向代理）
  -> Node.js + Express
      -> public/ 静态页面
      -> /api/* 路由
      -> SQLite / MySQL / PostgreSQL
      -> MeowStatus（可选外部服务）
      -> SMTP/Webhook（可选通知）
```

应用默认监听 `127.0.0.1:3000`，生产部署应由反向代理承接公网连接。PM2 以单实例 fork 模式运行，符合小规模、低资源目标。

## 请求处理层

`server/app.js` 负责应用组合和路由：

1. Helmet/CSP、请求日志、JSON/urlencoded 解析和 Cookie 解析。
2. 公共 health/config/highlights/MeowStatus 路由。
3. 反馈与 WorkTask 提交路由。
4. 管理员登录、列表、状态、安排、备注、导出和通知测试路由。
5. 统一错误响应和静态文件回退。

`server/validation.js` 负责输入规范化和字段长度/枚举校验；`server/security.js` 负责管理写请求的来源和 JSON 类型边界；`server/errors.js` 负责统一错误形状。

## 数据层

`server/db.js` 为当前数据访问边界：

- 根据 `DB_CLIENT` 选择 SQLite、MySQL 或 PostgreSQL。
- 在各驱动上创建反馈、WorkTask、管理员、会话和设置表。
- 通过兼容迁移补充主页展示、备注回复、Account 快照等列。
- 提供分页、关键词、状态/优先级筛选和主页摘要查询。

反馈和 WorkTask 保持独立业务表。未来工作台通过聚合读取层和安全 DTO 组合展示，不直接改变两张表的业务语义。

## 认证边界（当前代码状态）

- 管理员会话使用独立 Cookie 和服务端会话表，Token 只以哈希形式保存。
- 旧 KyanetAccount 登录票据、Account 会话和 Account 私有列表路由已从活动请求路径移除；历史 schema/数据暂保留，等待独立迁移任务。
- 旧 Account 代码不得成为新工作台功能的依赖。未来重新接入必须作为独立设计，并重新定义 state、回调、DTO 和历史匿名数据规则。

## 通知与外部状态

- `server/notify.js` 封装 SMTP。
- `server/webhook.js` 封装 generic、企业微信、飞书/Lark、钉钉和 Slack 载荷。
- `server/meowstatus.js` 负责外部 Dashboard 请求、超时和基本规范化。
- 通知在业务写入成功后进入 `notification_delivery` outbox；启动及定时 worker 进行有界重试，管理员可查询失败并触发重试。

## 启动顺序

`server/app.js` 启动时先执行无副作用的运行配置 preflight；通过后才初始化数据库、补齐 schema、确保引导管理员、清理过期会话，并启动不阻塞监听的通知 outbox worker，随后开始监听端口。Node 24 是发布运行时基线。

## 数据可见性原则

公共 highlights 只能返回公开标题、状态、公开回复和时间等必要字段；不能返回 content、contact、管理员备注、Account 快照或其他内部字段。管理员接口和未来用户安全视图必须使用明确的 DTO，不把数据库整行直接作为响应。
