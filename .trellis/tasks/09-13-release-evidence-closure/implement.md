# 执行计划：生产发布证据收口

> 本计划在维护窗口由部署操作者执行。当前阶段只完成规划；没有得到后续明确批准前，不运行
> `task.py start`，不连接生产 PostgreSQL，不执行备份/恢复或临时应用操作。

## 0. 前置与安全闸门

- [ ] 当前外部只读复核显示 HTTPS health 为 200、外部直连 `:3088` 超时，但 HTTP 根路径为
      200 且没有 `Location`；因此 D-004 的 HTTP→HTTPS 结果先标记为待复核，不要把 HSTS
      单独当作重定向证据。由服务器操作者确认 Cloudflare/宝塔策略后再填写结论，本任务不
      直接修改 Nginx/DNS。
- [ ] 确认维护窗口、操作者/复核者和上一发布提交；准备私有证据位置（`docs/internal/`
      或部署系统），不要在仓库中保存真实值。
- [ ] 确认生产目录是目标 Git 工作树，`PORT=3088`、PM2 单实例和宝塔 Nginx HTTPS 事实；
      若仍有手动改动或未知进程，先暂停并核对，不强制覆盖。
- [ ] 确认服务器存在 `psql`、`pg_dump`、`pg_restore`、`sha256sum`，并有创建/删除唯一
      临时数据库的受控权限。若只有 `DATABASE_URL`，通过秘密管理器建立临时 `PG*` 环境，
      不在终端、历史或证据中回显连接串。
- [ ] 设定停止条件：health/恢复/权限/代理/数据完整性/outbox journal/隐私任一异常即停止。

## 1. 采集发布基线（R1）

在应用目录执行并把结果转写为脱敏摘要；不把完整日志或 `.env` 值复制到证据：

```bash
git rev-parse HEAD
git rev-parse HEAD^  # 作为候选回滚点，若不存在则记录实际上一版本
node -v
npm -v
node -p 'JSON.stringify({modules:process.versions.modules,napi:process.versions.napi})'
npm ci --omit=dev --foreground-scripts
node -e "require('better-sqlite3')(':memory:').close(); console.log('better-sqlite3 ok')"
node --check ecosystem.config.cjs
pm2 status
pm2 show kyanet-workstation
pm2 save
ss -ltnp | grep ':3088'
curl -fsS http://127.0.0.1:3088/api/health
sudo nginx -t
```

另从代理入口执行 HTTPS health 和 HTTP→HTTPS 头检查；公网直连测试应从外部主机进行，
记录“被防火墙/代理边界阻断”而不记录真实 IP。核对 `pm2 show` 的 cwd 为实际发布目录、
环境/Node 路径正确且没有项目级 systemd unit 争抢端口。

## 2. 生成并校验 PostgreSQL 备份（R2）

在确认上一版本和配置摘要已保存后执行：

```bash
npm run backup-db:rdbms
# 从 backups/ 中按时间选择本次生成的 postgres_*.dump；只把 basename 写入证据
sha256sum backups/postgres_<db>_<timestamp>.dump
stat -c '%a %s %y %n' backups/postgres_<db>_<timestamp>.dump
pg_restore --list backups/postgres_<db>_<timestamp>.dump >/dev/null
```

不要用通配符直接恢复未核对的文件；保留 basename、hash、大小、时间和退出码，备份文件不
加入 Git。若备份命令失败，保留错误摘要并停止后续恢复。

## 3. 在隔离 PostgreSQL 数据库恢复并冒烟（R2）

1. 从秘密管理器注入仅当前 shell 可见的 `PGHOST`、`PGPORT`、`PGUSER`、`PGPASSWORD`、
   `PGSSLMODE` 等连接参数；`PGDATABASE` 指向维护库。生成唯一名称，例如
   `kws_restore_verify_<UTC>_<PID>`，并在创建前查询确认不存在。
2. 使用 `createdb`/`psql` 在维护库创建该名称，执行：

   ```bash
   pg_restore --exit-on-error --no-owner --no-privileges \
     --dbname="$TMP_DB" backups/postgres_<db>_<timestamp>.dump
   ```

   这里的 `$TMP_DB` 必须来自本次脚本变量，不接受浏览器/用户输入；绝不对生产库运行
   `pg_restore`、`--clean` 或 `DROP`。

3. 只读核对 schema 和关键表存在性/行数，例如 `to_regclass('public.feedback')`、
   `worktask`、`admin_audit`、`notification_delivery`、`workstation_setting`、项目相关表；
   输出只保留存在性和计数，不打印行内容、联系方式或账号快照。
4. 使用临时端口启动同一提交的隔离应用。通过进程环境注入临时 `DB_CLIENT=postgres`、
   临时 `DATABASE_URL`、`PORT`、`LISTEN_HOST=127.0.0.1`，并显式关闭 AI/SMTP/Webhook；
   不修改生产 `.env`。执行 `GET /api/health`，再仅使用在隔离库内新生成的一次性管理员
   凭据/会话访问管理员列表；禁止复制或复用生产 Cookie、管理员密码或生产会话。若不具备
   隔离管理员凭据，则执行等价的只读表查询并记录原因，不为取得凭据读取或导出生产秘密。
