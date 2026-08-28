# 部署手册

## 通用原则

- 使用 Node.js 24.x LTS，并确保 `better-sqlite3` 与实际 Node ABI 匹配。
- 应用默认绑定回环地址，由 Nginx、IIS 或 Caddy 处理公网 TLS。
- `.env`、数据库、备份、日志和真实域名配置只存在于部署环境。
- 生产部署前必须完成[发布门禁](../testing/release-checklist.md)。

## Linux：Nginx + PM2

```bash
sudo mkdir -p /var/www/kyanet-workstation
sudo chown -R "$USER:$USER" /var/www/kyanet-workstation
# 将已审核的项目文件同步到 /var/www/kyanet-workstation
cd /var/www/kyanet-workstation
cp .env.example .env
# npm 12：仅 package.json 中 allowScripts 声明的 better-sqlite3 会运行安装脚本
npm ci --omit=dev --foreground-scripts
npm run init-admin
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

复制 `deploy/nginx.kyanet-workstation.conf`，替换示例域名和证书路径后运行 `sudo nginx -t`，再 reload。不要直接使用模板中的示例域名申请证书。

## 反向代理与 TLS 发布门禁（D-004）

发布记录必须使用实际部署值在私有证据中完成，公开文档只保留占位符：

1. 确认 Node 只监听预期的回环/私网地址，公网端口不能绕过代理直连应用。
2. 将 `TRUST_PROXY` 设置为已确认的代理 hop 数；若来源地址/网段或拓扑未知，
   保持发布暂停，不用客户端伪造的 `X-Forwarded-*` 头作为证据。
3. 验证 HTTP→HTTPS 跳转、证书链与有效期、Host/Proto 转发和健康检查。
4. 从代理入口和应用直连分别发送同源管理写请求，确认直连伪造转发头不能通过
   同源保护（应被拒绝或被网络边界阻断）。
5. 记录配置检查命令（Nginx `nginx -t`、IIS/ARR 或 Caddy 等价检查）、request ID、
   监听地址、回滚点和停止条件；失败时恢复上一版本，不修改 DNS、证书、防火墙或
   第三方 provider，除非取得单独批准。

证据请使用[发布验证模板](./release-evidence-template.md)，实际域名、证书路径、
服务器地址和凭据仅放在被忽略的 `docs/internal/` 或部署系统。

## Windows 原生

```powershell
Copy-Item .env.example .env
npm ci --foreground-scripts
npm run init-admin
npm run start
```

长期运行可使用 PM2、NSSM 或 WinSW。反向代理可选 IIS/ARR、Caddy 或 Windows Nginx；应用仍建议监听 `127.0.0.1:3000`。

## WSL

在 WSL Ubuntu 中安装 Node.js 24.x LTS、Nginx 和构建工具，复制项目后执行：

```bash
cp .env.example .env
npm ci --omit=dev --foreground-scripts
npm run init-admin
pm2 start ecosystem.config.cjs --cwd ~/apps/kyanet-workstation
```

WSL 适合开发和预发布；长期生产优先使用 Linux 云服务器。

## 发布与回滚

1. 保存当前 Git 提交、配置摘要和数据库备份。
2. 在临时目录安装依赖并通过启动、health 和 API 冒烟。
3. 切换应用文件或 PM2 进程，确认反向代理和 TLS。
4. 若 health、日志或关键 API 异常，停止新进程并恢复上一版本文件与数据库备份。
5. 回滚结果必须记录时间、版本、原因和数据是否发生写入。

真实域名、服务器地址、管理员凭据和证书位置属于内部部署材料，不写入公开仓库；如需记录，放入被忽略的 `docs/internal/`。
