# P1-B Provider 诊断与 AI 指标实施计划

> 仅在本计划获得用户明确批准后执行 `task.py start`。实现遵循 TDD：每个行为先写失败测试、
> 运行确认失败，再写最小实现；保持一个活动任务。

## 变更清单

1. Provider/profile 基础：修正 usage null/非法值与 request id 可打印边界，扩展
   `server/ai-provider.js` 安全响应元数据；在
   `server/ai-profiles.js` 增加按 ID 的服务端 snapshot；补 `tests/ai-provider.test.js`、
   `tests/ai-profiles.test.js`。
2. 指标数据层：在 `server/db.js` 的 SQLite/MySQL/PostgreSQL schema 增加
   `ai_request_metric` 和索引，实现创建、固定聚合、过期清理；补 `tests/ai-db.test.js`。
3. 指标服务：新增 `server/ai-metrics.js`，实现白名单归一化、safe write、汇总和清理；补
   `tests/ai-metrics.test.js`，覆盖 null usage、失败不抛和有界分组。
4. 诊断服务：新增 `server/ai-diagnostics.js`，实现固定 sentinel 探针、协议 endpoint 映射、成功 DTO、
   reasoning 应用标记、错误分类和指标 finally；补 `tests/ai-diagnostics.test.js`。
5. 配置/校验/路由：在 `server/config.js` 增加 `AI_METRICS_RETENTION_DAYS`、`AI_METRICS_AUTO_CLEANUP`
   解析与 preflight；
   在 `server/validation.js` 增加诊断 ID和 metrics hours validator；在 `server/app.js` 增加
   诊断与汇总路由、独立诊断限流、审计和启动/每小时清理。
6. 主流程指标：在 `server/ai-copilot.js` 与 `server/ai-knowledge.js` 的 finally 记录
   operation 指标；现有依赖注入测试继续可运行，metrics 写入异常不改变返回值。
7. 管理 UI：在 `public/admin/index.html` 增加每个 profile 的“诊断”按钮、诊断状态区域和
   指标汇总控件；在 `public/admin/admin.js` 绑定事件并显示安全字段；在 `public/admin/ai-model.js`
   增加诊断/汇总归一化函数。所有动态值转义，按钮显式 `type="button"`，保持直角主题和窄屏布局。
8. 文档/规范：同步 `.env.example`、README、API reference、AI 运维、架构、路线图、功能状态、
   缺陷矩阵和 backend/frontend spec 的 Provider/指标契约。

## 验证顺序

```text
node --test tests/ai-provider.test.js tests/ai-profiles.test.js
node --test tests/ai-metrics.test.js tests/ai-diagnostics.test.js tests/ai-db.test.js
node --test tests/admin-ai.test.js tests/ai-profile-api.test.js tests/ai-knowledge.test.js
node --check server/ai-provider.js server/ai-profiles.js server/ai-metrics.js server/ai-diagnostics.js server/db.js server/config.js server/validation.js server/ai-copilot.js server/ai-knowledge.js server/app.js
node --check public/admin/admin.js public/admin/ai-model.js
npm test
npm audit --omit=dev --registry=https://registry.npmjs.org
git diff --check
python ./.trellis/scripts/task.py validate .trellis/tasks/08-31-p1b-provider-diagnostics-metrics
```

最后进行管理员浏览器 smoke：登录 → profile 列表诊断非 active profile → 切换 24h/7d/30d
指标并刷新 → 亮/暗主题 → 键盘焦点/激活 → 620px 窄屏；确认诊断提示真实调用可能消耗少量
token，失败不泄露正文/密钥且 active profile 未改变。

## 风险与回滚点

- Provider 元数据扩展必须保持旧调用返回字段兼容；若 stub 或真实上游契约失败，回滚只涉及
  新增元数据字段，不改现有请求体。
- SQL 聚合需在三个驱动使用相同字段/参数顺序；任何 schema/聚合失败只让指标 API 不可用，
  主流程继续成功。
- finally 指标记录不可 await 未捕获异常；safe write 必须覆盖数据库关闭/锁/大小错误。
- UI 诊断只从 profile DTO 的 ID 发起请求，绝不把 key 或完整 URL 发送到浏览器之外的接口。