5. 停止临时 Node 进程，确认 PID 已退出。再次验证数据库名严格匹配本次唯一前缀后才允许
   `dropdb "$TMP_DB"`；删除后查询确认不存在。若名称、PID 或连接目标任一不匹配，立即
   停止并保留临时库等待人工复核。

## 4. 生产管理员导出与审计（R3）

- [ ] 以管理员会话分别执行 Feedback、WorkTask 的正常筛选导出；只记录 HTTP 状态、CSV
      MIME、`Cache-Control: no-store`、`X-Export-Count`、UTF-8 BOM、表头和筛选条件摘要。
- [ ] 用最小的非敏感样本确认中文、逗号、换行转义；不要把 CSV 正文、联系方式或用户正文
      写入证据或聊天。
- [ ] 查询 `/api/admin/audit/list` 对应动作，确认 action/result/request ID 和白名单
      metadata 可见；检查响应和日志不含正文、Cookie、密钥、完整 URL、Provider payload。
- [ ] 超限拒绝、流中断、审计写入失败使用既有自动测试结果；除非另有隔离库，不在生产批量
      造数或删除记录。若生产匹配数本来超过上限，记录 `413 EXPORT_LIMIT_EXCEEDED`，不要
      下载响应体。

## 5. AI 指标与 active profile（R4）

- [ ] 在管理员页面读取最近 24 小时 `/api/admin/ai/metrics`，记录 operation、protocol、
      状态、耗时、成功/失败/超时和 known/unknown usage 汇总，不记录 URL、Key、prompt、
      response、业务内容或完整上游错误。
- [ ] 对照用户已完成的真实 profile 诊断记录，记录诊断前后 active profile 是否一致；默认
      不再次调用 Provider。若指标缺失且确需补测，先确认 token 成本，再由管理员显式点击一次。
- [ ] 指标为空、写入失败或自动清理关闭时，区分“无记录/降级”与“服务失败”，不能把空集
      宣称为 Provider 可用。

## 6. 隔离通知失败→重试→恢复（R4）

在第 3 步的隔离数据库/临时应用中执行，不触碰生产 `.env` 或真实目标：

1. 将 generic webhook 或 SMTP 指向本机未监听的测试端口；提交一条明确标记为测试的临时
   Feedback/WorkTask，确认业务写入成功且 outbox 出现 `pending`，随后按 worker 退避进入
   `retrying/failed`。只记录事件/业务 ID、provider 类型、状态、次数和时间。
2. 启动只绑定 loopback 的临时 sink（或切换到预先准备的隔离 sink），重启临时应用一次，
   确认 pending/retrying 状态来自数据库并能继续处理；不使用真实收件人、Webhook URL 或
   Provider。
3. 以管理员会话按 delivery/handoff UUID 触发人工重试，确认最终 `delivered/resolved`，
   或记录稳定错误码和下一步责任人。若要覆盖入队异常，只在隔离环境使 handoff journal
   暂时不可写并恢复权限；journal 失败必须被记录为发布阻塞，不得吞掉业务写入错误。
4. 查询 `/api/admin/notifications`、`/api/admin/notification-handoffs`（按部署版本存在的
   接口），确认返回已折叠的脱敏字段；检查业务记录没有因通知失败回滚。

## 7. 脱敏、清理和最终门禁（R5）

- [ ] 停止并清理所有临时 Node/sink 进程、临时端口、临时 PostgreSQL 数据库和临时日志；
      备份按保留策略留在受控目录，不复制回本地 Git 工作树。
- [ ] 从模板填写私有证据，`chmod 600`；只写 basename/hash/状态/计数/耗时/稳定错误码。
      用人工复核和定向搜索确认无 `postgresql://`、Cookie、Bearer、API key、邮箱/收件人、
      Provider URL、prompt、响应正文、机器绝对路径或用户正文。
- [ ] 在本地/发布提交上执行：

  ```bash
  npm test
  npm audit --omit=dev --registry=https://registry.npmjs.org
  git diff --check
  git status --short
  python ./.trellis/scripts/task.py validate .trellis/tasks/09-13-release-evidence-closure
  ```

- [ ] 确认没有业务代码、schema、配置模板或公开文档变化；若有意外 dirty path，将其列为
      未识别文件，不纳入本任务提交。
- [ ] 在证据中填写通过/暂停/部分通过、未覆盖项、回滚点和操作者/复核者。任一停止条件
      未关闭时不得宣称发布通过。

## 8. 回滚点

回滚只使用已记录的上一提交和上一份 PM2 配置：停止新进程、恢复代码/依赖、按实际 PM2
命令重启，随后复查 `pm2 status`、`pm2 show`、`ss -ltnp`、本机/HTTPS health、管理员读写
和通知状态。禁止执行 `git clean -fdx`、强制覆盖生产目录、`DROP TABLE` 或生产库破坏性
恢复；备份和临时库证据在复核完成前保留。
