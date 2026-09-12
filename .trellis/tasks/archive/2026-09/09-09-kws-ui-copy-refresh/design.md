# KWS UI与文案整理技术设计

详细设计与用户审阅版本：[`docs/superpowers/specs/2026-09-09-kws-ui-copy-refresh-design.md`](../../../docs/superpowers/specs/2026-09-09-kws-ui-copy-refresh-design.md)。本工件保留执行阶段所需的边界摘要，并与公开设计一致。

## 架构边界

- 继续使用 Node.js 24、CommonJS、Express、原生静态 HTML/CSS/JavaScript 和既有数据库/API facade。
- 管理员新增 `settings` 页面状态与 `moduleSettings` 显示模块；SMTP/Webhook、状态展示和 AI Copilot DOM 只移动、不复制，现有 id、事件、接口和登录预加载保持兼容。
- 知识助手仍是独立业务模块；不将知识库索引、问答、历史或自动清理复制到设置。
- 共享布局和直角冷色规则放在 `public/workstation.css`；页面只保留必要的结构和命名空间样式。

## 主要呈现变更

- AI 配置表单由单行 flex 改为桌面双列/窄屏单列网格，附加指令和提示整行；所有用户可见 `profile` 术语改为“AI 配置”，代码字段不改。
- 本人任务录入按基本信息、负责人/时间、标签/说明、公开/内部、提交操作分组。
- 项目关系视图和 Kanban 将“泳道”统一改为“分区”；项目表单和里程碑区块增加稳定间距。
- 主页公开项目由整块 `<a>` 改为 `<article>` + 仅“查看详情” `<a>`；标题/说明是文本，长文本可换行。
- 首页徽标使用 `KWS Work Hub`，知识助手问题提示使用通用问题占位文案。

## 兼容与验证

- 不改服务端路由、数据库 schema、公共 allow-list、AI 协议、通知行为或项目关系语义。
- 继续使用 `escapeHtml`/`textContent`、显式按钮 `type`、ARIA 状态、busy/错误恢复、键盘焦点和亮暗主题。
- 运行静态 UI/model 测试、变更脚本 `node --check`、`git diff --check`、`npm test`，并手工验证设置 tab、项目详情分区、公开详情入口、通用 placeholder、亮暗主题和 620px 窄屏。
