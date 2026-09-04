# P2 项目管理数据模型研究

## 当前代码约束

- `server/db.js` 在 `sqliteSchemaStatements()`、`mysqlSchemaStatements()` 和
  `postgresSchemaStatements()` 中维护三套等价 schema，并在 `initializeDatabase()` 中统一初始化。
- 既有增量变更通过 `columnExists()`、`tableExists()` 和 `indexExists()` 做启动时幂等补齐；没有独立
  的 migration runner。
- Feedback 与 WorkTask 是独立表，管理员接口分别位于 `/api/admin/feedback/*` 和
  `/api/admin/worktask/*`；公开首页由 `getHomeHighlights()` 返回最小 DTO。
- 当前工作收件箱在 `public/admin/inbox-model.js` 中合并两个来源的读取结果，但保留 `source`、
  原始状态和来源特有字段。
- 数据库 facade 通过 `placeholder()` 适配 SQLite/MySQL/PostgreSQL 占位符；新增表和查询必须沿用
  这个边界，不能直接依赖某一个驱动的语法。

## 候选关系模型

### 方案 A：给 Feedback/WorkTask 直接增加 `project_id` / `milestone_id`

优点：查询直观、关联唯一性由列天然表达，首版实现量小。

缺点：项目领域字段直接侵入两个来源表；每个新增关系都要对三套旧 schema 做增量迁移；未来接入
  其他来源需要继续修改既有业务表。公开/归档语义也容易与来源表的更新时间耦合。

### 方案 B：建立多态 `project_item` 关联表

关联表保存 `project_id`、`source_type`、`source_id`、可选 `milestone_id` 和时间字段；应用层验证
  source id 存在且项目/里程碑归属一致，并通过唯一约束保证一个来源记录最多属于一个项目、一个里程碑。

优点：符合 A+ 的“项目是组织层、来源表保持独立”；未来可以接入其他来源，不重复改旧表；项目
  归档、公开 DTO 和关系审计边界清晰。

缺点：跨表外键无法完全由数据库表达，删除来源记录后需要应用层清理孤儿关系；查询和三数据库
  schema 稍复杂，需要明确索引和一致性检查。

### 方案 C：分别建立 `project_feedback` 与 `project_worktask` 两张关联表

每张表都可对来源表建立外键，里程碑关系另行保存。

优点：数据库引用完整，来源边界最强。

缺点：关系读写、迁移、统计和审计重复两套；增加第三种来源时继续复制表；对当前个人/小团队规模
  属于过度结构化。

## 初步建议

采用方案 B，但把关联表限制为首版明确的两个 `source_type`（`feedback`、`worktask`），在应用层
  做存在性、单项目归属、同项目里程碑和删除清理校验。项目实体、里程碑实体和公开设置保持独立，
  便于不改变 Feedback/WorkTask 的原始状态和公开字段。

## 需要在设计中明确

- 关联表的唯一约束、索引和孤儿清理策略。
- 归档项目是否仍可被管理员查询、恢复后关系是否原样恢复。
- 公开 DTO 只从项目/里程碑表读取安全字段，不 join 反馈正文、联系方式、管理员备注或内部 ID。
- 自动完成度使用里程碑完成标记；自定义完成度只存项目级覆盖值。
- 三数据库新增表的类型、布尔值、时间值和 `RETURNING` 兼容方式。
