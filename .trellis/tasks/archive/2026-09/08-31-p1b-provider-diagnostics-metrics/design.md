# P1-B Provider 诊断与 AI 指标设计

## 设计边界

本任务只扩展现有管理员 AI 边界。Provider 仍由 `server/ai-provider.js` 负责协议适配、认证、
超时和响应大小限制；Copilot 与知识助手继续负责各自的输入/输出契约。新增的诊断模块不读取
业务记录、不创建建议或知识回答、不改变 active profile。指标模块只保存有界的聚合所需字段。

不引入 SDK、后台队列、向量数据库或外部监控服务；继续使用 `server/db.js` 的三数据库 facade、
`workstation_setting`/SQL schema 和原生 Node `fetch`。

## 模块与数据流

```text
管理员 profile 列表
  └─ POST /api/admin/ai/profiles/diagnose { profileId }
       └─ validation → ai-diagnostics
            ├─ getProfileSnapshot(profileId) → decrypt key（仅服务端内存）
            ├─ 固定探针 → ai-provider.requestProviderSuggestion
            ├─ recordAiRequestMetricSafely(operation=diagnostic)
            └─ 安全诊断 DTO（不含 URL/key/正文）

Copilot / Knowledge
  └─ provider 调用成功或失败
       └─ finally → recordAiRequestMetricSafely(operation=copilot|knowledge)

管理员指标面板
  └─ GET /api/admin/ai/metrics?hours=...
       └─ validation → db.listAiRequestMetricSummary → 有界汇总 DTO

应用启动 + 每小时 worker
  └─ ai-metrics.cleanupExpiredMetrics（按 AI_METRICS_RETENTION_DAYS）
```

## Provider 诊断契约

`diagnoseProfile({ profileId, requestId, signal, dependencies })`：

- 只允许已保存的 profile ID；读取任意 profile 不会改变 active profile。
- 固定探针文本为短句，不拼接业务内容：`KyanetWorkStation provider diagnostic. Reply with exactly KWS_DIAGNOSTIC_OK and nothing else.`；
  使用 profile 选择的单一协议和对应 endpoint，且必须在提取文本中匹配 sentinel 才判定通过。
- 复用 `requestProviderSuggestion`。该函数的成功结果补充安全的 `httpStatus`、`usageProvided`
  元数据；失败仍只抛 `AI_TIMEOUT`、`AI_PROVIDER_FAILED`、`AI_INVALID_RESPONSE` 或
  `AI_KEY_UNAVAILABLE`，原始上游正文不进入错误对象/API。
- Provider 层先过滤 usage 的 `null`/空字符串/布尔/小数/负数/超安全整数，过滤响应 request id
  的控制字符；未知 usage 在所有上层统一保持为 `null`。
- 成功 DTO：

  ```json
  {
    "status": "passed",
    "profile": { "id": "...", "name": "...", "protocol": "...", "model": "..." },
    "endpoint": "/chat/completions",
    "checks": {
      "reachable": true,
      "responseJson": true,
      "textExtracted": true,
      "usageReported": false
    },
    "reasoningEffortApplied": false,
    "httpStatus": 200,
    "durationMs": 123,
    "usage": { "inputTokens": null, "outputTokens": null },
    "providerRequestId": "bounded-id",
    "warnings": ["Provider 未返回 usage"],
    "checkedAt": "2026-08-31T00:00:00.000Z"
  }
  ```

  `endpoint` 只返回固定协议后缀；`providerRequestId` 最多 128 字符。没有 usage 仍可通过诊断，
  仅将 `usageReported=false` 加入 warning。Responses 的 reasoning 只返回是否按 profile 发送，
  不声称模型具备完整 reasoning 能力。

## 指标数据契约

新增 `ai_request_metric` 表：

| 字段 | 约束 | 说明 |
|---|---|---|
| `id` | driver 自增主键 | 内部 ID，不暴露逐条记录 |
| `operation` | `copilot`/`knowledge`/`diagnostic` | 固定白名单 |
| `profile_id` | 最多 128 | 可为空字符串（未进入 profile 阶段） |
| `protocol` | 最多 64 | 固定协议摘要 |
| `model` | 最多 120 | 模型标识，不保存 URL |
| `outcome` | `success`/`failed`/`timeout` | 稳定结果分类 |
| `duration_ms` | 0–600000 | 整数，服务端截断 |
| `input_tokens` | nullable 非负整数 | 未知为 NULL |
| `output_tokens` | nullable 非负整数 | 未知为 NULL |
| `error_code` | 最多 64 | 仅稳定代码，成功为空 |
| `created_at` | ISO 文本 | 用于保留/时间窗口 |

`recordAiRequestMetricSafely` 负责归一化并吞掉数据库写入错误，同时输出不含敏感值的 warning。
Copilot、知识助手和诊断在 `finally` 中各记录一次，operation 分别为 `copilot_suggest`、
`knowledge_ask`、`provider_diagnostic`；指标写入不能改变主请求结果。

`listAiRequestMetricSummary({ from, to })` 只执行固定 SQL 聚合，返回：总量、成功/失败/超时、平均
耗时、已知 token 合计、任一 token 未知的计数，以及最多 3 个 operation 和 3 个 protocol 分组。
不提供逐请求查询。查询窗口由 API validator 限制为 1–720 小时；数据库层仍校验 ISO 时间和上限。

## 配置与清理

- `AI_METRICS_RETENTION_DAYS` 默认 30，合法范围 1–3650；启动 preflight 校验。
- `AI_METRICS_AUTO_CLEANUP` 默认开启，沿用现有 boolean-like 解析；启动和每小时按开关调用清理
  函数，关闭或清理失败只记录 `ai.metrics.cleanup.error` warning。
- 停用 AI 后不会产生新的 Provider 请求，但历史指标仍可按保留期和开关清理。

## 错误与安全

- 所有诊断/指标路由沿用 session、同源、JSON、管理员限流和统一 envelope。
- 诊断失败只返回已有稳定错误码对应的通用消息；审计动作 `ai.profile.diagnose` 仅保留
  profileId、协议、模型、结果、durationMs、errorCode 等白名单字段。
- 模型、URL、request ID、错误码在日志/DTO 中均有长度上限；不记录探针正文、API Key、完整
  Provider URL、响应正文、业务数据或知识库路径。
- `getProfileSnapshot` 只在服务端返回 clone；公共 profile DTO 继续掩码 key。

## 兼容与回滚

- 新表通过三数据库 `CREATE TABLE IF NOT EXISTS` 加法初始化，无 destructive migration；旧库
  启动自动创建表和索引。
- 新配置缺省可用；旧 profile/旧建议/旧知识历史不需迁移。
- 回滚代码不会删除新表/新配置；旧版本忽略它们即可。若诊断或指标模块故障，AI 主请求仍按
  原逻辑工作（metrics best-effort）。
