# P2 Kanban 基础能力技术设计

详细设计与用户审阅版本：[`docs/superpowers/specs/2026-09-04-p2-kanban-foundation-design.md`](../../../docs/superpowers/specs/2026-09-04-p2-kanban-foundation-design.md)。本工件保留执行所需的边界摘要，和公开设计保持一致。

## 架构边界

- 继续使用 Node.js 24、CommonJS、Express、原生静态 HTML/CSS/JavaScript 和 `server/db.js` 三驱动 facade。
- 读取复用 `GET /api/admin/project/:id` 的安全项目详情 DTO；前端按来源类型和原生状态分组，不新增独立 Kanban 查询接口。
- 新增 `POST /api/admin/project/item/status`，服务端校验项目为 active、来源当前属于项目、状态属于对应来源集合，再更新原始 Feedback/WorkTask。
- Kanban 状态实际变化后更新项目 `updated_at`；同值保存成功但不重复更新时间。里程碑关联、完成度计算和来源表字段语义不变。
- 不新增 schema 字段、ORM、migration runner、事务基础设施或前端运行时。

## HTTP 与数据流

请求体为 `{ projectId, sourceType, sourceId, status }`。状态集合为：Feedback 的
`new/reviewed/resolved/notplanned`，WorkTask 的 `new/scheduled/in_progress/completed/cancelled`。

请求链路：管理员会话/同源/JSON/限流 → 组合校验 → 项目和 `project_item` 归属检查 → 来源状态更新 → 项目时间更新 → 脱敏审计 → 前端重新读取项目详情。

错误使用现有 envelope：参数错误 400 `INVALID_PAYLOAD`；项目、来源或关系不存在 404 `NOT_FOUND`；归档项目 409 `PROJECT_STATE_CONFLICT`；来源属于其他项目或项目不匹配 409 `PROJECT_ITEM_CONFLICT`。

审计动作固定为 `project.item.status`，实体为 `project_item`，metadata 只保存项目 ID、来源类型/ID、状态和稳定错误码。

## 管理端交互

- 项目详情增加 `relations`（默认）/`kanban` 切换；关系视图继续绑定、解绑和调整里程碑。
- Kanban 渲染两条独立泳道及各自原生状态列，列内按 `updatedAt DESC, id DESC` 排序。
- 卡片只显示来源类型、标题、状态、更新时间和 WorkTask 必要摘要；不显示正文、联系方式、备注、账号快照或内部 ID。
- 卡片使用状态下拉框和明确保存按钮；归档项目控件禁用，失败保留选择，成功重新读取详情并保留 Kanban 视图。
- 样式继续直角冷色、亮暗主题、窄屏可读和键盘可访问，不依赖拖拽。

## 兼容、隐私与回滚

- 公共项目 API/页面、AI、通知、MeowStatus 和 KyanetAccount 不增加 Kanban 数据或副作用。
- 旧项目、无工作项项目、归档项目和撤销里程碑项目可读；旧数据库无需迁移或降级。
- 现有普通来源状态接口保持兼容；新增接口仅增加项目范围保护。
- 单实例 facade 按现有“关系校验 → 来源更新 → 项目时间更新”顺序执行，不宣称跨驱动强事务；多实例事务另立任务。

## 验证

- 数据层、API、前端模型和静态 UI 测试覆盖成功、同值、跨项目、归档、缺失资源、审计和字段安全。
- 运行 `npm test`、变更 JavaScript `node --check`、`git diff --check` 和 Trellis 校验。
- 发布按备份 → 同步 → 安装/测试 → PM2 重启 → health → 管理员 Kanban 冒烟 → 证据记录；失败时仅回滚代码，保留新增表。
