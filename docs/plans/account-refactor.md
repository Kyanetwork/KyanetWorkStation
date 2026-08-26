# KyanetAccount 重构衔接

## 当前决策

KyanetAccount 当前开发停滞，KyanetWorkStation 不继续扩展现有联动。旧联动代码、路由、配置和专属字段在 P0 独立任务中清理；本项目的工作台、匿名提交和服务卡片不依赖它。

## 清理前提

1. 盘点 `server/account-auth.js`、`server/account-session.js`、`server/app.js` Account 路由、配置变量和数据库字段/表。
2. 备份数据库并在临时环境验证反馈、WorkTask、管理员和设置数据。
3. 写明迁移前后 schema、保留字段、删除字段和回滚动作。
4. 先停止入口和调用，再清理未使用代码；不要在没有恢复证据时直接删除生产数据。

## 未来重新接入的边界

未来 Account 接入必须是独立设计和独立 Trellis 任务，至少重新定义：

- 登录起始请求与浏览器会话绑定的 state/nonce；
- 一次性票据交换、过期、重放和错误处理；
- Account 用户 DTO、管理员 DTO 和公共 DTO 的分离；
- Cookie、注销、跨站策略和反向代理边界；
- 匿名模式切换和公众提交的反滥用策略；
- 不传递 KyanetAccount 密码、浏览器 session cookie 或不必要 Token。

## 历史匿名数据

新账号不会按邮箱、联系方式或标题自动认领历史匿名记录。若未来确实需要认领，必须另行设计一次性、可审计、可撤销的流程，并经过隐私评估。

## 进入条件

只有当 KyanetAccount 有明确的新协议、可用测试环境、负责人和回滚方案时，才建立新的 Account 联动任务；在此之前保持隔离，不阻塞 Workstation 本身的 P0/P1 路线。
