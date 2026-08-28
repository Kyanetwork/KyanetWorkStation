# P1 管理员 AI Copilot 规划

## Goal

在已有统一工作收件箱和管理员工作流之上，增加一个默认关闭、可审计、只提供
建议的管理员 AI Copilot，减少阅读、归类和回复草拟成本；AI 不成为反馈或
WorkTask 写入主链路的硬依赖，也不推进 KyanetAccount 联动。

## 已确认背景

- P0 稳定性、隐私、运行时和发布边界已完成；Node.js 24.x、Express、原生静态
  前端以及 SQLite/MySQL/PostgreSQL 适配是当前兼容边界。
- P1 统一首页/工作收件箱已经存在，管理员列表通过 `server/app.js` 调用
  `server/db.js`，前端使用 `public/admin/admin.js` 的页面级状态和共享方正冷色主题。
- 当前数据仍分为 `feedback` 与 `worktask` 两张业务表；公开/用户 DTO 不得暴露
  `content`、`contact`、`admin_note`、账号快照、通知 payload 等内部字段。
- 既有 AI 规划明确了管理员 MVP 能力：短摘要、类型/优先级/标签建议、相似条目
  提示、对外回复草稿和建议依据/缺失信息说明。
- 既有通知 outbox、同源保护、管理员会话、请求 ID 和结构化日志可复用；不得把
  AI 输出直接写入状态、删除、回复或通知动作。

## 初始产品要求

### R1. 管理员建议工作流

- 仅管理员会话可请求或查看 Copilot 建议；匿名访客和未来用户侧 AI 不在本任务。
- 管理员可针对一条反馈/WorkTask 请求建议，查看生成时间、Provider/模型标识、
  建议内容、依据和缺失信息，并逐项接受、编辑或拒绝。
- 首版建议覆盖摘要、分类、优先级、标签、相似条目和公开回复草稿；接受建议
  只是填充待确认表单，不自动提交或触发外部副作用。

### R2. 安全与隐私

- AI 默认关闭；未配置 Provider、额度耗尽、超时或上游失败时，现有管理员列表
  和反馈/WorkTask 流程继续可用。
- 发送前只构造最小化、明确 allow-list 的输入；不得发送联系方式、管理员备注、
  账号快照、会话/Token、Webhook、数据库地址、通知 payload 或不必要的原文。
- API Key 明文只在管理员提交和单次 Provider 请求的短暂内存路径中出现；数据库只保存
  AES-GCM 密文，明文不得进入源代码、日志、CSV、Trellis 文档或浏览器存储。
- 模型输出视为不可信建议；状态、负责人、计划时间、删除、公开回复和通知发送
  等写操作必须由管理员在现有接口中再次确认。

### R3. 可观测性与资源边界

- 每次请求记录 request ID、Provider、模型标识、耗时、结果和有界脱敏错误；不记录
  完整 prompt/response。
- Provider 请求必须有超时、请求/响应大小上限、并发/速率边界和可取消路径；
  失败不能阻塞页面初次加载或普通提交。
- 建议结果只保留到明确的短期候选状态或安全审计摘要；首版不建设向量数据库、
  长期 prompt 仓库或复杂计费/路由系统。

## 约束与明确不纳入

- 保持 Node.js + Express + 原生 HTML/CSS/JavaScript 和现有数据库适配，不引入
  React、TypeScript、ORM、队列服务、微服务或新的通用插件平台。
- 不自动改状态、删除、发送 SMTP/Webhook、执行 shell/部署，或把模型输出替代
  原始用户内容和管理员记录。
- 不在本任务实现用户侧提交助手、运维/知识助手、新 KyanetAccount 协议、历史
  匿名记录归属、复杂 RBAC、向量检索或多 Provider 智能路由。

## 已确认的 Provider 方向

- 采用“统一内部 AI 契约 + 协议适配器”分层，而不是把厂商判断散落在业务路由中。
- `openai-chat` 是首要适配器：OpenAI 官方、OpenAI-compatible 中转站、DeepSeek
  和 GLM/Z.ai 在兼容 Chat Completions 时只需配置 endpoint/model/key，不为每个品牌
  新增业务适配器。
- `openai-responses` 作为独立适配器处理 OpenAI Responses 的请求/响应结构；不能
  假设所有 Chat Completions 兼容站点支持 Responses。
