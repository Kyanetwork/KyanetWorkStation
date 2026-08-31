# AI Copilot 参数、知识助手与方正 UI 设计

> 状态：已获用户批准的设计稿（2026-08-31）。实现范围以 Trellis 任务
> `.trellis/tasks/08-31-p1-ai-enhancement-ui/` 为准。

## 目标与边界

本轮在现有 Node.js 24、Express 和静态 HTML/CSS/JavaScript 架构上，增加
profile 级 `reasoning_effort`、受控工作指令、本地 Markdown/TXT 知识库问答、
引用与历史留存/清理，并统一所有按钮为冷色 HUD、方框直角风格。Provider 诊断、
指标、prompt 对比、批量操作、自动路由/fallback 和 KyanetAccount 联动留到后续
P1-B 任务。

## 已确认的产品决策

- 知识库由云服务器上的受控只读目录提供；开发机与生产机分别配置路径。
- 首版支持 `.md`、`.txt`，通过管理员按钮或 CLI 手动重建索引，不在启动时扫描、
  不做常驻文件监听。
- 知识助手是管理员面板独立标签；默认跨所有配置库检索，也可按库筛选。
- 文档无充分命中时允许使用模型基础知识，但必须标注“非文档依据/未验证”。
- 完整问答与引用保存，默认保留 30 天；保留期可由环境变量在安全范围内调整。
- 自动清理有独立管理员开关，默认开启；启动一次、之后每小时执行，关闭时仍可
  手动清理和单条删除。
- `reasoning_effort` 取 `low/medium/high/xhigh/max` 或未设置；本轮仅映射到
  OpenAI Responses，Chat/Anthropic 不发送，后续能力诊断后再扩展。
- 系统安全 prompt 固定；profile 可增加有限长度的工作指令/风格补充，不能覆盖
  脱敏和不可信数据边界。
- UI 不使用圆角；保留亮暗主题、焦点、键盘可用性、窄屏适配和清晰中文文字。

## 组件与数据流

```text
外部只读目录
  → 显式扫描/分块/哈希
  → data/ai-knowledge-index.json（原子替换）
  → 关键词检索（全部库或单库）
  → 固定知识 prompt + 受控工作指令
  → active profile Provider
  → 严格答案 JSON + 服务端映射引用
  → 管理员页面与 ai_knowledge_answer 历史表
```

Provider、知识索引、问答编排、数据库和 UI 各自保持独立边界。知识库模块不写入
原始目录；回答不能修改业务表、发送通知或执行命令。

## 配置与安全契约

使用 `AI_KNOWLEDGE_BASE_DIRS` JSON 数组配置根目录 ID、显示名和绝对路径；页面只
显示 ID/名称和相对路径。应用只读取 `.md/.txt`，跳过隐藏/运行目录，校验
`realpath` 防止越界软链接，限制根目录、文件、单文件和总索引大小。缓存不进 Git，
不经 API 返回。

Profile 新增 `reasoningEffort` 和 `promptInstruction`，旧 profile 缺字段时按空值
处理。Responses 请求将 `reasoningEffort` 映射为 `reasoning.effort`；空值或不适用
协议完全省略。固定安全 prompt 先于 `<admin-instruction>`，问题和文档片段各自置于
不可信边界。历史和索引只记录/返回必要的有界内容，不记录 API Key、完整 prompt、
绝对路径或未选中文档。

## API 与持久化

新增知识状态、重建、提问、历史查询、单条删除、过期清理和自动清理设置接口，全部
沿用管理员会话、CSRF、限流、统一错误 envelope 和审计。问答回答固定为：

```json
{
  "answer": "...",
  "basis": "document | mixed | general",
  "citedSourceIds": ["s1"],
  "caveats": "..."
}
```

来源 ID 由服务端生成和映射；无命中时强制 `general`。数据库增加跨三种驱动兼容的
`ai_knowledge_answer` 表和 `ai_knowledge_settings` 设置 JSON。问答记录带创建/过期
时间、profile、模型、用量和 prompt 版本；自动清理由启动 + 每小时 worker 控制，
过期记录不再参与问答，关闭自动清理不影响手动删除。

## UI 与验证

管理员新增“知识助手”标签，按索引状态、提问、回答/引用、历史四段布局；根目录选择
只显示名称。共享 CSS 统一原生 button、分页、AI 动作、登录、工具栏和表单按钮，覆盖
主次/危险、hover、disabled、busy、focus-visible 与亮暗主题，直角无圆角。验证包括
Node 单测、三数据库 schema/DTO、`node --check`、`npm test`、依赖审计、`git diff --check`
以及亮暗主题、键盘、窄屏和全流程浏览器 smoke。

## 回滚与后续

新增表、设置和版本化缓存均为加法；回滚到旧代码不会删除它们。缓存不兼容时忽略并
重新扫描。后续 P1-B 再评估 Provider 能力诊断、指标、prompt 版本/对比、批量摘要和
更细的 `reasoning_effort` 协议映射。
