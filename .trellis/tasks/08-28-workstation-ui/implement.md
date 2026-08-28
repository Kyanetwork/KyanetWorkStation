# Workstation UI 与统一收件箱实施计划

## 完成定义

- 四个页面共享同一套冷色亮/暗 token 和方框几何，页面专属 CSS 不再覆盖出圆角或
  模板化渐变。
- 管理员登录后默认进入收件箱；反馈与 WorkTask 记录可合并、筛选、倒序浏览并内联
  展开，原有 mutation 和低频运维操作仍可用。
- 公开页面不泄露管理员/账号字段，空、加载、错误、焦点、窄屏和减少动效状态都有
  可验证表现。
- 静态检查、自动测试、Trellis 校验和手工浏览器证据齐全。

## 0. 启动前检查

- [x] 运行 `python ./.trellis/scripts/get_context.py --mode phase --step 2.1 --platform codex`，
      复核当前任务、父任务和前端规范。
- [x] 执行 `python ./.trellis/scripts/task.py start .trellis/tasks/08-28-workstation-ui`
      前确认用户已批准本计划；保存干净 Git 状态和当前测试基线。
- [x] 再次搜索四页现有 DOM ID、表单字段、data-action、API 路径和 `border-radius`，
      形成改动边界，避免只为视觉重构破坏行为。

## 1. 共享视觉系统

**预期文件：** `public/workstation.css`、四个 `public/*/index.html`、必要时
`public/theme.js`（仅兼容已有主题事件）。

- [x] 新增共享 CSS：token、字体栈、容器/网格、矩形控件、焦点环、状态消息、加载/空
      /错误状态、响应式和 reduced-motion。
- [x] 在首页、反馈、WorkTask、admin 页面按统一顺序加载共享 CSS；页面内样式仅保留
      独有布局，确保共享规则不会被后加载样式重新圆角化。
- [x] 移除/覆盖圆角、胶囊、过重阴影、过度渐变和不一致灰色；加入少量 L 角标，不用
      大量 `clip-path`。
- [x] 用 `rg` 检查变更后的四页不存在组件级 `border-radius`，检查所有主题文字和
      状态色在亮暗模式有足够对比度。

## 2. 首页、反馈、WorkTask

**预期文件：** `public/index.html`、`public/index/main.js`、`public/feedback/index.html`、
`public/feedback/main.js`、`public/worktask/index.html`、`public/worktask/main.js`。

- [x] 重排首页 Hero、入口、公开进展、服务状态和页脚；保留真实链接和现有公开 DTO。
- [x] 统一反馈/WorkTask 表单 label、字段分组、提交中、成功、失败和返回路径；不改变
      payload、maxlength、API 或后端验证。
- [x] 核对动态文本转义、外部 favicon 轻量校验、状态不可用和无数据空状态。

## 3. 管理员收件箱

**预期文件：** `public/admin/index.html`、`public/admin/admin.js`，必要时
`docs/api/reference.md`（仅记录已存在或最小新增只读契约）。

- [x] 增加 `tabInbox`/`moduleInbox` DOM 契约，初始化 `state.active = "inbox"`，
      登录成功后默认加载收件箱；专项 tab 仍可切换。
- [x] 实现并行加载两类管理员列表 API、最小安全 DTO 映射、稳定时间排序、来源/状态/
      优先级/关键词筛选和近期数据边界提示。
- [x] 实现统一条目渲染、内联详情展开、键盘操作和空/错/加载状态；所有动态值经
      `escapeHtml` 或 `textContent`。
- [x] 复用现有 mutation handler；成功刷新服务端投影，失败恢复按钮并显示消息。保留
      导出、状态设置、通知 handoff、SMTP/Webhook 测试等低频入口。
- [x] 检查管理员登录失败、会话失效、退出和刷新路径，确保默认入口不会绕过授权。

## 4. 状态与可访问性收尾

- [x] 四页检查 `aria-live`、标签关联、`:focus-visible`、Enter/Space、tab 顺序和
      reduced-motion。
- [x] 在宽屏与约 640px 窄屏检查工具栏换行、详情展开、时间输入、toast 和页脚；禁止
      横向滚动和固定 `100vh` 高度。
- [x] 进行亮色/暗色视觉对照，校准中文字体 fallback、长标题、长反馈内容和错误文本。

## 5. 自动化与手工验证

- [x] `node --check public/theme.js public/index/main.js public/feedback/main.js public/worktask/main.js public/admin/inbox-model.js public/admin/admin.js tests/admin-inbox.test.js tests/runtime-compatibility.test.js`
- [x] `npm test`（69/69）
- [x] Node 24 原生依赖回归：`npm ci --omit=dev --foreground-scripts`、内存 SQLite 加载、管理员登录/API 冒烟；`better-sqlite3` 版本与锁文件保持 `^13.0.3`
- [x] `npm audit --omit=dev --registry=https://registry.npmjs.org`
- [x] `git diff --check`
- [x] `python ./.trellis/scripts/task.py validate .trellis/tasks/08-28-workstation-ui`
- [x] 浏览器手工记录：四页亮/暗主题、窄屏、键盘焦点、提交成功/失败、管理员登录
      后收件箱、筛选/排序/展开/处理、空/错误/接口失败，以及公开页无私有字段。

### 2026-08-28 验证记录

- Node `v24.19.0`、npm `12.0.2`、ABI `137`；`better-sqlite3` `13.0.3` 原生探针和
  全量测试通过，审计结果为 0 vulnerabilities。
- Playwright 640px 检查首页、反馈、WorkTask、管理员页：四页均加载
  `/workstation.css`，`document.body.scrollWidth` 等于 viewport 宽度，组件计算
  `border-radius` 全部为 `0px`；主题切换和 Tab 焦点可用。
- 未登录管理员页的唯一控制台错误为预期的 `/api/admin/me` 401 探测；未执行会写入
  真实业务数据的浏览器操作。

## 6. 回滚点与停止条件

| 回滚点 | 触发条件 | 动作 |
|---|---|---|
| U0 shared CSS | 主题/布局或无障碍回归 | 恢复页面样式链接和必要内嵌样式，保留脚本契约 |
| U1 inbox | 合并字段误判、越权或 mutation 重复 | 隐藏 inbox 默认入口，恢复专项 tab，保留数据和 API |
| U2 public pages | 公开页面出现私有字段或状态请求阻塞 | 回滚页面结构改动，只保留已验证的样式 token |
| U3 quality gate | 自动测试/手工冒烟失败 | 停止提交与部署，定位后按对应回滚点处理 |

任何需要新增依赖、修改生产配置、读取真实凭据、改变 Account/数据库 schema 或删除
工作区外文件的情况，都暂停并重新取得用户批准。
