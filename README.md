# KyanetWorkStation (Self-Hosted)

一个面向小规模用户（约 20 人）的轻量反馈+任务收集系统，已从原 CloudBase 架构迁移为本地/云服务器可运行版本。

- 前端：纯静态 `HTML/CSS/JS`
- 后端：`Node.js + Express`
- 数据库：`SQLite / MySQL / PostgreSQL`
- 反向代理：`Nginx / IIS / Caddy`
- 进程托管：`PM2`

本项目强调低资源占用、低维护成本和可控部署，适合 2C4G/4C4G 服务器并行运行多个小项目。

## 1. 架构

```text
Browser
  -> Reverse Proxy (Nginx / IIS / Caddy)
  -> Express app (API + static files)
  -> Relational DB (SQLite / MySQL / PostgreSQL)
```

- 入口页：`/` (`public/index.html`)
- 反馈页：`/feedback/` (`public/feedback/index.html`)
- WorkTask 页：`/worktask/` (`public/worktask/index.html`)
- 管理页：`/admin/` (`public/admin/index.html`)
- API：`/api/*`

## 2. 功能清单

### 用户侧
- 提交反馈（类型、标题、内容、联系方式）
- 提交 WorkTask/任务（类型、优先级、期望时间、标签）
- 主页“当前处理进展”展示栏（后台可控制是否显示）
- 前端长度限制与字数统计
- 提交按钮防重复点击
- 成功/失败提示

### 管理侧
- 管理员账号登录（会话 Cookie）
- 统一管理面板切换板块（反馈管理 / WorkTask 管理）
- 本人任务录入（管理侧直接创建任务）
- 按状态与关键词筛选
- 分页查看反馈列表
- 修改状态：`new/reviewed/resolved/notplanned`
- 删除反馈
- WorkTask 安排（负责人 + 计划时间）
- 反馈/WorkTask 的“主页显示”开关
- CSV 导出（支持筛选后的全量导出）
- 统计卡片（总量 + 各状态）
- 外部 SMTP 邮件通知（新反馈 / 新任务）
- 管理员手动 SMTP 测试发信（用于联调与排错）
- 外部 Webhook 机器人通知（企业微信/飞书/Lark/钉钉/Slack/Generic）
- 管理员手动 Webhook 测试消息（用于联调与排错）
- 结构化日志与请求日志（请求ID、耗时、状态码）

## 3. 项目目录

```text
.
├─ public/
│  ├─ index.html
│  ├─ theme.js
│  ├─ feedback/index.html
│  ├─ worktask/index.html
│  └─ admin/
│     ├─ index.html
│     └─ admin.js
├─ server/
│  ├─ app.js
│  ├─ auth.js
│  ├─ config.js
│  ├─ db.js
│  ├─ errors.js
│  ├─ logger.js
│  ├─ notify.js
│  ├─ validation.js
│  └─ webhook.js
├─ scripts/
│  ├─ init-admin.js
│  ├─ backup-db.js
│  ├─ backup-db-rdbms.js
│  ├─ backup-db.sh
│  └─ backup-db.ps1
├─ deploy/
│  ├─ nginx.kyanet-workstation.conf
│  ├─ iis.web.config.template
│  └─ Caddyfile.kyanet-workstation
├─ data/                 # SQLite 数据目录（DB_CLIENT=sqlite 时使用）
├─ backups/              # SQLite 备份目录（DB_CLIENT=sqlite 时使用）
├─ ecosystem.config.cjs  # PM2 配置
├─ .env.example
├─ tests/
└─ package.json
```

## 4. API 清单

### `GET /api/health`
健康检查接口。默认仅返回基础状态与时间；当 `HEALTH_EXPOSE_COUNTS=true` 时额外返回业务计数。

### `POST /api/feedback`
提交反馈。

请求体：

```json
{
  "type": "Bug",
  "title": "标题",
  "content": "详细内容",
  "contact": "联系方式",
  "images": []
}
```

### `POST /api/worktask`
提交 WorkTask/任务。

请求体：

```json
{
  "type": "WorkTask提交",
  "title": "标题",
  "content": "详细说明",
  "contact": "联系方式",
  "priority": "medium",
  "expectedAt": "2026-05-01T12:00:00.000Z",
  "tags": "前端,协作"
}
```

