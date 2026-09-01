# P1-B Provider 诊断与 AI 指标

## Goal

让管理员能够在不切换 active profile、不过度暴露 Provider 信息的前提下，确认某个已保存
profile 的真实连接和响应契约，并查看 Copilot、知识助手和诊断请求的有界成功/失败、耗时
与 token 使用概况，从而发现配置问题和异常趋势。

## Background and confirmed constraints

- 项目继续使用 Node.js 24、Express、原生 `fetch`、静态 HTML/CSS/JavaScript 和现有
  SQLite/MySQL/PostgreSQL 数据访问边界；不引入 SDK、队列、向量数据库或新的监控平台。
- AI profile 最多 8 个，始终只有一个 active profile；本任务不自动 fallback、不智能路由，
  诊断不能隐式改变 active profile。
- 现有 Provider 协议为 `openai-chat`、`openai-responses`、`anthropic-messages`，API Key
  使用 AES-256-GCM 密文保存；浏览器只能收到掩码 profile，绝不接触明文 key。
- 现有建议/知识问答已经有 bounded usage DTO 和结构化耗时日志，但没有统一可查询的请求
  指标表或管理员汇总界面。
- Provider 上游响应、请求正文、密钥、完整 URL/query、业务反馈正文、联系方式、管理员备注、
  账号快照和知识库绝对路径都不得进入指标、诊断响应、审计或日志。
- 已确认诊断采用真实验证：仅在管理员点击后发送一次固定、无业务数据的最小探针；页面和文档
  必须提示可能产生少量 token 消耗。

## Requirements

### R1. 按 profile 的显式连接诊断

- 管理员可从 profile 列表选择任意已保存 profile 运行一次诊断；诊断使用该 profile 的密钥，
  但不切换或删除 active profile，也不创建 Copilot 建议或知识问答历史。
- 诊断只发送固定、无业务数据的最小探针；不在页面加载、定时器、普通请求或启动流程中自动
  调用 Provider。页面必须明确这是一次真实上游请求，可能消耗少量 token，并提供 busy/错误/成功
  状态。
- 探针沿用 profile 已配置的协议和 endpoint。结果至少区分：可达/超时/HTTP 失败、JSON 可解析、
  文本可提取、usage 是否返回、请求耗时、受控 Provider request id、协议/模型标识和有界错误码。
  不把任意上游正文转发给浏览器。
- 探针要求 Provider 返回固定 sentinel `KWS_DIAGNOSTIC_OK`；只有 HTTP、JSON、文本提取和 sentinel
  全部通过才标记诊断成功。这样能避免“返回了任意文本”被误判为可用，但不把上游文本展示给页面。
- 对 `openai-responses`，若 profile 配置了 `reasoningEffort`，诊断沿用该参数并只报告“请求已发送/
  Provider 接受或拒绝”；不得宣称仅凭一次响应就证明模型实际推理能力。Chat/Anthropic 不发送该字段。
- 诊断结果可在管理员页面直接查看；失败只影响诊断区域，不影响普通业务、登录、通知、导出或知识
  索引。

### R2. 统一 AI 请求指标

- 对 Copilot 建议、知识问答和显式诊断记录一条有界指标：operation（分别为 `copilot_suggest`、
  `knowledge_ask`、`provider_diagnostic`）、profileId、protocol、model
  标识、success/failed/timeout 分类、durationMs、inputTokens/outputTokens（未知为 `null`）、
  stable errorCode、createdAt。不得保存 prompt、response、API Key、Base URL 或业务内容。
- 指标写入失败不得改变原 AI 请求的成功/失败语义，只记录受控 warning；指标读取失败只让管理
  汇总不可用，不阻塞 AI 或普通业务。
- 提供管理员汇总接口与页面摘要，至少包含时间窗内总数、成功/失败/超时、平均耗时、已知 token
  合计/未知用量计数，并按 operation 与协议提供有界分组；不返回逐请求敏感数据。
- 指标保留期采用环境配置 `AI_METRICS_RETENTION_DAYS`，默认 30 天，允许 1–3650 天；自动清理
  采用 `AI_METRICS_AUTO_CLEANUP`（默认开启，沿用现有 boolean-like 解析），在启动和每小时执行，
  关闭或清理失败只记录 warning。实现必须限制查询时间窗和返回分组数量，避免无界读取。
- 指标表在 SQLite、MySQL、PostgreSQL 三种 schema 中保持等价，并为旧数据库提供幂等创建路径。

### R3. 安全、审计与兼容

- 所有诊断/指标管理员路由沿用现有 session、同源、JSON、限流和 API envelope；诊断动作写入
  `admin_audit`，只记录 profileId、协议、模型摘要、结果和稳定错误码等白名单元数据。
- 诊断和指标不得绕过现有 `requestProviderSuggestion` 的 URL、超时、响应大小、认证和错误映射
  边界；若需抽象公共请求器，保持现有调用契约和测试兼容。
- Provider usage 的缺失、显式 `null`、空字符串、布尔、小数、负数或超安全整数必须统一为
  `null`，不得误报为 0；Provider request id 只保留有界可打印摘要，控制字符和异常值丢弃。
- 默认 AI 关闭、无 active profile、密钥不可解密、配置错误时 fail-closed；诊断不可通过任意
  profileId 读取浏览器未授权的密钥或路径。
- UI 延续冷色 HUD、直角控件、亮暗主题、键盘焦点、窄屏布局和动态文本转义。

## Acceptance Criteria

- [ ] 已登录管理员可以对非 active 的已保存 profile 发起一次显式诊断，active profile 保持不变；
      未登录、未知 profile、AI 关闭、密钥不可用分别返回现有 envelope 和稳定错误码。
- [ ] Chat、Responses、Anthropic 三种协议各有 stub 回归：正确 endpoint/认证、固定探针不含业务
      数据、响应 JSON/文本/usage/request id/耗时结果被有界映射；超时、非 2xx、超大响应、无效
      JSON 不泄露上游正文。
- [ ] Responses 的 `low/medium/high/xhigh/max` 诊断请求按现有映射发送；Chat/Anthropic 不出现
      `reasoning`；结果文案不把请求成功夸大为模型能力证明。
- [ ] Copilot、知识问答和诊断各写入一条指标；成功、失败、超时、未知 usage 的分类和 duration
      正确，指标数据库写入异常不改变主请求结果。
- [ ] SQLite 单元测试以及 MySQL/PostgreSQL schema/参数化路径测试覆盖指标表、索引、保留期清理
      和有界汇总；旧数据库初始化保持幂等、既有数据不丢失。
- [ ] 管理员汇总 API/UI 能显示总数、状态、平均耗时、token 已知/未知及 operation/协议分组；时间
      窗口、分组和文本均有上限，亮暗主题/键盘/窄屏可用，所有按钮显式 `type` 且无默认圆角。
- [ ] 自动清理默认开启且受 `AI_METRICS_RETENTION_DAYS` 限制；关闭/异常时不阻塞启动和 AI 主流程，
      日志不含密钥、URL query、prompt、response、业务正文或绝对路径。
- [ ] `node --check`、相关 node:test、`npm test`、`npm audit --omit=dev`、`git diff --check` 和
      Trellis 校验通过；文档/API/配置/缺陷矩阵同步。

## Out of scope

- 自动 fallback、智能路由、并行多 Provider、后台健康轮询、计费/成本估算、向量数据库、外部监控
  平台、用户侧 AI、运维写操作和 KyanetAccount 联动。
- 不尝试从一次廉价探针推断模型完整能力矩阵；不保存原始 Provider 响应或完整逐请求日志。
