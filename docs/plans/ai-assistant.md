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

## 分阶段演进

### P1（下一步）

增强建议质量、人工编辑体验、指标与 Provider 可用性诊断；继续保持单 active profile，
不引入自动 fallback、智能路由或并行调用。

### P2

用户侧提交澄清和结构化建议；必须支持用户取消、预览和人工确认，不能静默代提交。

运维/知识助手读取公开项目文档、运行手册和服务状态；默认不读取秘密、生产日志或内部联系人，不直接执行 shell、部署或外部写操作。

## 不纳入首版

- 自动删除、自动改状态、自动发信、自动发 Webhook。
- 以模型输出替代原始用户内容或管理员记录。
- 直接接入多个供应商并同时建设复杂路由、计费和向量数据库。

## 配置入口

只需在部署环境中设置：

- `AI_COPILOT_ENABLED=false`（默认关闭）；
- `AI_PROFILE_ENCRYPTION_KEY`：随机 32 字节主密钥的 64 位十六进制值。

profile 的名称、协议、Base URL 和模型由管理员面板维护；更新时 API Key 留空表示保留
原密文。启用、备份、轮换和回滚步骤见 [AI Copilot 运维手册](../operations/ai-copilot.md)。
