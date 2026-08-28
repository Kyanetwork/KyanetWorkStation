# Workstation 方正冷色 UI 与统一收件箱技术设计

## Boundary

本任务只修改静态前端的 HTML/CSS/JavaScript 和必要的前端文档/测试。后端现有
认证、授权、数据库表、列表 API、状态 mutation API、通知 outbox 和 MeowStatus
适配器保持不变。UI 层不得把原始数据库列或管理员私有字段暴露到公开页面。

## Architecture

继续使用 Express 静态文件 + 原生浏览器 JavaScript：

```text
public/*.html
  -> public/workstation.css (共享 token、几何、状态、响应式)
  -> page-local CSS (仅保留页面布局特例)
  -> page-local IIFE / event listeners
  -> existing /api/* envelopes
```

新增 `public/workstation.css` 作为共享入口，避免引入构建步骤。四个页面保留原有
脚本路径和稳定 DOM ID；共享样式通过语义类和现有类名工作，不建立组件框架。

## Visual system

### Tokens

亮色基准：

```text
--ws-bg: #F3F8FD
--ws-surface: #FFFFFF
--ws-text: #10233F
--ws-muted: #5F748B
--ws-border: #D5E3F0
--ws-accent: #2D8CFF
--ws-accent-strong: #0F70E6
```

暗色基准：

```text
--ws-bg: #091525
--ws-surface: #102238
--ws-text: #EAF4FF
--ws-muted: #91A8BF
--ws-border: #27445F
--ws-accent: #6BB9FF
--ws-accent-strong: #3FA1FF
```

状态色保持单一冷色系统的可读变体；危险/错误状态使用偏红但低饱和的语义色，
不增加新的品牌强调色。所有组件 `border-radius` 固定为 `0`，重点区域只使用
`::before/::after` 的短 L 角标，避免大面积切角和装饰噪声。阴影使用低不透明度
冷蓝阴影，动效只变换 `transform`/`opacity`，并尊重 `prefers-reduced-motion`。

字体使用系统优先栈（中文包含 PingFang SC、Microsoft YaHei），数据/时间区域启用
等宽或 tabular figures；标题使用较紧字距，正文限制合理行宽并保留 `text-wrap`
能力，不加载外部字体。

## Public page design

### Home

将首页组织为：顶部导航与主题按钮 → 左对齐 Hero/主行动区 → 反馈与 WorkTask
入口模块 → 公开进展与服务状态模块 → 简洁页脚。入口按钮保持真实链接；状态卡片
只展示后端安全 DTO，加载/不可用/无数据时用可见状态文本，不阻塞入口。

### Feedback and WorkTask

保留现有字段、maxlength、提交 API 和脚本。通过共享样式统一 label、输入边框、
错误/成功消息、提交中按钮和返回路径；页面专属样式只处理字段网格和时间输入在窄屏
下的排列。表单错误使用页面消息节点，不用 `alert()`。

## Admin work inbox design

### Navigation and state

在管理员模块中新增 `inbox` 作为默认 active state 和第一个导航项；反馈、WorkTask、
本人任务录入保持专项导航。登录成功和刷新当前板块都加载当前模块；退出仍清理会话
展示。URL、localStorage 不保存业务数据，仅沿用 `theme.js` 的主题偏好。

### Read path

首版不改变后端表和正常列表接口。`loadInbox` 并行调用：

```text
POST /api/admin/feedback/list  { status, keyword, page: 1, pageSize: 100 }
POST /api/admin/worktask/list  { status, priority, keyword, page: 1, pageSize: 100 }
```

页面将返回的 `items` 映射为最小安全 DTO：

```text
{ source, id, title, summary, status, priority?, updatedAt, detailFields, hasMore }
```

`source` 为 `feedback` 或 `worktask`，反馈没有 priority 时不显示该列；`updatedAt`
使用各自已有时间字段，缺失时回退到 `createdAt`，仍缺失则显示 `-`。映射后按时间
倒序，同时间以 source/id 稳定排序。若任一来源 `totalPages > 1`，列表顶部显示“仅显示
近期记录，更多请进入专项视图”，而不是声称全量。

筛选规则：来源为本地 select；状态值根据来源交集/对应字段传给各自 API；优先级只
作用于 WorkTask；关键词在两来源分别传递。筛选变化重置页面内列表并重新请求，避免
在客户端长期缓存业务数据。

### Detail and mutation path

列表条目使用 `data-source`/`data-id`，点击展开只渲染已允许字段，并复用各专项视图
已有的状态/安排/备注/回复/主页展示/删除操作函数。Mutation 成功后重新加载 inbox
或对应专项列表；失败时显示页面消息和 toast，按钮在 `finally` 恢复。动态内容在
`innerHTML` 模板中统一经 `escapeHtml`，可编辑字段继续使用 DOM value 读取并交给后端
校验。

### Low-frequency operations

SMTP/Webhook 测试、MeowStatus/Minecraft 状态设置、导出与通知 handoff 查询不从功能
上删除；布局上移入低频运维区或专项页，避免压过收件箱的处理路径。其 API、权限和
错误 envelope 不变。

## Accessibility and responsive behavior

- 每个输入保留可关联 `<label>` 或等价可见标签；状态容器保留 `aria-live="polite"`。
- 统一 `:focus-visible` 外框，不能只靠颜色表达当前项；tab 导航和内联详情按钮可
  通过 Enter/Space 操作。
- 640px 以下改为单列，工具栏允许换行，详情操作按组堆叠；不使用固定 viewport 高度，
  主容器使用 `min-height: 100dvh` 和可滚动内容。
- 动效默认短促，系统减少动效时禁用位移/渐显；角标为装饰，不承载唯一语义。

## Compatibility and rollback

- 不改变 API 请求路径、字段名、认证 cookie、数据库 schema 或 `theme.js` 存储键。
- 如果共享样式造成页面回归，可先移除各页面的 `<link>` 并恢复原内嵌样式；如果收件箱
  聚合出现数据误判，可隐藏收件箱并保留反馈/WorkTask 专项入口，后端数据不受影响。
- 若实际数据量证明首版聚合边界不可接受，另建任务设计服务端聚合/游标接口，不在本
  任务内引入第二套查询协议。

## Verification design

- 静态检查：`node --check public/theme.js public/index/main.js public/feedback/main.js
  public/worktask/main.js public/admin/admin.js`、`git diff --check`。
- 回归：`npm test`、Trellis task validate；如 Node/SQLite 环境变化导致基线失败，
  记录真实阻塞而不改写成功结论。
- 浏览器冒烟：四页亮色/暗色、640px 窄屏、键盘焦点、登录失败/成功、收件箱空/错/展
  开/操作、公开页隐私字段检查。
