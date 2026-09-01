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
      -> AI Provider（管理员主动请求、可选）
      -> 外部 Markdown/TXT 知识目录（管理员显式索引、只读）
```

应用默认监听 `127.0.0.1:3000`，生产部署应由反向代理承接公网连接。PM2 以单实例 fork 模式运行，符合小规模、低资源目标。

## 请求处理层

`server/app.js` 负责应用组合和路由：

1. Helmet/CSP、请求日志、JSON/urlencoded 解析和 Cookie 解析。
2. 公共 health/config/highlights/MeowStatus 路由。
3. 反馈与 WorkTask 提交路由。
4. 管理员登录、列表、状态、安排、备注、服务端导出、审计查询和通知测试路由。
5. 管理员 AI profile/Copilot 与知识助手状态、重建、问答、历史和清理路由。
6. 管理员 Provider 真实诊断和 AI 请求指标聚合路由。
7. 统一错误响应和静态文件回退。

`server/validation.js` 负责输入规范化和字段长度/枚举校验；`server/security.js` 负责管理写请求的来源和 JSON 类型边界；`server/errors.js` 负责统一错误形状。

管理员 AI Copilot 由三个边界模块组成：`server/ai-profiles.js` 管理最多 8 个 profile、
唯一 active profile 和 AES-256-GCM 密文；`server/ai-provider.js` 负责 OpenAI Chat/
Responses 与 Anthropic Messages 的固定协议适配、超时和响应大小限制；
`server/ai-copilot.js` 负责最小字段投影、相似条目、并发闸门、建议校验和短期候选审计。
浏览器只收到掩码 profile 和建议 DTO，不接触 Provider Key。

知识助手由 `server/knowledge-base.js` 与 `server/ai-knowledge.js` 组成：前者从
`AI_KNOWLEDGE_BASE_DIRS` 读取受控根目录，执行 realpath/扩展名/大小边界、分块、确定性
检索和版本化索引原子替换；后者复用 active profile，生成固定 `knowledge-v1` prompt、
校验答案 JSON、映射本次请求引用并写入问答历史。浏览器只收到库名、POSIX 相对路径和
有界摘录，不能提交任意路径。

## 数据层

`server/db.js` 为当前数据访问边界：

- 根据 `DB_CLIENT` 选择 SQLite、MySQL 或 PostgreSQL。
- 在各驱动上创建反馈、WorkTask、管理员、会话和设置表。
- 通过兼容迁移补充主页展示、备注回复、Account 快照等列。
- 提供分页、关键词、状态/优先级筛选和主页摘要查询。
- `workstation_setting` 保存非敏感运行设置及 AI profile 元数据/密文；
  `ai_copilot_suggestion` 保存短期建议、过期时间和人工决策审计。
- `ai_knowledge_answer` 保存有界问题、回答、引用、依据、profile/模型、用量、prompt
  版本和过期时间；`ai_knowledge_settings` 通过设置 JSON 保存自动清理开关。
- `ai_request_metric` 只保存 Copilot、知识问答和 Provider 诊断的操作、协议、模型摘要、
  状态、耗时、token 和稳定错误码，按时间索引提供有界聚合；写入 best-effort，不提供逐请求
  敏感内容查询。
- `data/ai-knowledge-index.json` 是不进 Git 的版本化检索缓存，不作为数据库或 API 数据源。
- `admin_audit` 保存管理员动作级审计；反馈/WorkTask 导出通过固定 250 行批次查询，
  不构造全量结果数组。

反馈和 WorkTask 保持独立业务表。未来工作台通过聚合读取层和安全 DTO 组合展示，不直接改变两张表的业务语义。

## 认证边界（当前代码状态）

- 管理员会话使用独立 Cookie 和服务端会话表，Token 只以哈希形式保存。
- 旧 KyanetAccount 登录票据、Account 会话和 Account 私有列表路由已从活动请求路径移除；历史 schema/数据暂保留，等待独立迁移任务。
- 旧 Account 代码不得成为新工作台功能的依赖。未来重新接入必须作为独立设计，并重新定义 state、回调、DTO 和历史匿名数据规则。

## 通知与外部状态

- `server/notify.js` 封装 SMTP。
- `server/webhook.js` 封装 generic、企业微信、飞书/Lark、钉钉和 Slack 载荷。
- `server/meowstatus.js` 负责外部 Dashboard 请求、超时、响应体/MIME/字段边界和 favicon 规范化。
- `server/ai-provider.js` 是唯一的 AI 外部 HTTP 出站边界；AI 失败只返回有界错误，不影响反馈、
  WorkTask、通知或状态卡片。
- `server/ai-diagnostics.js` 复用 Provider 边界，以固定 sentinel 对任意已保存 profile 做显式
  一次性真实诊断，不改变 active profile；`server/ai-metrics.js` 负责三类 AI 操作的有界指标、
  汇总和保留期清理。
- 知识库原始目录是只读输入，索引器不写入原目录、不监听变化；知识问答失败只影响管理员
  AI 区域，不影响普通业务。
- 通知在业务写入成功后进入 `notification_delivery` outbox；启动及定时 worker 进行有界重试，管理员可查询失败并触发重试。极少数 outbox 入队异常写入同一私有数据目录的 `notification-handoff.jsonl`，由 `server/notification-handoff.js` 提供脱敏查询和人工重新入队，不改变业务写入语义。

## 启动顺序

`server/app.js` 启动时先执行无副作用的运行配置 preflight；通过后才初始化数据库、补齐 schema、确保引导管理员、清理过期会话，并启动不阻塞监听的通知 outbox worker，随后开始监听端口。Node 24 是发布运行时基线。

## 数据可见性原则

公共 highlights 只能返回公开标题、状态、公开回复和时间等必要字段；不能返回 content、contact、管理员备注、Account 快照或其他内部字段。管理员接口和未来用户安全视图必须使用明确的 DTO，不把数据库整行直接作为响应。

AI 出站和响应均使用 allow-list；建议不能直接写入业务表、公开回复或通知 outbox。

知识助手的出站数据只包含管理员问题和检索到的少量片段；片段按不可信资料处理，不执行
其中的 URL/命令，不发送未选中文档、绝对路径或内部配置。回答引用由服务端生成并映射，
`basis=general` 时必须提示未由文档验证。

管理员导出与审计数据流为：

```text
管理员筛选
  -> POST /api/admin/{feedback,worktask}/export
  -> count + ADMIN_EXPORT_MAX_ROWS 检查
  -> 250 行批次查询 -> CSV 响应流（背压等待）
  -> admin_audit（动作、结果、脱敏元数据）
```

导出在开始发送响应头前完成上限拒绝；开始输出后若查询或连接失败只关闭流并记录
脱敏错误，不追加 JSON。审计写入是 best-effort，不回滚已成功的业务操作。
