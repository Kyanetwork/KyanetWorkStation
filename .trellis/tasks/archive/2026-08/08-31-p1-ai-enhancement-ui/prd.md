# P1 AI Copilot 参数、知识助手及 UI 统一

## Goal

在不改变现有 Node.js 24、Express 与静态 HTML/CSS/JavaScript 基本架构的前提下，
提升管理员 AI Copilot 的可控性与可解释性，增加可引用的个人知识助手，并将项目控件
统一为冷色、方正、无圆角的 WorkStation/HUD 视觉语言。

## Background and constraints

- 当前 AI 默认由 `AI_COPILOT_ENABLED` 控制；管理员在工作收件箱针对反馈或 WorkTask
  主动生成建议，AI 失败不阻塞普通业务流程。
- 当前建议包括摘要、分类、优先级、标签、相似条目、对外回复草稿、建议依据和缺失
  信息；管理员可复制、填入回复草稿、接受或拒绝字段级建议。
- 当前服务端使用 `buildCopilotInput` 白名单投影和内置 `buildCopilotPrompt`，不是把
  整条数据库记录原样发送给 Provider。`<user-data>`/`<similar-items>` 标记不可信文本，
  联系方式、管理员备注、账号快照不会发送，输入上限为 12 KiB。
- 当前支持多个 profile、单 active profile 热切换和 OpenAI Chat/Responses、Anthropic
  Messages；API Key 使用 AES-256-GCM 保存，浏览器不接触明文。
- 用户确认采用冷色 HUD 视觉方向 B，但最终产品严格使用直角方框；视觉伴随模板的圆角
  不属于产品设计。
- KyanetAccount 联动暂缓；项目偏个人使用，不建设复杂多租户/RBAC、自动写操作或新大型
  技术栈。
- 知识库由开发机/云服务器各自配置的外部只读目录提供，示例为
  `E:\\Workplace\\Projects\\@Knowledge-Base\\Minecraft\\TYUTland`；生产环境使用
  对应 Linux 路径，不将文档复制进仓库。

## Requirements

### R1. Profile 参数与受控 Prompt

- profile 向后兼容增加可选 `reasoning_effort`（内部字段可用 camelCase，接口契约统一
  说明）和有长度上限的 `promptInstruction`。
- `reasoning_effort` 只接受空值或 `low/medium/high/xhigh/max`；本轮仅对
  `openai-responses` 映射为 `reasoning.effort`。`openai-chat` 与 Anthropic 不发送，并在
  管理界面说明未应用。空值时请求体保持现状。
- 不接受任意 JSON 参数；API、数据库归一化、DTO 与审计均使用白名单/长度限制。
- 系统安全 prompt、脱敏白名单、不可信数据边界和结构化输出约束固定不可覆盖；
  `promptInstruction` 只能作为独立附加段，清空后恢复默认。审计不记录指令全文。

### R2. 受控本地知识库与问答

- 通过环境变量配置一个或多个知识库根目录（ID、显示名、绝对路径）；管理员页面不接受
  任意路径，只显示库名和相对路径。
- 只索引 `.md`/`.txt`；跳过隐藏/运行/秘密目录，校验真实路径和软链接边界，并限制根目录、
  文件、单文件、总索引和上下文大小。索引器只读，不写入原始目录。
- 管理员通过页面按钮或 CLI 显式扫描/重建；应用启动只加载已有缓存，不自动扫描，也不做
  常驻文件监听。扫描完成后原子替换版本化缓存，失败保留上一份有效缓存。
- 检索默认跨所有库，也可按库筛选；使用确定性 Unicode 词元/中文双字评分，返回少量有界
  片段。文档片段作为不可信资料发送给 Provider，不执行其中指令。
- 知识助手是管理员独立标签页；回答包含服务端映射的来源引用。命中不足时允许模型使用
  基础知识，但必须标注“非文档依据/未验证”，不得把推断伪装成文档结论。
- 知识助手不能修改反馈/WorkTask、发送通知、执行命令或读取未索引文件。

### R3. 问答历史与自动清理

- 完整问题、回答、依据标识、引用、使用 profile/模型、用量、内部 prompt 版本、创建/过期
  时间保存到跨 SQLite/MySQL/PostgreSQL 的管理员私有历史表；不保存 API Key、完整 prompt
  或机器绝对路径。
- 默认保留 30 天，`AI_KNOWLEDGE_HISTORY_RETENTION_DAYS` 可配置且有上限；过期记录不再参与
  问答。管理员可分页检索、单条删除和手动清理。
- 自动清理开关默认开启，保存在现有设置表；开启时应用启动清理一次并每小时执行，关闭时
  跳过自动任务但保留手动清理。清理/删除/重建均记录脱敏审计元数据。

### R4. 方正 UI 与可访问性

- 管理员页及相关公共页面所有按钮（分页、AI 动作、profile、设置、登录、工具栏）使用
  共享样式契约，覆盖主次/危险层级、hover、disabled、busy、focus-visible、亮暗主题。
- 统一使用冷蓝色细线和 HUD 状态层次，保持直角/方框、中文文字清晰、键盘可用、窄屏单列
  适配；消除页面内联 CSS 与共享规则冲突，不改变既有按钮业务语义。

### R5. 后续 P1-B 评估项

Provider 连接诊断、能力探测、耗时/token/失败指标、面向管理员的 prompt 版本对比、建议
差异对比、批量摘要和反馈闭环另建任务；自动 fallback/智能路由、向量数据库平台化、
用户侧或运维侧写操作以及 Account 联动不属于本任务。

## Acceptance Criteria

- [x] 现有 Copilot 测试继续通过；新增测试证明白名单 prompt 和敏感字段边界不变，未配置
      `reasoning_effort` 时请求体不变，Responses 配置按枚举发送，其他协议安全省略。
- [x] profile 可保存、更新、清空 `reasoning_effort` 与受控 `promptInstruction`；旧 profile
      可正常读取，列表/审计/日志不泄露密钥或指令全文。
- [x] 知识库能从多个受控目录扫描 `.md/.txt`，拒绝越界软链接/不支持文件，缓存原子替换，
      重建失败保留旧缓存；检索结果排序、范围与上下文上限有回归测试。
- [x] 知识助手问答返回结构化答案、`document/mixed/general` 依据和服务端映射引用；无充分
      命中时明确显示“非文档依据/未验证”；问答、引用、分页、删除、手动清理和自动清理开关
      均可通过管理员 API 与 UI 验证。
- [x] 自动清理默认开启，启动/每小时任务遵守开关，关闭后不自动删但手动操作有效；保留期
      配置被限制在安全范围。
- [x] 管理员及公共页面按钮不再出现浏览器默认样式，直角、亮暗主题、focus/disabled/busy、
      窄屏和键盘路径通过浏览器 smoke 检查。
- [x] `node --check`、相关 Node 测试、`npm test`、`npm audit`、`git diff --check` 通过；
      不泄露 API Key、未选中文档、秘密配置或绝对路径。

## Rollout and rollback constraints

- 新 profile 字段、知识设置、历史表和版本化索引缓存均为加法迁移；旧版本回滚不删除它们。
- 生产部署前需在云服务器配置只读知识库路径、确认同步完成后再手动重建索引；路径和文档
  内容不提交 Git。若索引版本不兼容，状态接口报告不可用并要求重新扫描。
- AI/索引/历史任一失败只影响 AI 管理功能，不阻塞反馈、WorkTask、登录、通知和导出。
