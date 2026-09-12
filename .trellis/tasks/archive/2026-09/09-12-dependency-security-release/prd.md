# 依赖安全与发布收尾

## Goal

消除当前生产依赖审计发现的 Nodemailer 安全风险，同时保持现有 SMTP/Webhook 通知、数据库 outbox、PM2 运行方式和公开 API 行为不变，为下一轮产品迭代建立干净的依赖与发布基线。

## Background and confirmed facts

- 当前仓库工作树干净，项目基线为 Node.js 24.x；本机验证环境为 Node.js `v24.19.0`、npm `12.0.2`。
- `package.json` 和 `package-lock.json` 当前使用 Nodemailer `9.0.5`（`package.json:35`、`package-lock.json:739-743`）。
- 使用 canonical registry 执行 `npm audit --omit=dev --registry=https://registry.npmjs.org` 当前报告 Nodemailer 1 个 high 级别聚合漏洞，涉及多个公告，受影响范围为 `<=9.1.0`。
- `npm audit fix --dry-run --registry=https://registry.npmjs.org` 给出的最小修复是 `nodemailer 9.0.5 => 9.1.1`；不采用 Express 5 或其他破坏性升级。
- `server/notify.js` 仅使用 `createTransport` 与 `sendMail` 的普通文本邮件路径，没有使用公告涉及的 legacy `resolveContent()` 调用；现有 outbox、SMTP 测试和通知失败降级逻辑必须保留。
- 当前云服务器已运行 Node 24 + PM2，Nginx 代理到 `127.0.0.1:3088`，用户已验证 SMTP 与 Feishu Webhook 可用；本任务只提供发布收尾验证步骤，不直接操作云服务器。

## Requirements

1. 将直接依赖 Nodemailer 从 `^9.0.5` 升级到包含修复的 `^9.1.1`，使用 npm 生成一致的锁文件，不手工编辑依赖树。
2. 不改变 `server/notify.js` 的传输选项、邮件正文、outbox 投递/重试、Webhook 逻辑、API 响应或配置变量名称。
3. 更新公开缺陷/发布门禁文档，使依赖基线准确反映 Nodemailer 修复版本及当前审计结论；不写入服务器地址、凭据、邮件地址或密钥。
4. 在本地完成依赖安装、完整测试、差异检查和 canonical registry 审计；记录任何与本任务无关的审计或安装异常，不通过修改测试掩盖问题。
5. 提供生产发布后的最小验证顺序：备份 → Git 同步 → `npm ci --omit=dev` → Nodemailer/应用启动 → PM2 重启 → health → SMTP 测试；不引入 systemd、Express 主版本升级或新的通知 provider。

## Out of scope

- Express 4 → 5 迁移或其他大版本依赖升级。
- SMTP/Webhook 协议、邮件模板、重试策略、数据库 schema、PM2/Nginx/systemd 架构调整。
- KyanetAccount 联动、Kanban 高级能力、用户侧 AI 或其他产品功能。
- 直接在云服务器执行升级、修改 `.env`、停止容器或切换进程管理器；这些步骤由用户按发布清单执行。

## Acceptance Criteria

- [ ] `package.json` 声明 Nodemailer `^9.1.1`，锁文件解析到 `9.1.1`，无无关依赖漂移。
- [ ] `npm ci` 后 `npm test` 全部通过（不少于当前 210 项），`git diff --check` 通过。
- [ ] `npm audit --omit=dev --registry=https://registry.npmjs.org` 不再报告 Nodemailer 漏洞；若 registry 出现新的无关报告，必须在文档中明确记录，不得静默忽略。
- [ ] 现有通知/outbox 回归仍通过，SMTP 配置读取和失败降级行为未改变；代码审查确认没有敏感配置进入仓库。
- [ ] `docs/plans/known-defects.md`、`docs/testing/release-checklist.md`（必要时相关部署文档）的 Nodemailer 版本/审计描述已同步，且没有把未执行的云端操作写成已完成。
- [ ] 生产发布说明包含备份、Git fast-forward、`npm ci --omit=dev`、PM2 `--update-env` 重启、health 和 SMTP 测试；用户执行后可用输出证明新版本已生效。

## Risks and deferred items

- Nodemailer 是补丁级升级，仍需本地通知回归和生产 SMTP 测试；若真实 SMTP 行为异常，停止发布并恢复上一锁文件/提交，不删除数据库或备份。
- npm 镜像可能不支持 audit API；审计证据统一使用 `https://registry.npmjs.org`，不把镜像 404 误判为安全通过。
- 本任务完成后再评估 P2 Kanban 实用增强；P1“我的工作区”和 KyanetAccount 相关工作继续按路线图暂缓。

## Open questions

无。版本选择、兼容性边界、生产操作权限和验收方式均已确定。