### `POST /api/admin/login`
管理员登录，成功后下发 HttpOnly Cookie。要求：
- `Content-Type: application/json`
- 请求需来自同源页面（默认要求带 Origin/Referer 头）

请求体：

```json
{
  "username": "admin",
  "password": "your-password"
}
```

### `POST /api/admin/logout`
注销当前会话。

### `GET /api/admin/me`
检查当前登录态。

### `POST /api/admin/notify/smtp-test`
管理员触发 SMTP 测试发信。可选指定测试收件人（逗号分隔），留空则使用 `SMTP_TO`。

请求体：

```json
{
  "to": "admin@example.com,dev@example.com"
}
```

### `POST /api/admin/notify/webhook-test`
管理员触发 Webhook 测试消息。可选附加文本（用于区分测试批次）。

请求体：

```json
{
  "content": "本次用于联调企业微信群机器人"
}
```

### `GET /api/public/config`
读取前端展示配置（例如管理页时间显示时区与语言）。

返回体示例：

```json
{
  "ok": true,
  "data": {
    "displayTimezone": "Asia/Shanghai",
    "displayLocale": "zh-CN"
  }
}
```

### `GET /api/public/highlights`
读取主页“当前处理进展”展示数据。

- 反馈侧返回：`status IN (new, reviewed)` 且 `show_on_home = true`
- WorkTask 侧返回：`status IN (new, scheduled, in_progress)` 且 `show_on_home = true`

### `POST /api/admin/feedback/list`
按状态/关键词分页查询反馈列表。

请求体：

```json
{
  "status": "new",
  "keyword": "关键词",
  "page": 1,
  "pageSize": 20
}
```

返回体包含：`items/page/pageSize/total/summary/totalPages`

### `POST /api/admin/feedback/status`
修改反馈状态。

请求体：

```json
{
  "id": 123,
  "status": "resolved"
}
```

### `POST /api/admin/feedback/delete`
删除反馈。

请求体：

```json
{
  "id": 123
}
```

### `POST /api/admin/feedback/home-display`
设置反馈是否在主页展示栏显示。

请求体：

```json
{
  "id": 123,
  "showOnHome": true
}
```

### `POST /api/admin/feedback/note-reply`
保存反馈的“管理员备注（后台可见）”和“对外回复（主页可见）”。

请求体：

```json
{
  "id": 123,
  "adminNote": "仅管理员可见的备注",
  "publicReply": "对外展示的回复内容"
}
```

### `POST /api/admin/worktask/list`
按状态/优先级/关键词分页查询 WorkTask 列表。

### `POST /api/admin/worktask/create`
管理员直接创建本人任务（无需填写联系方式）。

请求体示例：

```json
{
  "type": "任务安排",
  "title": "巡检与配置核对",
  "content": "本周完成服务巡检和配置核查",
  "priority": "medium",
  "status": "scheduled",
  "showOnHome": true,
  "assignee": "Kyan",
  "expectedAt": "2026-05-01T12:00:00.000Z",
  "scheduledAt": "2026-04-30T10:00:00.000Z",
  "tags": "运维,巡检",
  "adminNote": "内部说明",
  "publicReply": "已排期处理中"
}
```

### `POST /api/admin/worktask/status`
更新 WorkTask 状态（`new/scheduled/in_progress/completed/cancelled`）。

### `POST /api/admin/worktask/arrange`
保存 WorkTask 安排（负责人、计划时间、可选状态）。

### `POST /api/admin/worktask/delete`
删除 WorkTask。

### `POST /api/admin/worktask/home-display`
设置 WorkTask 是否在主页展示栏显示。

### `POST /api/admin/worktask/note-reply`
保存 WorkTask 的“管理员备注（后台可见）”和“对外回复（主页可见）”。

请求体：

```json
{
  "id": 123,
  "adminNote": "排期约束与内部备注",
  "publicReply": "当前处理中，预计本周完成"
}
```

## 5. 快速启动（本地）

### 5.1 环境准备
- Node.js 20+
- npm 10+

### 5.2 安装与配置

```bash
cp .env.example .env
npm install
```

修改 `.env` 中至少以下项：
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `APP_BASE_URL`
- `DB_CLIENT`（默认 `sqlite`）
- 当 `DB_CLIENT=mysql|postgres` 时，额外配置 `DATABASE_URL`

