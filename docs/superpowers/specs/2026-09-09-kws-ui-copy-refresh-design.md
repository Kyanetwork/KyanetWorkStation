# KWS UI 与文案整理设计

## 1. 目标与已确认决策

本次迭代只整理现有页面的信息架构、布局、视觉层级和用户可见文案。Node.js + Express、静态 HTML/CSS/JavaScript、数据库、API、会话权限、公共隐私投影和 AI Provider 边界均保持不变。

已确认的产品决策：

- 管理员导航保留“工作收件箱 → 反馈 → WorkTask → 本人任务录入 → 项目 → 知识助手”，在末尾增加“设置”。
- SMTP/Webhook 测试、MeowStatus、Minecraft 展示、AI Copilot 配置/诊断/指标集中到“设置”选项卡；知识库索引、知识问答和问答历史仍属于“知识助手”。
- 公开项目使用分隔列表。项目名称和说明是普通文本，只有“查看详情”作为公开详情链接，不使用整块卡片链接或默认下划线。
- 项目详情和 Kanban 中的“Feedback 泳道”“WorkTask 泳道”改为“反馈分区”“WorkTask 分区”；交付说明会记录原词和替换词。
- 首页徽标“`KWS Simple Entry`”改为“`KWS Work Hub`”。知识助手问题提示改为通用提问提示。
- 用户可见的 `profile` 统一称为“AI 配置”（如“当前 AI 配置”“编辑 AI 配置”“删除 AI 配置”）；API、DOM id、数据库字段和代码变量继续保留 `profile`/`profileId`。

## 2. 页面与模块边界

### 2.1 管理员页面

`public/admin/index.html` 保留登录卡片、登录状态/刷新/退出工具栏和全局提示。现有顶部常驻设置 DOM 移入新的 `moduleSettings`：

```text
业务标签页
  工作收件箱 | 反馈管理 | WorkTask 管理 | 本人任务录入 | 项目 | 知识助手 | 设置

设置模块
  通知测试
    SMTP 测试收件人、SMTP 测试按钮、结果提示
    Webhook 附加内容、Webhook 测试按钮、结果提示
  状态展示
    MeowStatus 开关 / 地址 / 超时 / 保存
    Minecraft 展示开关 / 保存
  AI Copilot
    AI 配置表单
    已保存 AI 配置列表
    Provider 真实诊断
    AI 请求指标
```

只移动 DOM，不复制现有 id。`admin.js` 继续调用现有 `/api/admin/notify/*`、`/api/admin/status/settings`、`/api/admin/ai/*` 接口；登录和刷新时的预加载行为保持不变，选项卡切换只控制模块可见性。`state.active` 增加 `settings` 分支，登出时沿用现有清理逻辑。

### 2.2 AI 配置表单

现有 `.toolbar` 单行布局改为专用网格容器（例如 `.ai-profile-form`），输入字段和标签保持原 id 与 payload：

```text
名称                 协议
Base URL             模型
推理强度             API Key
附加工作指令（整行）
协议提示（整行）
保存配置 / 清空表单
```

桌面端使用两列 `minmax(0, 1fr)`，字段不会按内容无限扩张；附加指令、提示和操作区整行。窄屏在 760px 左右切换为单列。配置列表、诊断和指标分别使用独立区块，状态文案只显示“AI 配置”而不显示裸 `profile`/`active profile`。

### 2.3 本人任务录入

`moduleWorktaskCreate` 继续使用现有字段和 `createWorktaskByAdmin` payload，HTML 只增加语义分组和布局类：

```text
任务基本信息：类型、优先级、状态、主页展示、标题
负责人和时间：负责人、期望时间、计划时间
标签与说明：标签、任务详细说明
公开与内部：对外回复、管理员备注
提交操作：创建本人任务、重置表单、状态提示
```

字段仍由浏览器读取，服务端仍是最终校验者，不新增表单状态或 API 字段。

## 3. 项目与公开页面呈现

### 3.1 管理员项目详情

`public/workstation.css` 为项目详情增加/调整以下层级：项目元数据表单、公开设置 fieldset、完成度控制、视图切换、里程碑新增和工作项分区之间使用统一间距和边框。桌面端优先保持两列，字段宽度使用 `minmax(0, 1fr)`；长说明和 textarea 整行；窄屏切换单列，不依靠裁剪。

