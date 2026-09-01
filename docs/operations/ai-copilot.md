# AI Copilot 运维手册

本文适用于管理员工作收件箱中的 AI Copilot。Copilot 默认关闭，只能由管理员
主动请求建议；它不会自动修改状态、删除记录、保存公开回复或发送 SMTP/Webhook
通知。AI 不可用时，反馈、WorkTask、管理员列表和通知 outbox 仍应继续工作。

## 启用前检查

1. 确认运行时使用项目支持的 Node.js 24.x，并已完成常规健康检查、数据库备份和
   回滚演练。
2. 为当前部署生成独立的 32 字节主密钥。示例（只在受控终端执行，输出不要写入
   Shell 历史、工单或 Git）：

   ```bash
   openssl rand -hex 32
   ```

   输出应为 64 位十六进制字符串。它是本部署的密钥加密主密钥，不是任何 Provider
   的 API Key；必须与数据库备份分开保管。

3. 在部署环境的 `.env` 中设置：

   ```dotenv
   AI_COPILOT_ENABLED=true
   AI_PROFILE_ENCRYPTION_KEY=<64 位十六进制主密钥>
   ```

   不要在值后追加注释或空格，也不要把真实值复制到文档、日志、截图或聊天记录。
   保持文件权限仅部署用户可读（例如 `600`），然后按现有 PM2 发布流程重启应用。

4. 重启后先访问 `/api/health`，再使用管理员会话访问 AI 状态接口。若状态为
   `unavailable`，先检查开关、主密钥格式和应用日志中的脱敏错误码，不要尝试把
   API Key 写回 `.env`。

## Provider profile 配置

在管理员页面的 AI 设置区创建 profile。首版最多保存 8 个 profile，但同一时间只有
一个 active profile；切换只影响之后开始的新请求。

| 协议 | 适用范围 | 服务端认证 |
|---|---|---|
| `openai-chat` | OpenAI Chat Completions、兼容中转站、DeepSeek、GLM/Z.ai | `Authorization: Bearer …` |
| `openai-responses` | 支持 OpenAI Responses 结构的端点 | `Authorization: Bearer …` |
| `anthropic-messages` | Claude 原生 Messages API | `x-api-key` 与固定 `anthropic-version` |

Base URL 和模型名由管理员填写，必须使用 `http` 或 `https` 的绝对地址。认证头由
服务端按协议固定生成，页面不接受任意自定义 Header。API Key 提交后以 AES-256-GCM
密文写入 `workstation_setting`；列表只显示掩码，浏览器不会保存明文。

更新 profile 时 API Key 留空表示保留原密文；只有在明确替换密钥时才填写新值。删除
active profile 会清空 active 状态，不会隐式切换到其他 Provider。

## 受控工作指令与 Prompt 版本

每次建议使用固定版本标识 `copilot-v2`。服务端先放置不可编辑的系统安全指令，
再按需追加 profile 的 `promptInstruction`，最后放入 `<user-data>` 与
`<similar-items>` 不可信数据区。工作指令最多 2000 个 Unicode 字符，只能调整
建议风格和工作偏好；不能覆盖脱敏白名单、不可信数据边界、禁止工具/URL 访问或
JSON 输出约束。类似 `<admin-instruction>` 的边界标签会被当作普通文本处理，不能
借此结束该区段。

清空工作指令即可恢复无附加指令的默认 Prompt。建议结果和短期候选记录带有
`promptVersion`，便于识别使用的固定契约；旧记录没有版本时按空值展示。日志、审计
和 API Key 均不保存完整 Prompt 或指令原文。若需记录 profile 配置变化，审计只允许
保存 `promptInstructionConfigured`、字符数和不可逆哈希等摘要字段，不要把指令全文
复制到审计 metadata、工单或截图。

## 知识助手运维

知识助手与 Copilot 共用当前 active profile 和主密钥，但知识库目录是独立的只读配置。
在部署环境设置 `AI_KNOWLEDGE_BASE_DIRS`（JSON 数组，包含 `id`、`name`、绝对 `path`），
可选设置 `AI_KNOWLEDGE_HISTORY_RETENTION_DAYS`（1–3650，默认 30）。目录可以位于云
服务器挂载点；不要把文档复制进仓库或将路径交给浏览器请求。

发布或同步文档后的操作顺序：

1. 先完成数据库备份，并确认运行用户对目录只有读取权限。
2. 同步/挂载目录，检查 `.env` 中的 JSON 配置不含行尾注释；Windows 路径优先使用正斜杠。
3. 重启应用后在部署目录执行 `npm run reindex-knowledge`，或在管理员页面点击“重建索引”。
   应用启动不会自动扫描，也不会常驻监听文件变化。
4. 在管理员页面核对根目录名称、文件/片段统计，并用一条非敏感问题检查引用来源。

索引器只读取 `.md`/`.txt`，跳过隐藏、运行和秘密目录，拒绝越界软链接；默认最多 8 个
根目录、每根 5000 个文件、单文件 1 MiB、总读取 32 MiB，索引和上下文也有上限。缓存位于
`data/ai-knowledge-index.json`，通过临时文件和原子替换更新，扫描失败会保留上一份有效
缓存。缓存文件已加入 Git 忽略，状态/API 只返回库名、相对路径和脱敏统计。

知识问答仅管理员可见，默认跨所有库检索，也可按库筛选。答案的 `basis` 为 `document`、
`mixed` 或 `general`；无充分命中时服务端强制 `general` 并显示“非文档依据/需核验”。
文档片段是不可信资料，不会被执行，也不会读取未索引文件。问答历史保留问题、回答、引用、
profile/模型、用量和 prompt 版本，但不保存 API Key、完整 prompt、绝对路径或未选中文档。

