> 历史资料：本文是迁移阶段参考稿，仅供追溯，不代表当前 KyanetWorkStation 架构、部署方式或计划。

这个项目如果从 **CloudBase 云开发版本**迁移成**本地服务器运行版本**，本质上就是把：

```text
CloudBase 静态网站托管 + HTTP 访问服务 + 云函数 + 文档型数据库
```

替换为：

```text
Nginx/Caddy + Node.js 后端服务 + 本地/服务器数据库
```

也就是从 Serverless 架构变成传统 Web 服务架构。

------

# 一、迁移后的推荐架构

比较适合你这个项目的本地服务器架构是：

```text
浏览器
  ↓
Nginx / Caddy
  ↓
静态前端页面
  ↓
Node.js Express API
  ↓
SQLite / MySQL / PostgreSQL
```

对你目前的规模，我最推荐：

```text
前端：继续用 HTML / CSS / JS
后端：Node.js + Express
数据库：SQLite
反代：Nginx 或 Caddy
部署：PM2 或 Docker Compose
```

SQLite 就够用了，因为你这个系统数据量很小、并发低、结构简单。以后真要扩展，再换 MySQL/PostgreSQL 也不迟。

------

# 二、功能对应关系

CloudBase 版目前大致是：

```text
submitFeedback 云函数
adminListFeedback 云函数
adminUpdateFeedbackStatus 云函数
adminDeleteFeedback 云函数
feedback 文档型数据库
静态网站托管
```

迁移到本地服务器后，对应变成：

```text
POST /api/feedback                 提交反馈
POST /api/admin/feedback/list       管理员读取反馈
POST /api/admin/feedback/status     修改状态
POST /api/admin/feedback/delete     删除反馈
SQLite feedback 表
Nginx 托管 index.html 和 admin/index.html
```

------

# 三、开发流程概览

## 第一步：整理现有前端

保留你现在的两个页面：

```text
public/
  index.html
  admin/
    index.html
```

需要改的主要是 API 地址。

原来是：

```javascript
https://xxx.tcloudbase.com/submit-feedback
```

迁移后改成：

```javascript
/api/feedback
```

管理页接口也类似：

```javascript
/api/admin/feedback/list
/api/admin/feedback/status
/api/admin/feedback/delete
```

这样前端和后端在同一个域名下，就基本不需要额外处理跨域。

------

## 第二步：创建 Node.js 后端项目

目录可以设计成：

```text
feedback-server/
  public/
    index.html
    admin/
      index.html
  server/
    app.js
    db.js
  data/
    workstation.db
  package.json
  .env
```

安装依赖：

```bash
npm init -y
npm install express better-sqlite3 dotenv helmet
```

可选：

```bash
npm install express-rate-limit
```

------

## 第三步：设计数据库表

SQLite 表可以这样：

```sql
CREATE TABLE feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  contact TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL
);
```

如果想保留和 CloudBase 类似的 `_id`，也可以用字符串 UUID：

```sql
id TEXT PRIMARY KEY
```

但对这个项目来说，自增 ID 已经够用。

------

## 第四步：实现后端接口

对应你现在的 4 个云函数。

### 1. 提交反馈

```text
POST /api/feedback
```

做这些事：

- 接收 `type/title/content/contact/images`
- 校验必填字段
- 限制长度
- 写入数据库
- 返回 `{ success: true }`

### 2. 管理员读取反馈

```text
POST /api/admin/feedback/list
```

做这些事：

- 校验管理密码
- 查询反馈列表
- 按时间倒序返回

### 3. 修改状态

```text
POST /api/admin/feedback/status
```

做这些事：

- 校验管理密码
- 校验 ID
- 校验状态值是否属于：

```text
new / reviewed / resolved / notplanned
```

- 更新数据库

### 4. 删除反馈

```text
POST /api/admin/feedback/delete
```

做这些事：

- 校验管理密码
- 按 ID 删除记录

------

## 第五步：管理密码改成环境变量

CloudBase 版里你的管理密码写在云函数里。

本地服务器版建议放到 `.env`：

```env
ADMIN_PASSWORD=你的管理密码
PORT=3000
```

后端读取：

```javascript
process.env.ADMIN_PASSWORD
```

这样更方便管理，也避免直接写死在代码里。

------

## 第六步：托管静态文件

Express 可以直接托管：

```javascript
app.use(express.static("public"));
```

这样：

```text
/          → public/index.html
/admin/    → public/admin/index.html
```

前端接口就请求相对路径：

```javascript
/api/feedback
```

------

## 第七步：增加基础安全措施

本地服务器版建议至少加：

- `helmet`
- 请求体大小限制
- 管理接口密码校验
- 提交接口限流
- 基础日志
- 只允许合法状态值
- 输入长度限制

例如：

```text
标题最多 80 字
内容最多 2000 字
联系方式最多 100 字
```

这些限制你前端已经做了，但后端也必须再做一遍。

------

# 四、部署流程

## 方案 A：PM2 部署

适合直接在轻量云上跑。

流程：

```bash
npm install
node server/app.js
```

确认无误后：

```bash
npm install -g pm2
pm2 start server/app.js --name feedback-system
pm2 save
pm2 startup
```

然后用 Nginx 反代：

```nginx
server {
    listen 80;
    server_name workstation.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
    }
}
```

再配 HTTPS。

------

## 方案 B：Docker Compose 部署

适合你以后想标准化部署。

大致结构：

```text
Dockerfile
docker-compose.yml
data/
public/
server/
```

`docker-compose.yml`：

```yaml
services:
  feedback:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    env_file:
      - .env
    restart: unless-stopped
```

然后：

```bash
docker compose up -d
```

------

# 五、数据迁移流程

如果你以后要把 CloudBase 现有数据迁到本地：

1. 在管理页导出 CSV
2. 在本地写一个导入脚本
3. 读取 CSV
4. 插入 SQLite
5. 检查状态、时间、内容是否正常

你现在已经有 CSV 导出功能，这会让迁移很方便。

------

# 六、推荐开发顺序

我建议这样推进：

```text
1. 初始化 Node.js + Express 项目
2. 建 SQLite 数据库和 feedback 表
3. 实现提交反馈接口
4. 把用户页 API 改成本地 /api/feedback
5. 实现管理列表接口
6. 把管理页 API 改成本地接口
7. 实现状态修改接口
8. 实现删除接口
9. 加 .env 管理密码
10. 加限流、安全头、日志
11. 用 PM2 或 Docker 部署到服务器
12. 用 Nginx/Caddy 配域名和 HTTPS
13. 用 CSV 导入旧数据
```

------

# 七、是否值得现在迁移

目前不一定需要马上迁移。

如果你的 CloudBase 版本运行稳定，且访问、额度、续期都没问题，那继续用 CloudBase 会更省心。

更适合迁移到本地服务器的情况是：

- 你已经有长期运行的服务器
- 想摆脱 CloudBase 续期或额度限制
- 想统一管理多个小项目
- 想自己掌控数据库和备份
- 后续想加更复杂的后台能力
- 想和其他服务部署在同一台机器上

------

# 八、总结

迁移本地服务器版的核心工作不是重写前端，而是把 CloudBase 的能力替换掉：

```text
云函数 → Express API
文档型数据库 → SQLite/MySQL
静态托管 → Express/Nginx 静态文件
HTTP 访问服务 → Nginx/Express 路由
云端密码常量 → .env 环境变量
```

对你这个项目来说，迁移难度不高，最合适的技术栈是：

```text
Node.js + Express + SQLite + Nginx/Caddy + PM2 或 Docker
```

这样既轻量，又容易维护，也很适合个人服务器长期运行。
