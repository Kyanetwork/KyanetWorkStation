# 部署手册

## 通用原则

- 使用 Node.js 24.x LTS，并确保 `better-sqlite3` 与实际 Node ABI 匹配。
- 应用默认绑定回环地址，由 Nginx、IIS 或 Caddy 处理公网 TLS。
- `.env`、数据库、备份、日志和真实域名配置只存在于部署环境。
- 生产部署前必须完成[发布门禁](../testing/release-checklist.md)。

## 当前进程管理选择

本次云服务器发布选择 PM2 管理单实例，暂不启用项目级
`kyanet-workstation.service`。PM2 的 `autorestart` 会在应用异常退出时重新拉起进程，
`max_memory_restart` 会在超过内存阈值时重启；`pm2 startup` 只负责让 PM2 守护进程在
系统启动后恢复保存的进程列表。它生成的 systemd 启动项不等于启用本项目的 systemd
unit。两种管理器不能同时绑定 3000 端口。

## 发布同步与文件边界

生产环境推荐使用 Git 同步已审核的提交；前提是该提交已经推送到远端，且服务器
目录是 Git 工作树。不要在服务器上直接修改源文件，也不要使用 `git clean -fdx`
或用 `.env.example` 覆盖现有配置。

常规发布步骤如下。`main` 和版本号按实际发布策略替换，发布前先保留上一提交和
数据库备份：

```bash
cd /var/www/kyanet-workstation
git status --short
git fetch origin
git pull --ff-only origin main
npm ci --omit=dev --foreground-scripts
node -e "require('better-sqlite3')(':memory:').close(); console.log('better-sqlite3 ok')"
```

若当前目录是手动上传的、没有可信 Git 历史，先在旁边目录克隆并完成健康检查，
再切换服务目录；不要在未备份时对现有目录执行 `git init` 或强制覆盖。Git 更新
只应覆盖受版本控制的代码、静态资源、脚本和文档。以下内容必须保留在部署环境，
并在切换前后核对权限和可读性：

| 保留项 | 处理原则 |
|---|---|
| `.env` | 生产配置和密钥；只编辑实际值，生产 `APP_BASE_URL` 使用 HTTPS |
| `data/workstation.db` 及 `-wal`/`-shm` | 业务数据；停服务或按备份脚本要求生成一致性副本 |
| `backups/` | 备份文件；不要随代码清理 |
| `logs/`、`notification-handoff.jsonl` | 观测和人工补偿记录；按权限/轮转策略保留 |
| 宝塔 Nginx 配置、证书和防火墙规则 | 由宝塔/系统单独管理，不从仓库模板直接覆盖 |
| systemd unit | `/etc/systemd/system/kyanet-workstation.service`，由系统管理员管理 |

不要把生产 `.env`、数据库、备份或日志复制回 Git 工作树。若必须继续手动上传，
也应只上传与提交对应的代码文件，并逐项排除上表内容；长期维护仍以 Git 提交作为
唯一发布基线。

## Linux：Nginx + PM2

```bash
APP_DIR=/var/www/kyanet-workstation  # 按实际服务器目录替换
sudo mkdir -p "$APP_DIR"
sudo chown -R "$USER:$USER" "$APP_DIR"
# 将已审核的项目文件同步到 "$APP_DIR"
cd "$APP_DIR"
# 仅首次部署创建配置；已有生产 .env 必须保留
[ -f .env ] || cp .env.example .env
# npm 12：仅 package.json 中 allowScripts 声明的 better-sqlite3 会运行安装脚本
npm ci --omit=dev --foreground-scripts
npm run init-admin
npm install -g pm2
pm2 startup
# 执行上一步打印出的 sudo ... pm2 startup ... 命令（只需首次执行）
pm2 start ecosystem.config.cjs --only kyanet-workstation --update-env
pm2 save
pm2 status
pm2 show kyanet-workstation
```

`ecosystem.config.cjs` 使用 `__dirname` 解析应用目录，因此不依赖固定服务器路径。若
3000 已被手动启动的 Node 进程占用，先确认其 PID、启动方式和
日志，再在维护窗口优雅停止旧进程，确认端口释放后再执行 `pm2 start`，不要直接强制
杀掉未知进程。

更新代码或 Node 后：

```bash
cd "$APP_DIR"
npm ci --omit=dev --foreground-scripts
node -e "require('better-sqlite3')(':memory:').close(); console.log('better-sqlite3 ok')"
pm2 restart kyanet-workstation --update-env
pm2 save
pm2 status
curl -fsS http://127.0.0.1:3000/api/health
```

在维护窗口可用 `pm2 logs kyanet-workstation --lines 50` 查看最近日志。要验证开机恢复，
先确认 `pm2 save` 已完成，再重启服务器；重新登录后检查 `pm2 status`、`pm2 show
kyanet-workstation` 和 health。不要把 `pm2 startup` 生成的 PM2 unit 与下方项目级
systemd unit 同时启用。

复制 `deploy/nginx.kyanet-workstation.conf`，替换示例域名和证书路径后运行 `sudo nginx -t`，再 reload。不要直接使用模板中的示例域名申请证书。

## Linux：systemd 单实例

