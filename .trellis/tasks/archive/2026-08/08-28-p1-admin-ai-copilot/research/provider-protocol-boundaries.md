# Provider 协议边界研究

研究日期：2026-08-28

## 目标

为管理员 Copilot 选择最小的 Provider 适配面，支持 OpenAI 官方、OpenAI-compatible
中转站、DeepSeek、GLM/Z.ai 和 Anthropic Claude，同时不把业务路由绑定到厂商 SDK。

## 已确认的协议事实

| 内部协议 | 请求路径（相对 Base URL） | 认证 | 响应文本提取候选 |
|---|---|---|---|
| `openai-chat` | `/chat/completions` | `Authorization: Bearer <key>` | `choices[0].message.content` |
| `openai-responses` | `/responses` | `Authorization: Bearer <key>` | `output_text`，或 `output[].content[].text` |
| `anthropic-messages` | `/messages` | `x-api-key: <key>` + 固定 `anthropic-version` | `content[].text` |

Base URL 由管理员配置为 API 根地址；适配器负责补齐协议路径，并允许用户直接填写
已包含该路径的地址以避免中转站重复拼接。实现必须统一处理尾部斜杠、无凭据 URL、
HTTP 状态码和有界响应体。

## 兼容性结论

- DeepSeek、GLM/Z.ai 以及多数中转站只要提供 Chat Completions 兼容接口，就使用
  `openai-chat`，不为品牌单独添加业务适配器。
- OpenAI Responses 与 Chat Completions 是不同的请求/响应结构；不能根据 Base URL
  或品牌猜测其兼容性，必须由 profile 明确选择协议。
- Anthropic 原生 Messages API 保留自己的 system/messages/认证结构，不在业务层强行
  转换成 OpenAI 格式。
- 首版仅支持固定认证模式，不接受任意 Header。若未来出现 Azure、企业网关或特殊
  中转站需求，应为具体需求设计白名单字段并配套脱敏测试。

## Node.js 实现约束

- 使用 Node.js 24 内置 `fetch`、`AbortController` 和 `crypto`；不引入 OpenAI、Anthropic
  或其他厂商 SDK。
- Provider 模块接受可注入的 `fetch` 实现，使单元测试可以使用本地 HTTP server 或
  stub，而不需要向真实 Provider 发送请求。
- 每次请求设置 AbortSignal 超时，并在读取响应时同时限制 Content-Length 和实际字节数。
- 业务层只接收统一结果：结构化建议、可选 usage、duration、request ID 和有界错误；
  不把原始上游 JSON 或错误正文写入日志/管理端。

## 参考文档

- OpenAI Chat Completions API：<https://platform.openai.com/docs/api-reference/chat/create>
- OpenAI Responses API：<https://platform.openai.com/docs/api-reference/responses/create>
- Anthropic Messages API：<https://docs.anthropic.com/en/api/messages>

以上页面可能按登录状态或前端脚本返回不同内容；实现以协议字段和本任务的适配器
测试契约为准，不把页面抓取结果当作 Provider 可用性证明。
