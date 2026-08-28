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
