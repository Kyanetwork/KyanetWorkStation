# 配置参考

配置读取逻辑位于 `server/config.js`，示例位于 `.env.example`。`.env` 只在本地或服务器保存，不能提交到 Git。

## 基础运行

| 变量 | 默认值 | 说明 |
|---|---|---|
| `NODE_ENV` | `development` | 生产使用 `production` |
| `PORT` | `3000` | Node 监听端口 |
| `LISTEN_HOST` | `127.0.0.1` | 建议仅绑定本机并由反向代理暴露 |
| `TRUST_PROXY` | `0` | 仅在明确受信反向代理时设置为代理层数 |
| `APP_BASE_URL` | `http://127.0.0.1:3000` | 站点绝对地址；生产反向代理使用 HTTPS 公网地址 |
| `DB_CLIENT` | `sqlite` | `sqlite`、`mysql` 或 `postgres` |
| `DATABASE_URL` | 空 | MySQL/PostgreSQL 连接串；非 SQLite 必填 |
| `DB_PATH` | `./data/workstation.db` | SQLite 文件路径 |
| `HEALTH_EXPOSE_COUNTS` | `false` | 是否在 health 暴露业务计数 |

生产经宝塔 Nginx 等反向代理提供 HTTPS 时，设置为例如
`APP_BASE_URL=https://kws.kyanet.work`。不要填后端回环地址、HTTP 公网地址，或在
值后追加 `//` 注释；行尾说明会被当作配置值的一部分。

## 管理员、会话与限流

| 变量 | 默认值 | 说明 |
|---|---|---|
| `ADMIN_USERNAME` | 空 | 引导管理员用户名 |
| `ADMIN_PASSWORD` | 空 | 引导管理员密码；生产不得使用弱口令 |
| `BCRYPT_ROUNDS` | `12` | 管理员密码哈希轮数 |
| `SESSION_COOKIE_NAME` | `kws_sid` | 管理员会话 Cookie 名 |
| `SESSION_TTL_HOURS` | `168` | 管理员会话有效期 |
| `RATE_LIMIT_SUBMIT_WINDOW_MS` | `600000` | 提交限流窗口 |
| `RATE_LIMIT_SUBMIT_MAX` | `20` | 窗口内提交次数 |
| `RATE_LIMIT_LOGIN_WINDOW_MS` | `900000` | 登录限流窗口 |
| `RATE_LIMIT_LOGIN_MAX` | `10` | 窗口内登录次数 |
| `RATE_LIMIT_ADMIN_WINDOW_MS` | `60000` | 管理接口限流窗口 |
| `RATE_LIMIT_ADMIN_MAX` | `120` | 窗口内管理请求次数 |
| `ADMIN_ALLOW_HEADERLESS_MUTATION` | `false` | 是否允许无来源头的管理写请求；仅受控调试使用 |
| `ADMIN_EXPORT_MAX_ROWS` | `10000` | 单次反馈/WorkTask CSV 导出上限；仅接受 100–100000 的整数，修改后需重启服务 |

导出批次大小固定为 250 行，不另设环境变量；上限不是静默截断阈值，超过时接口返回
`413 EXPORT_LIMIT_EXCEEDED`。审计记录写入数据库并随现有备份保留。

## 日志与展示

| 变量 | 默认值 | 说明 |
|---|---|---|
| `LOG_LEVEL` | `info` | `trace/debug/info/warn/error/fatal` |
| `LOG_TO_FILE` | `false` | 是否额外写入文件 |
| `LOG_DIR` | `./logs` | 文件日志目录 |
| `ACCESS_LOG_ENABLED` | `true` | 是否记录请求日志 |
| `ACCESS_LOG_SKIP_HEALTH` | `true` | 是否跳过 health 日志 |
| `ACCESS_LOG_SLOW_MS` | `800` | 慢请求警告阈值 |
| `DISPLAY_TIMEZONE` | `Asia/Shanghai` | 前端展示时区 |
| `DISPLAY_LOCALE` | `zh-CN` | 前端展示语言区域 |

## MeowStatus

| 变量 | 默认值 | 说明 |
|---|---|---|
| `MEOWSTATUS_BASE_URL` | `http://127.0.0.1:8080` | 外部 API 基地址；仅作开发默认值 |
| `MEOWSTATUS_ENABLED` | `false` | 全局启用门；默认关闭，避免未配置外部服务阻塞页面 |
| `MEOWSTATUS_TIMEOUT_MS` | `5000` | 请求超时 |
| `MEOWSTATUS_REFRESH_MS` | `10000` | 前端刷新间隔 |

MeowStatus 由 `MEOWSTATUS_ENABLED=false` 全局关闭时不会发起外部请求，公共接口返回 `state=disabled`，反馈和 WorkTask 不依赖其可用性。只有全局门开启且管理页对应卡片启用时才会访问外部 API；不可达时返回 `state=unavailable`，不阻塞核心业务。

## 管理员 AI Copilot

| 变量 | 默认值 | 说明 |
|---|---|---|
| `AI_COPILOT_ENABLED` | `false` | AI 建议总开关；关闭时不发起 Provider 请求，基础业务继续可用 |
| `AI_PROFILE_ENCRYPTION_KEY` | 空 | 32 字节随机主密钥的 64 位十六进制值；启用 AI 时必填，独立于数据库备份保管 |