数据库连接示例：

```dotenv
# SQLite（默认）
DB_CLIENT=sqlite
DB_PATH=./data/workstation.db

# MySQL
DB_CLIENT=mysql
DATABASE_URL=mysql://user:password@127.0.0.1:3306/kyanet_workstation

# PostgreSQL
DB_CLIENT=postgres
DATABASE_URL=postgres://user:password@127.0.0.1:5432/kyanet_workstation
```

### 5.3 初始化管理员

```bash
npm run init-admin
```

### 5.4 启动服务

```bash
npm run start
```

访问：
- 入口页：`http://127.0.0.1:3000/`
- 反馈页：`http://127.0.0.1:3000/feedback/`
- WorkTask 页：`http://127.0.0.1:3000/worktask/`
- 管理页：`http://127.0.0.1:3000/admin/`

## 6. Ubuntu/Linux 生产部署（Nginx + PM2）

### 6.1 部署应用

```bash
sudo mkdir -p /var/www/kyanet-workstation
sudo chown -R $USER:$USER /var/www/kyanet-workstation
# 将项目文件同步到 /var/www/kyanet-workstation
cd /var/www/kyanet-workstation
cp .env.example .env
npm install --omit=dev
npm run init-admin
```

### 6.2 PM2 托管

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

### 6.3 配置 Nginx

```bash
sudo cp deploy/nginx.kyanet-workstation.conf /etc/nginx/sites-available/kyanet-workstation.conf
sudo ln -s /etc/nginx/sites-available/kyanet-workstation.conf /etc/nginx/sites-enabled/kyanet-workstation.conf
sudo nginx -t
sudo systemctl reload nginx
```

### 6.4 证书

建议使用 Certbot 申请与续期 TLS 证书（示例域名见 `deploy/nginx.kyanet-workstation.conf`）。

## 7. Windows 原生部署运行（PowerShell）

适用于你希望直接在 Windows Server 或 Windows 本机长期运行服务。

### 7.1 环境准备
- Windows Server 2019/2022 或 Windows 10/11
- Node.js 20+
- npm 10+
- （可选）反向代理：IIS/ARR、Caddy 或 Windows 版 Nginx

### 7.2 初始化与启动

```powershell
cd path\to\KyanetWorkStation
Copy-Item .env.example .env
npm install
npm run init-admin
npm run start
```

访问：
- 用户页：`http://127.0.0.1:3000/`
- 管理页：`http://127.0.0.1:3000/admin/`

### 7.3 Windows 持久化运行（PM2）

```powershell
npm install -g pm2
pm2 start server/app.js --name kyanet-workstation --cwd path\to\KyanetWorkStation
pm2 save
```

说明：
- Windows 下 PM2 可用于守护进程，但“开机自启”建议结合任务计划程序或 `pm2-windows-startup`。
- 若不使用 PM2，也可用 NSSM/WinSW 注册为 Windows 服务。

### 7.4 Windows 反向代理建议
- 推荐把 80/443 交给 IIS/Caddy/Nginx，再反代到 `127.0.0.1:3000`。
- 若启用 HTTPS，请将 `.env` 的 `APP_BASE_URL` 改为实际 `https://` 域名。

### 7.5 IIS 反向代理模板（URL Rewrite + ARR）

前置条件：
- 已安装 IIS
- 已安装 **URL Rewrite** 模块
- 已安装并启用 **Application Request Routing (ARR)**

使用方式：
1. 在 IIS 站点根目录放置 `deploy/iis.web.config.template` 内容，保存为 `web.config`。  
2. 确认站点绑定了你的域名（80/443）并配置证书。  
3. 在 ARR 中启用 `Proxy`。  
4. 保持 Node 服务监听 `127.0.0.1:3000`。  

模板文件：`deploy/iis.web.config.template`

### 7.6 Caddy 反向代理模板（Windows）

1. 复制模板：

```powershell
Copy-Item .\deploy\Caddyfile.kyanet-workstation targetpath\Caddy\Caddyfile
```

2. 将 `workstation.example.com` 改成你的域名。  
3. 启动 Caddy（示例）：

```powershell
caddy run --config targetpath\Caddy\Caddyfile
```