历史自动清理默认开启：应用启动清理一次，之后每小时清理过期记录。管理员可在知识助手
页面关闭自动清理；关闭只停止定时任务，手动清理和单条删除仍然有效，过期记录也不会参与
后续问答。清理、删除、重建和问答均写入脱敏审计元数据。

## Provider 真实诊断与指标

在 AI profile 列表中点击“诊断”才会发起一次真实上游请求。探针内容固定为
`KyanetWorkStation provider diagnostic. Reply with exactly KWS_DIAGNOSTIC_OK and nothing else.`，
不会拼接业务数据，也不会切换 active profile、创建 Copilot 建议或知识问答历史。只有
HTTP、JSON、文本提取和精确 `KWS_DIAGNOSTIC_OK` 全部通过时才显示“通过”；这只能证明
当前网络、认证、端点和最小响应契约，不代表模型的完整能力。一次诊断可能产生少量 token
消耗；Responses 的 `reasoningEffort` 会按 profile 发送，但不能由此宣称模型具备完整推理能力。

诊断只显示协议、模型摘要、固定端点后缀、状态、阶段检查、耗时、受控 request ID 和
token 是否可用，不转发 Provider URL、密钥、请求/响应正文。失败分类包括 `AI_TIMEOUT`、
`AI_PROVIDER_FAILED` 和 `AI_INVALID_RESPONSE`，原始上游错误不会进入接口或日志。

面板的“AI 请求指标”按最近 24 小时、7 天或 30 天读取聚合数据，包含 Copilot、知识问答
和诊断的成功/失败/超时、平均耗时、已知 token 合计、未知用量计数以及 operation/protocol
分组，不提供逐请求正文。指标写入是 best-effort，不会改变 AI 主流程。指标默认保留 30 天，
由 `AI_METRICS_RETENTION_DAYS`（1–3650）控制；`AI_METRICS_AUTO_CLEANUP=true` 时启动和
每小时清理过期记录，关闭时不执行自动清理但不影响汇总和手动数据库维护。

## 日常验证

建议在每次修改开关、主密钥或 active profile 后执行以下检查：

1. 管理员页面能读取 AI 状态，profile 列表只显示 `keyConfigured`/掩码，不出现密文。
2. 针对一条非敏感测试条目生成建议，确认返回 Provider/模型、摘要、分类、优先级、
   标签、相似条目、回复草稿、依据和缺失信息。
3. 确认建议中的“填入”只修改当前表单；必须再次点击现有保存/状态按钮才会写入业务表。
4. 在应用日志中只检查 request ID、profile/协议/model、耗时和脱敏错误码；不得记录
   完整 prompt、响应或 API Key。
5. 关闭 AI 后重启或刷新，确认状态为 disabled/unavailable，普通列表、提交和通知
   路径仍可用。

## 停用与回滚

发现 Provider 异常、费用异常、密钥疑似泄露或建议质量不可接受时：

1. 将 `AI_COPILOT_ENABLED=false` 写入部署环境并重启 PM2；这是首选的快速止损方式。
2. 如只需停止某个端点，可在管理员页面删除或停用 active profile。不要删除数据库表，
   以便保留短期审计记录和后续排查证据。
3. 保留脱敏日志、数据库备份和发布记录；不要通过日志、浏览器缓存或数据库密文猜测
   API Key。若密钥泄露，应在对应 Provider 侧吊销并重新创建 profile。
4. 代码回滚时回到加入 AI 表之前的已验证版本；旧版本不应执行删除迁移，新增表和设置
   可保留，恢复后再确认健康、管理员登录和普通提交。

## 主密钥备份与轮换

- 主密钥必须独立于数据库和应用代码备份，至少由部署负责人使用受控密钥存储保管。
- 首版没有页面内主密钥轮换按钮。直接替换 `.env` 中的主密钥会使已有 profile 无法
  解密，应用会保持 AI unavailable；不要用这种方式测试轮换。
- 正式轮换需要维护窗口、数据库备份、旧/新主密钥双人复核，以及离线、一次性的重加密
  工具：读取旧密钥解密每个 profile，使用新密钥为同一 profile ID 生成新的 IV、密文和
  authTag，完整校验后再替换部署密钥。该工具不得输出 API Key，也不得把密钥写入日志
  或临时文件。
- 当前仓库未提供通用轮换脚本；在实现并审核该脚本前，只执行“停用 AI → 备份 → 受控
  人工重建 profile”的应急方案，并将旧数据库和主密钥保留到恢复验证结束。

## 故障定位与边界

| 现象 | 处理 |
|---|---|
| `AI_UNAVAILABLE` | 检查全局开关、active profile 和主密钥有效性；普通业务无需回滚 |
| `AI_KEY_UNAVAILABLE` | 停止请求并核对主密钥是否与保存 profile 时一致；不要回退明文 |
| `AI_BUSY` / `AI_RATE_LIMITED` | 等待并发或限流窗口恢复，避免反复刷新；必要时暂时停用 AI |
| `AI_TIMEOUT` / `AI_PROVIDER_FAILED` | 检查端点可达性、模型权限和上游状态；不把完整上游响应写入日志 |
| `AI_INVALID_RESPONSE` | 保留脱敏 request ID，停用问题 profile 并在本地 stub/受控环境复现 |

Provider 请求有 15 秒超时、32 KiB 响应上限、单进程 2 个并发上限和单管理员 10 次/5
分钟限流。建议候选默认保留 7 天，过期后不可查询；接受/拒绝只写审计字段，不改变
反馈或 WorkTask 的业务状态。
