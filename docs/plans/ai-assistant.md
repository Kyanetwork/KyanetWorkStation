# AI 辅助路线与边界

## 产品目标

AI 先帮助管理员减少阅读、分类和回复工作，再在边界稳定后扩展到用户提交和运维知识。AI 是建议层，不替代管理员决策，也不成为反馈/任务写入主链路的硬依赖。

## P1 管理员 Copilot MVP（当前实现）

首批建议能力：

- 根据反馈/WorkTask 生成短摘要。
- 建议类型、优先级和标签。
- 提示可能的相似条目或重复提交。
- 根据已有内容生成对外回复草稿。
- 解释建议依据和缺少的信息。

当前实现支持多个命名 Provider profile，但同一时间只有一个 active profile。支持
`openai-chat`（OpenAI 官方及兼容中转、DeepSeek、GLM/Z.ai）、`openai-responses`
和 `anthropic-messages`（Claude）。切换只影响新请求，不取消进行中的请求。

每项建议都能被管理员接受或拒绝；“填入”只写入当前页面表单，仍需管理员编辑并点击
原有保存/状态按钮。建议记录生成时间、Provider/模型标识和短期过期时间，不显示密钥。

### P1-A 个人知识助手（当前实现）

管理员页面的“知识助手”标签提供一条独立的、只读的文档问答路径：

- 通过 `AI_KNOWLEDGE_BASE_DIRS` 配置最多 8 个外部根目录，只索引 Markdown/TXT；扫描需由
  管理员按钮或 `npm run reindex-knowledge` 显式触发，应用启动不扫描、不监听文件变化。
- 索引器跳过隐藏/运行/秘密目录，使用 realpath 检查软链接边界、文件/总量/上下文上限，
  以版本化 JSON 原子替换缓存；失败保留上一份有效索引。
- 检索默认跨所有库，也可按库筛选；回答必须返回 `document`、`mixed` 或 `general` 依据、
  服务端映射的引用和 caveat。无充分命中时强制标注“非文档依据/需核验”。
- 问题、回答、引用、profile/模型、用量和 prompt 版本保存到管理员私有历史表；默认保留 30
  天，保留期可在环境变量中按 1–3650 调整。自动清理默认开启并在启动/每小时执行，管理员
  也可关闭自动任务、手动清理或删除单条记录。
- 知识问答复用 active profile 与 AES-256-GCM 密钥，不新增第二套凭据；文档片段作为不可信
  资料发送，不执行其中指令，不读取未索引文件，也不修改反馈/WorkTask、发送通知或执行命令。

Copilot profile 现在还支持可选 `reasoningEffort`（`low`/`medium`/`high`/`xhigh`/`max`）
和最多 2000 个 Unicode 字符的 `promptInstruction`。只有 OpenAI Responses 请求映射
`reasoning.effort`；Chat/Anthropic 安全省略，附加指令始终位于固定安全 Prompt 的独立边界。

## 安全与隐私约束

- 默认关闭，管理员显式启用；未配置 Provider 时核心功能仍可用。
- 使用轻量 Provider Adapter 隔离供应商，基于 Node 内置 `fetch`，不引入厂商 SDK。
- API Key 使用部署级 `AI_PROFILE_ENCRYPTION_KEY` 通过 AES-256-GCM 加密后保存到
  `workstation_setting`；数据库备份不包含主密钥，浏览器永不接触明文 Key。
- Provider 认证固定为 OpenAI-compatible Bearer 或 Anthropic `x-api-key` + 固定版本头，
  不开放任意自定义 Header。
- 发送前脱敏联系方式、账号快照、Token、内部备注、Webhook、数据库地址和其他不必要字段。
- 不把 API Key 明文写入代码、数据库、日志、CSV 或 Trellis 文档；数据库仅保存密文封装。
- 模型输出只写入 `ai_copilot_suggestion` 候选表；写回回复、状态、删除或通知动作前
  必须人工确认，decision 接口本身不改业务表。
- 记录请求 ID、Provider、耗时、成功/失败和脱敏错误；不记录完整 prompt/response，除非后续明确设计了安全审计存储。
- 提供超时、大小限制、额度/速率限制和关闭开关；AI 故障不能阻塞普通提交和管理员基础操作。

## P1-B Provider 诊断与请求指标（当前实现）

P1-B 已将 Provider 能力确认和运行观测收敛到管理员边界：

- profile 列表可显式选择任意已保存 profile 发起一次固定 sentinel 真实请求；不切换 active
  profile、不创建建议或知识历史，页面提示可能产生少量 token 消耗。
- 诊断复用现有 Provider Adapter，覆盖 Chat、Responses、Anthropic 的固定端点、认证、15 秒
  超时和 32 KiB 响应上限；只有 HTTP、JSON、文本提取和精确 sentinel 全部通过才算成功。
- 诊断结果只保留协议/模型摘要、阶段检查、耗时、受控 request id、usage 是否可用和稳定错误码。
  Responses 的 `reasoning_effort` 只记录是否发送，不宣称完整推理能力。
- Copilot、知识问答和诊断各写一条有界 `ai_request_metric`，汇总显示成功/失败/超时、平均耗时、
  已知 token 合计、未知用量计数及 operation/protocol 分组；写入失败不改变主流程。
- 指标默认保留 30 天，`AI_METRICS_RETENTION_DAYS` 接受 1–3650，`AI_METRICS_AUTO_CLEANUP`
  控制启动及每小时清理；汇总时间窗限制为 1–720 小时，最多返回 100 个分组。

继续保持单 active profile，不引入自动 fallback、智能路由、并行多 Provider、向量数据库或外部
监控平台。真实 Provider 诊断仍需在发布目标按运维手册受控执行，不用 stub 结果冒充生产证据。

## 分阶段演进

### P2

用户侧提交澄清和结构化建议；必须支持用户取消、预览和人工确认，不能静默代提交。

更广泛的用户侧/运维侧 AI 读取公开项目文档、运行手册和服务状态；默认不读取秘密、生产日志或内部联系人，不直接执行 shell、部署或外部写操作。当前管理员知识助手已先行落地，后续扩展另建任务。

## 不纳入首版

- 自动删除、自动改状态、自动发信、自动发 Webhook。
- 以模型输出替代原始用户内容或管理员记录。
- 直接接入多个供应商并同时建设复杂路由、计费和向量数据库。

## 配置入口

只需在部署环境中设置：

- `AI_COPILOT_ENABLED=false`（默认关闭）；
- `AI_PROFILE_ENCRYPTION_KEY`：随机 32 字节主密钥的 64 位十六进制值；
- `AI_KNOWLEDGE_BASE_DIRS=[]`：可选的只读 Markdown/TXT 根目录 JSON 数组；
- `AI_KNOWLEDGE_HISTORY_RETENTION_DAYS=30`：问答历史保留期（1–3650 天）；
- `AI_METRICS_RETENTION_DAYS=30`：AI 请求指标保留期（1–3650 天）；
- `AI_METRICS_AUTO_CLEANUP=true`：是否启动及每小时自动清理过期指标。

profile 的名称、协议、Base URL 和模型由管理员面板维护；更新时 API Key 留空表示保留
原密文。知识目录同步、索引、自动清理、备份、轮换和回滚步骤见
[AI Copilot 运维手册](../operations/ai-copilot.md)。