4. Caddy 会自动申请/续期 HTTPS 证书（确保域名已正确解析到服务器）。  

模板文件：`deploy/Caddyfile.kyanet-workstation`

## 8. WSL 部署运行（Ubuntu in WSL）

适用于你在 Windows 主机上，用 WSL Ubuntu 运行 Node + Nginx。

### 8.1 WSL 环境准备

```bash
wsl --install -d Ubuntu
```

进入 WSL 后安装基础依赖：

```bash
sudo apt update
sudo apt install -y curl git build-essential nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### 8.2 部署项目（WSL 内）

```bash
mkdir -p ~/apps/kyanet-workstation
cd ~/apps/kyanet-workstation
# 将项目文件同步到该目录
cp .env.example .env
npm install --omit=dev
npm run init-admin
```

### 8.3 启动与守护

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs --cwd ~/apps/kyanet-workstation
pm2 save
```

### 8.4 Nginx 反向代理（WSL 内）

```bash
sudo cp deploy/nginx.kyanet-workstation.conf /etc/nginx/sites-available/kyanet-workstation.conf
sudo ln -s /etc/nginx/sites-available/kyanet-workstation.conf /etc/nginx/sites-enabled/kyanet-workstation.conf
sudo nginx -t
sudo systemctl reload nginx
```

说明：
- 若 WSL 未启用 systemd，可直接 `sudo service nginx start`。
- 生产推荐使用 Linux 云服务器；WSL 更适合开发、预发布或轻量自用场景。

## 9. 环境变量说明

| 变量 | 说明 | 默认值 |
|---|---|---|
| `NODE_ENV` | 运行环境 | `development` |
| `PORT` | 服务端口 | `3000` |
| `LISTEN_HOST` | 监听地址（建议仅本机） | `127.0.0.1` |
| `TRUST_PROXY` | 代理层数（直连开发建议 `0`，反代部署建议 `1`） | 开发 `0` / 生产反代 `1` |
| `APP_BASE_URL` | 站点地址 | `http://127.0.0.1:3000` |
| `HEALTH_EXPOSE_COUNTS` | 健康检查是否暴露业务计数 | `false` |
| `ADMIN_ALLOW_HEADERLESS_MUTATION` | 是否允许无 Origin/Referer 的管理写请求（调试专用） | `false` |
| `LOG_LEVEL` | 应用日志级别（`trace/debug/info/warn/error/fatal`） | `info` |
| `LOG_TO_FILE` | 是否额外写入日志文件 | `false` |
| `LOG_DIR` | 日志目录（`LOG_TO_FILE=true` 时生效） | `./logs` |
| `ACCESS_LOG_ENABLED` | 是否启用请求日志 | `true` |
| `ACCESS_LOG_SKIP_HEALTH` | 是否跳过 `/api/health` 请求日志 | `true` |
| `ACCESS_LOG_SLOW_MS` | 慢请求阈值（毫秒，超过按 `warn` 记录） | `800` |
| `SESSION_COOKIE_NAME` | 会话 Cookie 名 | `kws_sid` |
| `SESSION_TTL_HOURS` | 会话有效期（小时） | `168` |
| `BCRYPT_ROUNDS` | 密码哈希轮数 | `12` |
| `ADMIN_USERNAME` | 管理员用户名（引导/脚本使用） | - |
| `ADMIN_PASSWORD` | 管理员密码（引导/脚本使用） | - |
| `DB_CLIENT` | 数据库类型（`sqlite/mysql/postgres`） | `sqlite` |
| `DATABASE_URL` | MySQL/PostgreSQL 连接串（非 sqlite 时必填） | - |
| `DB_PATH` | SQLite 路径 | `./data/workstation.db` |
| `RATE_LIMIT_SUBMIT_WINDOW_MS` | 提交限流窗口 | `600000` |
| `RATE_LIMIT_SUBMIT_MAX` | 提交限流次数 | `20` |
| `RATE_LIMIT_LOGIN_WINDOW_MS` | 登录限流窗口 | `900000` |
| `RATE_LIMIT_LOGIN_MAX` | 登录限流次数 | `10` |
| `RATE_LIMIT_ADMIN_WINDOW_MS` | 管理接口限流窗口 | `60000` |
| `RATE_LIMIT_ADMIN_MAX` | 管理接口限流次数 | `120` |
| `DISPLAY_TIMEZONE` | 前端展示时区（管理页时间显示） | `Asia/Shanghai` |
| `DISPLAY_LOCALE` | 前端展示语言区域（管理页时间显示） | `zh-CN` |
| `BACKUP_DIR` | 备份目录 | `./backups` |
| `BACKUP_RETENTION_DAYS` | 备份保留天数 | `30` |
| `SMTP_ENABLED` | 是否启用 SMTP 通知 | `false` |
| `SMTP_HOST` | SMTP 服务器地址 | - |
| `SMTP_PORT` | SMTP 端口 | `587` |
| `SMTP_SECURE` | 是否使用 SSL（465 常用 `true`） | `false` |
| `SMTP_REQUIRE_TLS` | 是否要求 TLS | `true` |
| `SMTP_USER` | SMTP 用户名 | - |
| `SMTP_PASS` | SMTP 密码/授权码 | - |
| `SMTP_FROM` | 发件人邮箱 | - |
| `SMTP_TO` | 收件人列表（逗号分隔） | - |
| `SMTP_SUBJECT_PREFIX` | 邮件标题前缀 | `[KyanetWorkStation]` |
| `WEBHOOK_ENABLED` | 是否启用 Webhook 通知 | `false` |
| `WEBHOOK_PROVIDER` | Webhook 平台（`wecom/feishu/lark/dingtalk/slack/generic`） | `generic` |
| `WEBHOOK_URLS` | Webhook 地址列表（逗号分隔） | - |
| `WEBHOOK_SECRET` | 可选密钥（Generic 签名 / 钉钉签名） | - |
| `WEBHOOK_TIMEOUT_MS` | Webhook 请求超时（毫秒） | `5000` |
| `WEBHOOK_TITLE_PREFIX` | Webhook 标题前缀 | `[KyanetWorkStation]` |