- `anthropic-messages` 作为 Claude 的原生适配器，保留 Anthropic 的认证和消息
  结构，不强行转换成 OpenAI 协议。
- 首版使用 Node 内置 `fetch`，不引入各厂商 SDK；Provider 返回值统一归一化为
  Copilot 所需的建议文本/结构化结果、usage、耗时、request ID 和有界错误。
- 支持多种接入协议不等于首版同时运行多个 Provider；不建设自动路由、计费、智能
  fallback 或多套密钥的复杂管理。
- Provider 运行模型采用 B-lite：可保存多个命名 profile，但同一时刻只有一个
  active profile；切换只影响切换后的新请求，不取消已开始的请求，不做自动 fallback
  或并行调用。

## 已确认的配置存储方案

- Provider profile 的密钥持久化复用现有 `workstation_setting` 的 JSON 文本能力；`.env`
  只保存 AI 总开关和一把部署级主密钥，不为每个中转站增加变量。外部 Vault/云密钥
  服务不纳入首版。

### 主密钥与密文封装

- `AI_PROFILE_ENCRYPTION_KEY` 是部署级随机 32 字节主密钥，不是任何 Provider 的
  API Key；建议以 64 位十六进制字符串写入被忽略的 `.env`，生产文件权限为 `600`。
- 每个 profile 的 API Key 使用 Node 内置 `crypto` 的 `AES-256-GCM` 加密，每次保存
  生成新的随机 IV，并保存 `version`、`algorithm`、`keyId`、`iv`、`ciphertext` 和
  `authTag` 封装；profile ID 可作为 AAD 防止密文错配。
- 现有 `workstation_setting` 的 JSON 文本保存 profile 元数据、active profile ID
  和密文；Base URL、协议、模型等非敏感值可展示，API Key 只返回掩码。
- 请求开始时快照 active profile 并在进程内解密；热切换只影响新请求。主密钥缺失或
  解密失败只让 Copilot unavailable，不阻塞基础业务，也不回退到明文。
- 首版不提供页面内密钥轮换；轮换需备份、受控脚本旧/新密钥重加密、更新部署密钥和
  冒烟验证。数据库备份只保存密文，主密钥必须独立保管。

## 已确认的认证边界

- Profile 只允许内置的安全认证模式：OpenAI-compatible 的 Bearer、Anthropic 的
  `x-api-key`，以及协议所需的固定版本头；不开放任意自定义请求头输入。
- 自定义 Base URL 负责兼容中转站、DeepSeek 和 GLM/Z.ai；若未来某个具体 Provider
  确实需要额外 Header，另行设计经过审计的白名单字段，不在本 P1 中预留通用逃生口。

## 本任务纳入的缺陷修复与验证缺口

| ID | 当前问题 | P1 处理方式 |
|---|---|---|
| AI-D001 | 当前没有统一 Provider 契约，业务路由无法安全接入多个协议 | 增加独立协议适配边界和统一结构化输出解析；未知协议在配置校验阶段拒绝 |
| AI-D002 | 当前没有 AI 专用的出站字段 allow-list、超时、响应大小和并发边界 | 在 Copilot 请求入口集中构造最小 DTO，使用固定超时、大小上限、单进程并发闸门和管理员限流 |
| AI-D003 | 当前没有 profile 加密、active profile 不变量和密钥不可回显机制 | 复用 `workstation_setting` 保存 AES-256-GCM 密文，读写/切换均校验单 active，不返回密钥 |
| AI-D004 | 当前没有可刷新、可短期保留且可人工决策的建议候选 | 增加有界建议记录、过期过滤和接受/拒绝审计；不写入业务状态或通知动作 |
| R-002 | 管理端全量 CSV 导出仍有内存/审计风险 | 保留为独立后续 P1 任务，不把无关的导出重构混入本 Copilot 任务 |

## Acceptance Criteria

- [x] 产品范围、Provider 边界、数据出站策略和失败降级行为经用户确认。
- [x] 规划文档明确建议请求/响应 DTO、脱敏字段、人工确认边界、配置键和错误矩阵。
- [x] 规划文档明确测试、审计、限流/超时、存储保留和回滚验收；不要求实现阶段
      引入新的基础设施。