Provider profile（名称、协议、Base URL、模型和 API Key）在管理员面板保存。API Key 使用
AES-256-GCM 加密写入 `workstation_setting`，列表只显示掩码；OpenAI-compatible 使用
Bearer，Anthropic 使用 `x-api-key` 和固定版本头。最多保存 8 个 profile，但只有一个
active profile。profile 可选配置 `reasoningEffort`（空值或 `low`/`medium`/`high`/`xhigh`/
`max`）和最多 2000 个 Unicode 字符的 `promptInstruction`；只有 OpenAI Responses 发送
推理强度，Chat/Anthropic 会省略。完整启停、备份和轮换流程见 [AI Copilot 运维手册](ai-copilot.md)。

### 管理员知识助手

知识库是可选的、由部署环境提供的只读目录。根目录配置为 JSON 数组，每项包含稳定的
`id`、展示用 `name` 和服务器上的绝对 `path`：

```dotenv
AI_KNOWLEDGE_BASE_DIRS=[{"id":"tyutland","name":"TYUTland","path":"/srv/knowledge/tyutland"}]
AI_KNOWLEDGE_HISTORY_RETENTION_DAYS=30
```

Windows 配置建议使用正斜杠（例如
`"E:/Workplace/Projects/@Knowledge-Base/Minecraft/TYUTland"`）；若使用反斜杠则必须按 JSON 规则转义。生产 Linux 路径应使用实际挂载点。不要把原始文档、绝对路径或生成的索引提交 Git。
目录配置由服务端读取，管理员页面只显示库名和相对路径，浏览器不能传入任意目录。

索引器只收录 `.md` 和 `.txt`，跳过隐藏目录以及 `.git`、`node_modules`、`data`、
`logs`、`backups`、`tmp`、`temp`、`secret(s)` 等运行/秘密目录；真实路径和软链接必须
留在对应根目录内。默认安全上限为最多 8 个根目录、每根 5000 个文件、单文件 1 MiB、
总读取 32 MiB、索引 48 MiB、单片段 4000 字符、单次回答最多 6 个片段/约 24 KiB 上下文。
扫描不会写入原始目录。

应用启动只加载现有缓存，不扫描目录。目录同步或内容更新后，在部署目录执行：

```bash
npm run reindex-knowledge
```

该命令和管理页面的“重建索引”都会生成版本化 JSON 缓存
`data/ai-knowledge-index.json`，写入临时同目录文件后原子替换；失败会保留上一份有效
缓存。缓存已加入 Git 忽略。若根目录配置无效、缓存缺失或版本不兼容，状态接口会报告
不可用，需要修正配置后重新扫描。

问答默认检索所有库，也可在管理员页面按库筛选。回答会返回服务端映射的引用；没有足够
命中时使用 `basis=general` 并标注“非文档依据/需核验”。知识片段被视为不可信资料，
不会执行其中的 URL、命令或指令，也不会读取未索引文件。

问答历史默认保留 30 天，`AI_KNOWLEDGE_HISTORY_RETENTION_DAYS` 仅接受 1–3650 的整数。
管理员可在页面关闭自动清理；开启时应用启动清理一次，之后每小时清理过期记录。关闭
只跳过自动任务，手动清理和单条删除仍可用，过期记录也不会参与新的问答。历史和索引
不保存 API Key、完整 prompt、机器绝对路径或未选中文档。

推荐生产发布顺序：备份数据库 → 同步/挂载只读知识目录 → 更新 `.env` 并重启 → 执行
`npm run reindex-knowledge` → 在管理员页面核对索引统计和一次非敏感问答 → 保留发布与
回滚证据。若 Provider 或索引异常，可先关闭 `AI_COPILOT_ENABLED`；普通反馈、WorkTask、
通知和导出不依赖知识助手。

## 备份

| 变量 | 默认值 | 说明 |
|---|---|---|
| `BACKUP_DIR` | `./backups` | 备份输出目录 |
| `BACKUP_RETENTION_DAYS` | `30` | 清理旧备份的保留天数 |

## SMTP

| 变量 | 默认值 | 说明 |
|---|---|---|
| `SMTP_ENABLED` | `false` | 是否启用邮件通知 |
| `SMTP_HOST` | 空 | SMTP 主机 |
| `SMTP_PORT` | `587` | SMTP 端口 |
| `SMTP_SECURE` | `false` | 是否直接使用 SSL |
| `SMTP_REQUIRE_TLS` | `true` | 是否要求 STARTTLS |
| `SMTP_USER`/`SMTP_PASS` | 空 | SMTP 凭据，不得写入日志 |
| `SMTP_FROM` | 空 | 发件地址 |
| `SMTP_TO` | 空 | 逗号分隔的收件地址 |
| `SMTP_SUBJECT_PREFIX` | `[KyanetWorkStation]` | 邮件标题前缀 |

## Webhook

| 变量 | 默认值 | 说明 |
|---|---|---|
| `WEBHOOK_ENABLED` | `false` | 是否启用通知 |
| `WEBHOOK_PROVIDER` | `generic` | `generic/wecom/feishu/lark/dingtalk/slack` |
| `WEBHOOK_URLS` | 空 | 逗号分隔的 URL |
| `WEBHOOK_SECRET` | 空 | generic 签名或钉钉签名密钥 |
| `WEBHOOK_KEYWORDS` | 空 | 平台安全关键词 |
| `WEBHOOK_TIMEOUT_MS` | `5000` | 请求超时 |
| `WEBHOOK_TITLE_PREFIX` | `[KyanetWorkStation]` | 消息标题前缀 |

## KyanetAccount 边界

KyanetAccount 当前不在运行时配置或请求路径中，遗留环境变量即使存在也不会被读取。历史业务列和会话表暂保留，删除条件及未来独立接入约束见 `docs/plans/account-refactor.md`。