### 9.1 切换到 MySQL / PostgreSQL

1. 在数据库服务中先创建数据库（例如 `kyanet_workstation`）。
2. 修改 `.env`：

```dotenv
DB_CLIENT=mysql
DATABASE_URL=mysql://user:password@127.0.0.1:3306/kyanet_workstation
```

或

```dotenv
DB_CLIENT=postgres
DATABASE_URL=postgres://user:password@127.0.0.1:5432/kyanet_workstation
```

3. 重新安装依赖（确保含 `mysql2` / `pg`）：

```bash
npm install
```

4. 执行管理员初始化：

```bash
npm run init-admin
```

5. 启动服务，首次启动会自动建表：

```bash
npm run start
```

## 10. 备份与恢复

说明：
- `scripts/backup-db.sh` 与 `scripts/backup-db.ps1` 仅支持 `DB_CLIENT=sqlite`。
- `scripts/backup-db-rdbms.js` 支持 `DB_CLIENT=mysql|postgres`。
- 两者均通过 `scripts/backup-db.js` 使用 SQLite 在线备份 API 生成快照，避免 WAL 模式下直接压缩主库文件造成的不一致风险。
- MySQL/PostgreSQL 备份由脚本内部调用 `mysqldump/pg_dump`，需提前安装对应客户端工具。

### 10.1 手动备份（Linux/WSL）

```bash
bash scripts/backup-db.sh
# 或 npm run backup-db:linux
# 或 npm run backup-db:core
```

提示：若你当前 `.env` 的 `DB_CLIENT` 不是 `sqlite`，可临时覆盖执行：

```bash
DB_CLIENT=sqlite npm run backup-db:core
```

### 10.2 手动备份（Windows）

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\backup-db.ps1
# 或 npm run backup-db:win
```

若当前 `.env` 不是 `sqlite`，可用：

```powershell
$env:DB_CLIENT="sqlite"; npm run backup-db:core
```

### 10.3 MySQL/PostgreSQL 备份示例

统一脚本（推荐）：

```bash
npm run backup-db:rdbms
```

MySQL（手动 `mysqldump`）：

```bash
mysqldump --single-transaction --quick --routines --triggers \
  -h 127.0.0.1 -P 3306 -u your_user -p kyanet_workstation > backup.sql
