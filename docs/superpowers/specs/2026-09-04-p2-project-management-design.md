# P2 项目管理基础能力设计

> 状态：待用户审阅的设计稿（2026-09-04）。实现范围以 Trellis 任务
> `.trellis/tasks/09-04-p2-project-management/` 为准；本文件不是实现批准。

## 目标与边界

在现有 Feedback、WorkTask、工作收件箱和公开进展之上，提供个人及小团队可用的轻量项目容器、
里程碑、来源归属和分层公开视图。保持 Node.js 24、Express、原生静态前端以及
SQLite/MySQL/PostgreSQL 路线，不引入新的前端框架、ORM、迁移框架或微服务。

Feedback 与 WorkTask 始终是两个独立来源和业务表；项目只是组织层。一个来源记录最多归属一个
项目，也可以未归类。只有单管理员会话模型，KyanetAccount、成员权限、子任务、依赖、完整
Kanban/甘特图和 AI 自动写操作均不在本轮。

## 已确认的产品决策

- 项目支持创建、编辑、软归档和恢复；归档不删除关系或冻结来源原生操作。
- 归档项目可查看、编辑、解绑和整理已有关系；新增里程碑或新增工作项绑定前必须恢复。
- 每个项目可有多个里程碑；里程碑可完成、排序、软撤销和恢复。撤销不计入完成度并解除工作项
  里程碑关联，恢复不会自动重绑。
- 完成度默认按有效里程碑完成数计算并四舍五入到 0–100；无有效里程碑显示“未设置”。项目级
  自定义值可覆盖自动值，关闭后恢复自动计算。
- 公共 URL 和 API 使用不可变、随机、不可枚举的 `publicKey`；内部自增 `id` 仅用于管理和关联。
- 公共基础信息、里程碑、更新时间和完成度四个开关独立控制，详情开关默认关闭；公共端永不返回
  Feedback/WorkTask 内容、联系方式、管理员字段或内部 ID。
- 管理员页面新增一级项目标签，列表和 hash 详情保留在同一静态页面；公开首页增加项目区块并链接
  独立 `/project/` 详情页。操作只做单条，成功后重新拉取详情。

## 技术架构

继续使用当前文件职责：

```text
HTTP 路由/中间件：server/app.js
输入校验：server/validation.js
SQL、schema、行映射、完成度：server/db.js
审计 allow-list：server/admin-audit-metadata.js
管理员项目模型/UI：public/admin/project-model.js、admin.js、index.html
公共项目 UI：public/project/index.html、main.js；首页由 public/index/main.js 接入
共享样式：public/workstation.css
```

`app.js` 只负责路由编排和错误/审计调用；路由不直接使用数据库驱动，所有对象投影由 `db.js`
和前端单一模型解码点生成。

## 数据模型

新增三张跨驱动等价表：

```text
project(
  id, public_key UNIQUE, name, description, status,
  public_basic, public_milestones, public_updated_at, public_completion,
  completion_mode, custom_completion, created_at, updated_at
)

project_milestone(
  id, project_id FK, title, description, target_date(YYYY-MM-DD),
  is_completed, sort_order, status(active/revoked), created_at, updated_at
)

project_item(
  id, project_id FK, source_type(feedback/worktask), source_id,
  milestone_id nullable, created_at, updated_at,
  UNIQUE(source_type, source_id)
)
```

项目 `name` 限制 1–120 个 Unicode 字符，说明最多 2000；里程碑标题最多 160、说明最多 2000、
排序值 0–100000。项目状态为 `active/archived`，公开开关默认 false，完成模式为 `auto/custom`，
自定义值为可空 0–100 整数。索引覆盖项目状态/更新时间、里程碑排序、项目来源和项目里程碑。

多态来源存在性、来源唯一归属、里程碑同项目关系由应用层校验；外键只保护项目和里程碑实体。
来源硬删除成功后清理 `project_item`，详情读取再次过滤并修复孤儿。现有 facade 没有事务 helper，
里程碑撤销的“标记撤销 → 清空关联”双写通过幂等修复和审计降低风险，不宣称跨写原子性。

## HTTP 契约

管理员接口继续要求会话；写接口还要求同源和 `application/json`：

