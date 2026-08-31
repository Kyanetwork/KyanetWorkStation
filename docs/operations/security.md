# 安全基线

## 当前基线

- Helmet、CSP、`X-Content-Type-Options` 等响应头由应用或反向代理提供。
- 会话 Cookie 为 HttpOnly、SameSite=Strict，Token 在数据库中保存哈希。
- 管理写请求默认校验同源来源和 JSON Content-Type。
- 提交、登录和管理员接口分别有限流。
- 输入有长度和枚举校验，统一错误响应不应返回堆栈给客户端。
- 请求日志带 request ID，并对 `ticket`、`token`、`secret`、`password` 等查询参数做脱敏。
- 管理员 CSV 导出受会话、同源、JSON 和 `ADMIN_EXPORT_MAX_ROWS` 上限保护；服务端流不在浏览器
  拼接全量数据，响应禁止缓存。

## 管理员操作审计

- SQLite、MySQL、PostgreSQL 均追加 `admin_audit` 表；初始化使用幂等的追加式 schema，旧业务
  数据无需迁移或重写。
- 记录动作级信息（管理员快照、动作、实体、request ID、结果和白名单元数据），不保存
  before/after 全文、CSV 内容、联系方式、Cookie、Token、API Key 或 Provider URL。
- 审计查询仅开放给管理员会话，`pageSize` 最大 100；元数据在写入和读取两侧都做长度/字段
  限制。审计写入故障记录结构化警告但不改变业务响应。
- 审计记录随现有数据库备份保留，不新增自动清理。若需回滚代码，保留审计表和备份，不执行
  删除迁移。

## AI Copilot 边界

- AI 默认关闭；只有管理员会话可以读取 profile、请求建议或记录决策。建议接口另有
  10 次/5 分钟限流和单进程 2 个并发上限。
- 只允许三种固定协议：OpenAI Chat/兼容、OpenAI Responses、Anthropic Messages。
  认证头由服务端按协议生成，不接受页面传入的任意 Header。
- API Key 只在提交和单次 Provider 请求的进程内路径出现；持久化时用
  `AI_PROFILE_ENCRYPTION_KEY` 保护的 AES-256-GCM 密文封装。数据库备份不替代主密钥
  备份，主密钥丢失时应保持 AI unavailable，不从日志或数据库猜测恢复。
- Provider 出站只包含实体类型、标题、正文和必要的 WorkTask 字段；联系方式、管理员
  备注、账号快照、会话/Token、通知载荷和图片原文不出站。模型输出先经过枚举/长度校验，
  只保存到短期 `ai_copilot_suggestion` 候选记录。
- 接受/拒绝只记录审计字段；“填入回复”只修改浏览器当前表单，状态、删除、公开回复、
  SMTP/Webhook 仍必须由管理员通过原有操作明确提交。
- 日志只记录 request ID、实体、profile/协议/model、耗时、状态和脱敏错误码，不记录
  API Key、完整 prompt/response 或 Provider query。

## P0 必须修复或验证

1. 公共 highlights 只返回公开 DTO，禁止返回 content、contact、adminNote 和账号快照。
2. 旧 Account 私有列表路由已下线；历史 mapper 仅作迁移保留，不能恢复为活动接口或返回 adminNote 等内部字段。
3. `X-Forwarded-Proto`/`X-Forwarded-Host` 只能在明确受信代理和正确 `TRUST_PROXY` 配置下使用；当前数值 hop 配置本身不能证明直连请求来自受信代理，应用应保持回环监听并在发布前完成实际代理边界校验（见已知缺陷 D-004）。
4. 当前反馈只保存用户提供的文本链接，并限制数量/长度；MeowStatus Dashboard 现在限制 JSON MIME、响应体、字段/挂件数量和 raster favicon 大小/文件头，异常只影响状态卡片（D-007）。
5. 旧 Account 回调的未来替代方案必须有 state/nonce、单次消费和重放保护；旧代码按独立任务移除。
6. outbox 入队失败写入私有 handoff journal；journal 只能保存脱敏事件/业务标识和错误摘要，文件不可写时必须暂停发布并人工补偿（R-004）。
7. 依赖审计、Node/better-sqlite3 ABI、配置启动自检和备份恢复演练必须成为发布门禁。

## 隐私最小化

数据库原始行不是 API DTO。公共页面只显示处理进展所需的标题、状态、公开回复和时间；管理员备注、联系方式、图片链接、账号快照、内部通知载荷和日志不进入公共投影。

## 机密管理

- 密钥、SMTP 密码、Webhook URL、数据库 URL 和管理员密码只从进程环境或部署密钥管理器注入。
- 不把 Token、密码、Cookie、Authorization 头或完整外部 URL 写入日志和导出。
- 真实配置、生产拓扑、备份和用户数据属于内部资料，应放在未跟踪路径。

## 事件响应

发现数据泄露、凭据暴露或异常通知时：先保留脱敏日志和数据库备份，旋转受影响密钥，限制入口，再在隔离环境复现。修复后补回归测试和发布记录，不直接删除证据。