```

PostgreSQL（手动 `pg_dump`）：

```bash
pg_dump -h 127.0.0.1 -p 5432 -U your_user -d kyanet_workstation -F c -f backup.dump
```

### 10.4 定时备份（SQLite, Linux/WSL，每天 03:30）

```bash
crontab -e
```

添加：

```cron
30 3 * * * cd /var/www/kyanet-workstation && /usr/bin/bash scripts/backup-db.sh >> /var/log/kyanet-workstation-backup.log 2>&1
```

### 10.5 定时备份（SQLite, Windows，任务计划程序）

可创建每日任务，执行：

```powershell
powershell.exe -ExecutionPolicy Bypass -File E:\Workplace\Projects\KyanetWorkStation\scripts\backup-db.ps1
```

### 10.6 恢复
1. 停止 PM2 服务。
2. 解压目标备份到 `data/workstation.db`。
3. 启动 PM2 服务。

## 11. 安全基线

- `helmet` 安全头
- 登录/提交/管理接口限流
- 后端输入校验（长度、枚举、分页）
- 统一错误响应结构
- 会话 Cookie：`HttpOnly + SameSite=Strict`
- 管理写接口来源校验（Origin/Referer/Sec-Fetch-Site）
- 管理写接口仅接受 `application/json`
- 管理员密码使用 `bcrypt` 哈希存储

## 12. 日志说明

- 运行时日志采用 `pino` 结构化日志（JSON）。
- 每个请求会记录 `requestId`，并通过响应头 `x-request-id` 回传，便于排障串联。
- 默认输出到标准输出（适配 PM2 / 容器）。
- 当 `LOG_TO_FILE=true` 时，会额外写入 `${LOG_DIR}/app.log`。

常用查看方式：

```bash
pm2 logs kyanet-workstation
```

慢请求：
- 当请求耗时超过 `ACCESS_LOG_SLOW_MS`（默认 `800ms`）时，日志级别提升为 `warn`。

## 13. 性能与资源建议

针对 2C4G/4C4G 且同机多个小项目：

- PM2 单实例 `fork` 模式
- `max_memory_restart` 建议 `250M~350M`
- Nginx 开启 gzip（可选）
- SQLite 保持本地磁盘 + WAL
- 日常操作目标：API P95 < 300ms

## 14. 常见问题

### Q1: 管理页提示未登录/会话失效
- 检查是否走 HTTPS（生产环境 Cookie `secure`）
- 检查 Nginx `X-Forwarded-*` 头是否正确
- 检查 `TRUST_PROXY=1`

### Q2: 登录失败
- 先运行 `npm run init-admin` 重置管理员密码
- 检查 `.env` 中 `ADMIN_USERNAME/ADMIN_PASSWORD`

### Q3: 页面能开但 API 404
- 检查 Nginx 是否把 `/` 反代到 `127.0.0.1:3000`
- 检查 PM2 进程是否在线

### Q4: 备份没生成
- 若 `DB_CLIENT=sqlite`：检查 `scripts/backup-db.sh` 执行权限与 `DB_PATH`
- 若 `DB_CLIENT=mysql|postgres`：优先使用 `npm run backup-db:rdbms`，并确认系统已安装 `mysqldump/pg_dump`
- 检查 cron 或任务计划程序日志输出

### Q5: Windows 下 PM2 重启后未自启
- 使用任务计划程序在开机时执行 `pm2 resurrect`
- 或改用 NSSM/WinSW 注册服务并设置自动启动

### Q6: `better-sqlite3` 报错 `invalid ELF header` 或 `not a valid Win32 application`
- 原因：在 Windows 与 WSL 之间复用了同一份 `node_modules`，原生模块二进制与当前运行平台不匹配
- 处理方式：
  1. 在当前运行环境内删除并重装依赖（Windows 用 Windows Node，WSL 用 Linux Node）
  2. 避免在 `C:\` 与 `/mnt/c` 之间混用同一套 `node_modules`
  3. 如在 WSL 运行服务，建议项目目录放在 WSL Linux 文件系统（如 `~/apps/...`）再执行 `npm install`

## 15. 版本范围说明

当前版本按以下范围实现：
- 保留文本+链接反馈模式
- 不包含原生图片上传
- 包含 SMTP 邮件通知（新反馈/新任务）
- 包含 Webhook 机器人通知（企业微信/飞书/Lark/钉钉/Slack/Generic）
- 单管理员账号模型