`public/admin/index.html` 的关系视图标题和按钮改为：

- `Feedback 泳道` → `反馈分区`，`添加 Feedback` → `添加反馈`；
- `WorkTask 泳道` → `WorkTask 分区`，`添加 WorkTask` 保持产品名但与分区标题统一；
- Kanban 由 `admin.js` 动态渲染的 `<来源> 泳道` → `<来源> 分区`。

来源仍然分开归类，状态集合、绑定/解绑、里程碑关联和状态保存调用不变。

### 3.2 主页公开项目

`public/index/main.js` 的 `renderPublicProjects` 从“整张 `<a>` 卡片”改为语义 `<article>`：

- 项目名称由 `h3`/文本节点承载，不设置 `href`；
- 说明由普通 `p` 承载，使用 `overflow-wrap:anywhere`；
- 仅创建一个 `.project-home-card-action` 的 `<a>`，href 仍为编码后的 `/project/?key=...`，带 `aria-label`、焦点样式和无下划线视觉；
- 列表项用边框、左侧冷色强调线和间距形成明确分隔；桌面端可两列，窄屏单列。

不改变 `/api/public/projects` 的数据投影，也不把项目详细内容、工作项或内部字段加入主页。

### 3.3 公开项目详情

`public/project/index.html` 和 `main.js` 的公开字段、完成度、里程碑和更新时间开关保持不变，只修正共享间距、标题换行和面板层级。公共页面仍不渲染工作项、Kanban、内部 ID、正文、联系方式或管理员字段。

## 4. 视觉与可访问性约束

- 继续使用 `public/workstation.css` 的冷色变量、直角边框、亮/暗 `data-theme`、共享 focus ring 和响应式断点；不引入圆角、CSS 框架或构建步骤。
- 共享样式优先，管理员/主页 HTML 内只保留必要的页面特有规则；新选择器使用页面命名空间，避免影响反馈和 WorkTask 公共提交页。
- 所有静态和动态按钮保留显式 `type`；设置、项目和任务控件保留标签、`aria-controls`/`aria-selected`/`aria-pressed` 与 `aria-live`。
- 动态 API 字段继续使用 `escapeHtml` 或 `textContent`；项目详情入口只对安全的公开 key 做 URL 编码；不引入新的浏览器存储。
- 长中文、英文和混合字符串使用 `overflow-wrap:anywhere` 或等价规则；不以 `white-space:nowrap` 约束标题/说明。

## 5. 数据流、兼容与回滚

页面数据流不变：浏览器页面 → 现有管理员/公共 API → 现有 DTO/模型 → DOM 渲染。设置布局移动不会改变会话、请求顺序或错误 envelope；AI 配置的用户可见文案改变不影响后端 `profile` 字段。

本次不修改数据库和服务端代码。若 UI 冒烟失败，可单独回滚 HTML/CSS/JS 的本次提交；不会触发数据迁移、外部通知、AI Provider 请求或公共权限变化。

## 6. 验证设计

自动检查：

1. `tests/admin-ui-model.test.js`、`tests/project-static-ui.test.js` 及受影响的模型测试；必要时增加“设置 tab/模块、AI 配置文案、项目详情按钮语义、分区术语”的静态断言。
2. 变更 JavaScript 运行 `node --check public/admin/admin.js public/index/main.js public/project/main.js`（以及实际变更的其他脚本）。
3. `git diff --check`，再按项目基线运行 `npm test`；如遇 better-sqlite3 ABI 阻塞，记录真实输出，不将其误报为 UI 通过。

手工冒烟：

- 管理员登录后确认设置内容只在“设置”显示，切换六个业务模块不重复出现；SMTP/Webhook 不实际发送测试消息；AI 配置字段、保存按钮文案、列表和诊断入口可见。
- 打开项目详情，确认“反馈分区”“WorkTask 分区”、公开设置、完成度、里程碑和关系/Kanban 切换可读；不执行状态写入。
- 主页确认项目名称/说明不可点击且无下划线，只有“查看详情”可导航；检查长标题、长说明、空列表和公开 key 编码。
- 检查知识助手通用 placeholder、`KWS Work Hub`、亮/暗主题、Tab 焦点和约 620px 窄屏无水平溢出。
