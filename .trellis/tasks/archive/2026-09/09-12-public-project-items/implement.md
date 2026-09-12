# 公开项目工作项展示：实施计划

## 1. 计划顺序

1. **数据层 schema/迁移**
   - 三驱动项目表加入 `public_items` 与 `public_visible`，实现旧数据库幂等补列。
   - 更新项目/关系 row mapper、CRUD、绑定默认值和公共安全查询。
   - 验证：先运行 `tests/project-db.test.js` 的新增/聚焦用例。

2. **校验、管理员 API 与审计**
   - 扩展项目创建/更新公开字段校验和导出。
   - 新增工作项公开状态校验、数据层更新函数、管理员路由和脱敏审计。
   - 验证：`tests/project-validation.test.js`、`tests/project-api.test.js` 聚焦用例。

3. **管理员前端**
   - 更新项目模型、创建/编辑公开设置、关系项逐条公开复选框与保存动作。
   - 保持里程碑/Kanban 行为不变，保存后重读项目详情。
   - 验证：`tests/project-model.test.js`、`tests/project-static-ui.test.js` 与 `node --check public/admin/admin.js public/admin/project-model.js`。

4. **公共详情页**
   - 增加公开工作项两个来源分区、状态中文化、更新时间和可选公开回复。
   - 总开关关闭时隐藏/不渲染工作项字段；开启但为空时展示安全空状态。
   - 验证：公共 API allow-list 测试、静态 UI 契约、`node --check public/project/main.js`。

5. **文档与规格同步**
   - 更新 `docs/api/reference.md`、`.trellis/spec/backend/project-management.md` 及必要的前端规范说明。
   - 搜索旧的“公共详情不返回工作项”表述，避免契约冲突。

6. **全量检查**
   - `node --check server/db.js server/validation.js server/app.js server/admin-audit-metadata.js public/admin/admin.js public/admin/project-model.js public/project/main.js`
   - `npm test`
   - `git diff --check`
   - 人工检查公共 DTO 与 DOM 不出现敏感字段，并确认默认关闭的旧项目行为。

## 2. 变更文件边界

- 必改：`server/db.js`、`server/validation.js`、`server/app.js`、`server/admin-audit-metadata.js`。
- 必改：`public/admin/index.html`、`public/admin/admin.js`、`public/admin/project-model.js`、`public/project/index.html`、`public/project/main.js`、`public/workstation.css`（仅新增所需方框布局样式）。
- 必改测试：现有项目 DB/API/validation/model/static 测试，必要时新增单独迁移/公共投影用例。
- 必改文档：`docs/api/reference.md`、`.trellis/spec/backend/project-management.md`；若前端新增稳定 DOM 契约，再补充对应前端规范。

## 3. 风险与回滚点

- **数据库兼容**：旧实例缺列会在启动兼容步骤补列；若迁移失败，应保留日志并停止启动，不删除旧数据。
- **公共泄露**：公共查询必须保持显式列 allow-list；新增测试断言正文、联系方式、管理员字段、账号快照和各类 ID 均缺失。
- **前端误操作**：公开状态单独保存并在成功后重读；项目总开关关闭不清除逐条配置，便于恢复。
- **回滚**：代码回滚可安全忽略新增列；若需要禁用功能，将所有项目总开关保持 false，不执行列删除。

## 4. 完成定义

- 任务 PRD、设计和计划与实现一致，无未决产品选择。
- 所有聚焦和完整测试通过，公共/管理员跨层字段契约一致。
- 文档不再声称公共项目永远不返回工作项，而是准确描述总开关和逐条公开规则。
