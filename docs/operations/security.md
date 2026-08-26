# 安全基线

## 当前基线

- Helmet、CSP、`X-Content-Type-Options` 等响应头由应用或反向代理提供。
- 会话 Cookie 为 HttpOnly、SameSite=Strict，Token 在数据库中保存哈希。
- 管理写请求默认校验同源来源和 JSON Content-Type。
- 提交、登录和管理员接口分别有限流。
- 输入有长度和枚举校验，统一错误响应不应返回堆栈给客户端。
- 请求日志带 request ID，并对 `ticket`、`token`、`secret`、`password` 等查询参数做脱敏。

## P0 必须修复或验证

1. 公共 highlights 只返回公开 DTO，禁止返回 content、contact、adminNote 和账号快照。
2. 旧 Account 私有列表不能返回 adminNote 等内部字段；旧联动清理前应先隔离 DTO。
3. `X-Forwarded-Proto`/`X-Forwarded-Host` 只能在明确受信代理和正确 `TRUST_PROXY` 配置下使用。
4. 图片链接限制协议、域名、长度、响应类型和大小，外部状态响应设置大小上限。
5. 旧 Account 回调的未来替代方案必须有 state/nonce、单次消费和重放保护；旧代码按独立任务移除。
6. 依赖审计、Node/better-sqlite3 ABI、配置启动自检和备份恢复演练必须成为发布门禁。

## 隐私最小化

数据库原始行不是 API DTO。公共页面只显示处理进展所需的标题、状态、公开回复和时间；管理员备注、联系方式、图片链接、账号快照、内部通知载荷和日志不进入公共投影。

## 机密管理

- 密钥、SMTP 密码、Webhook URL、数据库 URL 和管理员密码只从进程环境或部署密钥管理器注入。
- 不把 Token、密码、Cookie、Authorization 头或完整外部 URL 写入日志和导出。
- 真实配置、生产拓扑、备份和用户数据属于内部资料，应放在未跟踪路径。

## 事件响应

发现数据泄露、凭据暴露或异常通知时：先保留脱敏日志和数据库备份，旋转受影响密钥，限制入口，再在隔离环境复现。修复后补回归测试和发布记录，不直接删除证据。