systemd 与 PM2 二选一管理应用，不能同时启动同一个端口。若从 PM2 切换，先在
运行 PM2 的用户下停止并移除该应用，再启用下面的 unit；不要删除数据库或备份：

```bash
pm2 stop kyanet-workstation
pm2 delete kyanet-workstation
pm2 save
```

创建专用运行用户并确保它能读写 `.env`、`data/`、`backups/`、`logs/` 和 handoff
journal（已有专用用户时跳过创建）：

```bash
sudo useradd --system --home /var/www/kyanet-workstation --shell /usr/sbin/nologin kyanet || true
sudo chown -R kyanet:kyanet /var/www/kyanet-workstation
sudo chmod 600 /var/www/kyanet-workstation/.env
```

写入 `/etc/systemd/system/kyanet-workstation.service`：

```ini
[Unit]
Description=Kyanet WorkStation
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=kyanet
Group=kyanet
WorkingDirectory=/var/www/kyanet-workstation
EnvironmentFile=/var/www/kyanet-workstation/.env
ExecStart=/usr/bin/node /var/www/kyanet-workstation/server/app.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
KillSignal=SIGTERM

[Install]
WantedBy=multi-user.target
```

`ExecStart` 必须使用实际 Node 24 的绝对路径。NodeSource 通常为
`/usr/bin/node`；如果使用 NVM，请以 `readlink -f "$(command -v node)"` 的结果
替换，并确认该路径对 `User=kyanet` 可执行。启用并检查：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now kyanet-workstation
sudo systemctl status kyanet-workstation --no-pager
journalctl -u kyanet-workstation -n 50 --no-pager
curl -fsS http://127.0.0.1:3000/api/health
ss -ltnp | grep ':3000'
```

更新代码或 Node 后使用 `sudo systemctl restart kyanet-workstation`，失败时先查看
`journalctl -u kyanet-workstation`，确认 health、监听地址和 Nginx，再决定回滚。
不要同时保留 PM2 自启动和 systemd 自启动。

## Ubuntu 24.04：Node.js 20 → 24 LTS

项目发布基线为 Node.js 24.x。升级前先确认当前 Node 的来源和服务管理方式，保留这些输出作为回滚记录；不要在未确认来源时混用系统包管理器和 NVM：

```bash
node -v
npm -v
command -v node
readlink -f "$(command -v node)"
systemctl status kyanet-workstation --no-pager || true
pm2 list || true
```

### 系统级安装（NodeSource，适合 PM2/systemd）

以下命令会把 Ubuntu 的 Node.js 包切换到 NodeSource 的 24.x 源，不需要先删除旧版：

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg

sudo install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
  | sudo gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" \
  | sudo tee /etc/apt/sources.list.d/nodesource.list

sudo apt update
apt-cache policy nodejs
sudo apt install -y nodejs
```

确认版本和原生模块 ABI（Node 24 基线为 ABI `137`）：

```bash
node -v
npm -v
command -v node
node -p "process.versions.modules"
```

在应用目录重新安装生产依赖并检查 `better-sqlite3`。这不会覆盖 `.env` 或数据库文件：

```bash
cd /var/www/kyanet-workstation
npm ci --omit=dev --foreground-scripts
node -e "require('better-sqlite3')(':memory:').close(); console.log('better-sqlite3 ok')"
```

若原生模块加载失败，再执行一次显式重建并复查：

```bash
npm rebuild better-sqlite3
node -e "require('better-sqlite3')(':memory:').close(); console.log('better-sqlite3 ok')"
```

按实际进程管理器重启服务，并确认应用仍只监听预期的回环/私网地址：

```bash
# PM2
pm2 restart kyanet-workstation --update-env
pm2 save
pm2 status
pm2 logs kyanet-workstation --lines 50

# 或 systemd（二选一）
sudo systemctl daemon-reload
sudo systemctl restart kyanet-workstation
sudo systemctl status kyanet-workstation --no-pager

curl -fsS http://127.0.0.1:3000/api/health
```

### NVM 安装

如果 `command -v node` 指向 `.nvm`，不要添加 NodeSource 源，直接在运行服务的同一用户下执行：

```bash
nvm install 24
nvm alias default 24
nvm use 24
node -v
npm -v
node -p "process.versions.modules"

cd /var/www/kyanet-workstation
npm ci --omit=dev --foreground-scripts
npm rebuild better-sqlite3
pm2 update
pm2 restart kyanet-workstation --update-env
pm2 save
curl -fsS http://127.0.0.1:3000/api/health
```

NVM 场景必须确认 PM2 daemon 和 systemd unit 使用的是同一套 Node 24 路径；否则终端中的 `node -v` 可能已升级，而实际服务仍运行 Node 20。

### 失败时回滚

升级前保存的 Node 路径、包版本和 PM2/systemd 配置是回滚依据。若健康检查或原生模块加载失败，先停止新进程，恢复上一 Node 版本和依赖，再重启服务；不要删除数据库或备份。系统包回滚版本以 `apt-cache policy nodejs` 中实际可用版本为准，NVM 则使用 `nvm use <previous-major>`。回滚后再次执行 `node -v`、ABI 检查和 `/api/health`。

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