| 路径 | 用途 |
|---|---|
| `POST /api/admin/project/list` | 状态、关键词、分页的项目摘要列表 |
| `GET /api/admin/project/item` | 来源当前项目/里程碑归属 |
| `GET /api/admin/project/:id` | 项目、里程碑和两类来源泳道详情 |
| `POST /api/admin/project/item-candidates` | 分页安全候选来源摘要 |
| `POST /api/admin/project/create` / `update` | 项目新建和部分更新 |
| `POST /api/admin/project/archive` / `restore` | 软归档和恢复 |
| `POST /api/admin/project/milestone/create` / `update` | 里程碑新建和更新 |
| `POST /api/admin/project/milestone/revoke` / `restore` | 里程碑撤销和恢复 |
| `POST /api/admin/project/item/assign` / `update` / `unassign` | 来源绑定、同项目里程碑调整、解绑 |
| `GET /api/public/projects` | 基础信息公开项目列表 |
| `GET /api/public/projects/:publicKey` | 安全公开项目详情 |

成功响应沿用 `{ok:true,data:...}`。`400 INVALID_PAYLOAD` 用于类型/长度/枚举/日期/跨字段错误，
`404 NOT_FOUND` 用于缺失资源和所有公共不可用项目，`409 PROJECT_ITEM_CONFLICT` 用于重复归属，
`409 PROJECT_MILESTONE_CONFLICT` 用于跨项目或非法里程碑，`409 PROJECT_STATE_CONFLICT` 用于归档
项目新增里程碑/绑定。其他异常沿用 `INTERNAL_ERROR`，不返回 SQL 或堆栈。

归档项目允许元数据编辑和已有关系解绑/整理；`milestone/create`、`item/assign` 在归档状态拒绝，
恢复后重试。`item/assign` 不隐式移动其他项目中的来源，移动必须先解绑。

## 投影与隐私

管理员摘要可以包含内部 `id`、`publicKey`、公开开关、完成度统计、数量、时间和里程碑；来源
摘要只允许来源类型/ID、标题、类型、原生状态、必要的 WorkTask 优先级/负责人/计划时间、更新时间
和里程碑 ID。禁止正文、联系方式、图片、管理员备注、账号快照和 provider 字段。

公共列表只返回 `publicKey`、名称、说明。公共详情基础字段总是返回；仅在开关开启时加入有效里程碑、
更新时间或 `completion:{value}`；关闭字段直接省略。公共查询只匹配 active 且基础信息公开的项目，
归档、未公开和不存在统一 404，不能枚举项目存在性。

## 页面设计

- 管理员 `项目` 标签默认展示活跃列表，支持全部/活跃/已归档、关键词和分页；hash 使用
  `#projects`、`#projects/<id>`。详情由元数据/公开设置、里程碑、Feedback 泳道和 WorkTask 泳道
 组成。动态 `/:id` 路由必须在静态子路径之后注册。
- 候选工作项按来源和关键词分页；已归属其他项目的项显示禁用及“先解绑”提示。写入成功后重新
  `GET` 详情，冲突保留表单并给出可执行提示。
- 首页项目区块在无数据时隐藏；卡片只显示转义后的名称/说明和 `publicKey` 链接。
- 独立 `/project/` 页面按字段存在性渲染安全详情；404 显示统一“项目暂不可用”，其他错误可重试。
- 页面复用 `theme.js` 和 `workstation.css`，保持直角、冷色、亮暗主题、中文换行、窄屏和键盘焦点。

## 审计、发布和回滚

记录 `project.*`、`project.milestone.*`、`project.item.*` 动作，metadata 只保留 ID、来源类型/ID、
变更字段、公开开关、计数、状态和结果，不记录自由文本、URL、密钥或完整请求体。初始化通过三驱动
`CREATE TABLE/INDEX IF NOT EXISTS` 增量建表；不修改旧来源表，不引入 migration runner。发布顺序为
备份、同步代码、启动初始化、管理员/API/浏览器冒烟；回滚旧代码只会忽略新表，不执行删表或数据清空。

## 验证

- 校验和数据库测试覆盖 Unicode 长度、跨字段组合、三表 CRUD、public key、单项目归属、同项目里程碑、
  完成度切换、撤销清关联、孤儿修复和旧库增量启动。
- HTTP 测试覆盖会话/同源/JSON、400/404/409、公共字段缺失和隐私 allow-list；现有提交、通知、AI、
  收件箱和公开 highlights 测试必须保持通过。
- 前端静态/模型测试和浏览器冒烟覆盖 hash、来源泳道、重读、亮暗主题、窄屏、键盘、公开卡片、详情
  开关和错误页。发布前执行 `node --check`、`npm test`、`npm audit --omit=dev`、`git diff --check`
  和 Trellis check。
