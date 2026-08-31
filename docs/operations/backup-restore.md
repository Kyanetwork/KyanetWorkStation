# 备份与恢复

## SQLite

核心脚本会执行一致性快照并按保留天数清理旧文件：

```powershell
npm run backup-db:core
npm run backup-db:win
```

Linux/WSL：

```bash
npm run backup-db:linux
# 或 npm run backup-db:core
```

备份默认写入 `BACKUP_DIR`，文件和压缩包不得提交到 Git。

### SQLite 隔离验证摘要

发布前可对显式 `.db` 或 `.db.gz` 文件运行只读验证工具：

```powershell
npm run verify-backup:sqlite -- --backup <PRIVATE_BACKUP_PATH>
```

工具会计算源文件 SHA-256，将备份解压/复制到操作系统临时目录，以只读
`better-sqlite3` 打开，执行 `PRAGMA integrity_check`，并只输出关键表（包括
`admin_audit`）存在性和行数摘要。输出包含备份 basename、数据库类型、耗时和 checksum，不包含完整路径、
行内容、数据库 URL 或凭据；结束时关闭连接并清理临时目录。工具成功只能证明该
副本可读，不能替代 MySQL/PostgreSQL 供应商的隔离恢复，也不能替代使用真实脱敏
备份的发布演练。

## MySQL/PostgreSQL

当 `DB_CLIENT=mysql|postgres` 且 `DATABASE_URL` 有效时：

```bash
npm run backup-db:rdbms
```

脚本依赖对应的 `mysqldump` 或 `pg_dump`。它不会替代数据库供应商的 PITR、快照和权限策略。

RDBMS 的恢复必须指向隔离实例/数据库（命令中的连接信息只从部署系统注入）：

```bash
# MySQL：先在隔离库生成备份，再用 mysql 导入隔离库
mysqldump --single-transaction --quick --routines --triggers \
  --host=<PRIVATE_HOST> --user=<PRIVATE_USER> <PRIVATE_DB> > <PRIVATE_SQL_PATH>
mysql --host=<PRIVATE_ISOLATED_HOST> --user=<PRIVATE_USER> <PRIVATE_ISOLATED_DB> < <PRIVATE_SQL_PATH>

# PostgreSQL：导出 custom format，再用 pg_restore 导入隔离库
pg_dump --format=custom --host=<PRIVATE_HOST> --username=<PRIVATE_USER> \
  --dbname=<PRIVATE_DB> --file=<PRIVATE_DUMP_PATH>
pg_restore --host=<PRIVATE_ISOLATED_HOST> --username=<PRIVATE_USER> \
  --dbname=<PRIVATE_ISOLATED_DB> <PRIVATE_DUMP_PATH>
```

不要把密码放在命令行、仓库或证据中；使用部署系统的临时凭据/环境注入，并在
记录中只保留数据库类型、隔离实例标签、checksum、schema/关键行摘要和清理结果。

## 恢复演练

每次发布前至少在临时目录做一次恢复演练：

1. 选择一份脱敏或测试备份，记录校验和、创建时间和来源。
2. 恢复到隔离的临时数据库路径/实例，不覆盖生产库。
3. 使用匹配的 Node 版本运行 `initializeDatabase()` 或启动临时应用。
4. 检查反馈、WorkTask、管理员会话、设置和 `admin_audit` 表的数量及关键字段。
5. 访问 health、管理员列表和主页摘要，确认数据可读。
6. 记录恢复耗时、失败点、回滚动作和证据路径。

`backup-db:core` 只负责生成一致性快照；发布门禁还要求在独立临时路径解压并用匹配 Node 24 运行时读取关键表。应记录备份文件 SHA-256、数据库类型、schema/关键行读取结果、耗时和清理动作；不得用“脚本退出 0”替代恢复验证。

仓库中的 `tests/backup-sqlite.test.js` 提供可重复的隔离演练：创建完整应用 schema 和测试行，运行备份脚本，校验压缩文件 SHA-256，解压到另一临时数据库并读取反馈、WorkTask、管理员、设置、审计及历史会话/通知表。该测试证据不能替代发布前使用真实脱敏备份的演练。

## 保留与保护

- `BACKUP_RETENTION_DAYS` 默认 30 天，按磁盘容量调整。
- 备份目录应限制文件权限，并复制到与应用主机不同的存储位置。
- 不在日志、工单、提交或公开文档中写入备份内容、数据库 URL 或恢复凭据。
- `notification-handoff.jsonl` 与备份属于同一私有数据目录，应一并纳入受控备份；
  handoff 只保存脱敏事件/业务标识、provider、状态、次数和错误摘要，不备份正文、
  联系方式、收件人、URL、密码、签名或请求体。
