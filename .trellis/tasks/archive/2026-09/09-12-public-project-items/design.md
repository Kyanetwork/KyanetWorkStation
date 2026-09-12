# 公开项目工作项展示：技术设计

## 1. 边界与目标

本任务只补齐“项目详情页展示经过授权的 Feedback/WorkTask 摘要”这条跨层链路：数据库保存两个公开控制字段，管理员可以配置它们，公共 API 生成独立安全投影，公开页按来源类型渲染两个分区。

不改变首页 `showOnHome`，不把公共请求转发到管理员详情，不公开正文、联系方式、管理员备注、账号快照、内部 ID 或 Kanban/里程碑关系。

## 2. 数据模型与兼容迁移

### 2.1 字段

- `project.public_items`：项目级总开关，三种数据库均为非空布尔/整数，默认关闭。
- `project_item.public_visible`：关系级开关，三种数据库均为非空布尔/整数，默认关闭。

新增字段同时写入 `sqliteSchemaStatements()`、`mysqlSchemaStatements()` 和 `postgresSchemaStatements()`。`ensureProjectSchema()` 在创建/检查项目表后调用幂等兼容步骤：先用 `columnExists` 检查，再按驱动执行 `ALTER TABLE ... ADD COLUMN`；DDL 失败后重新检查同一列，仅在列已被并发初始化器创建时吞掉错误。旧项目和旧关系因此保持不公开且不丢数据。

## 3. 数据流与接口契约

### 3.1 管理员读取与写入

1. `GET /api/admin/project/:id` 的项目 DTO 增加 `publicItems`，关系项 DTO 增加 `publicVisible`。
2. `POST /api/admin/project/create` 与 `POST /api/admin/project/update` 接受 `publicItems`；校验器沿用现有布尔字段规则，创建缺省为 `false`。
3. 新增 `POST /api/admin/project/item/visibility`，请求体为：

   ```json
   {
     "projectId": 1,
     "sourceType": "feedback",
     "sourceId": 2,
     "publicVisible": true
   }
   ```

   路由先校验项目 ID、来源类型/ID 和布尔值，再调用数据层。数据层确认关系属于项目后更新 `project_item.public_visible`；同值保存不改变项目时间，值发生变化时同步触碰项目 `updated_at`，返回项目/来源标识、保存后的状态和 `projectUpdatedAt`。归档项目仍不进入公共投影，但可以保留管理员预配置的逐条状态。

4. 该写请求使用现有管理员会话、同源、JSON 和限流中间件，审计动作固定为 `project.item.visibility`。审计只保留 `projectId`、`sourceType`、`sourceId`、`publicVisible`、稳定错误码等白名单字段。

### 3.2 公共读取

`GET /api/public/projects/:publicKey` 仍要求项目 active 且基础信息公开。项目级 `public_items` 为 `false` 时保持旧响应形状：不包含 `items` 字段。开启后，数据层分别从 `feedback` 和 `worktask` 与 `project_item` 做安全列查询，只匹配 `public_visible = true` 的关系，按来源 `updated_at DESC, id DESC` 排序，并组合为：

```json
{
  "items": {
    "feedback": [
      { "sourceType": "feedback", "title": "...", "status": "reviewed", "publicReply": "...", "updatedAt": "..." }
    ],
    "worktask": []
  }
}
```

`publicReply` 为空时省略；标题、状态、回复和时间均经过长度/空值归一化。查询只选择上述公开列，不读取正文、联系方式、管理员备注、账号快照、关系 ID 或里程碑 ID。来源记录已删除时自然不会进入 JOIN 结果，公共读取不执行清理写入。

## 4. 管理员界面

- 项目创建表单和编辑表单的“公开设置”增加“工作项”复选框。
- 关系视图的 Feedback/WorkTask 分区每条关系增加“公开此项”复选框和独立“保存公开状态”按钮；里程碑保存按钮继续只处理里程碑。
- 保存成功后沿用现有 `reloadProjectDetail()` 重读详情，避免前端状态与数据库脱节；默认新绑定项显示为未公开。
- 公开项目页在现有完成度/里程碑面板之后增加“公开反馈”和“公开 WorkTask”两个方正分区，显示标题、中文状态、更新时间和可选公开回复；无条目时显示空状态。所有外部值用 `textContent` 或既有转义函数写入。

## 5. 兼容性、错误与回滚

- 未开启总开关的项目与现有公共 API/页面完全兼容；旧客户端不会看到新字段。
- 管理端输入错误返回现有 `400 INVALID_PAYLOAD`；不存在的项目/关系返回 `404 NOT_FOUND`；跨项目关系返回 `409 PROJECT_ITEM_CONFLICT`，沿用现有错误映射。
- 关闭总开关或归档项目立即使公共页不再返回工作项；逐条标记保留，恢复项目/重新开启总开关后按原配置生效。
- 回滚代码时保留新增列和数据，旧代码会忽略这些列；不执行破坏性降级或删除。

## 6. 验证策略

- 校验器：`publicItems` 默认/非法值、`publicVisible` 合法与非法 payload。
- 数据库：三驱动 schema 声明；旧 SQLite 缺列初始化迁移与幂等；总开关、逐条开关、默认关闭、来源删除、排序、同值时间保持和安全字段 allow-list。
- API：管理员会话保护、创建/更新公开设置、逐条公开接口、审计脱敏、公共响应在开关前后字段差异和无内部字段。
- 前端：模型默认值、管理员控件/动作、公共页两分区、状态文案、空状态、亮暗主题/窄屏静态契约。
- 发布门槛：变更 JS `node --check`，聚焦 Node 测试，完整 `npm test`，`git diff --check`；部署后再由用户执行管理员配置与公共页冒烟。
