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

## MySQL/PostgreSQL

当 `DB_CLIENT=mysql|postgres` 且 `DATABASE_URL` 有效时：

```bash
npm run backup-db:rdbms
```

脚本依赖对应的 `mysqldump` 或 `pg_dump`。它不会替代数据库供应商的 PITR、快照和权限策略。

## 恢复演练

每次发布前至少在临时目录做一次恢复演练：

1. 选择一份脱敏或测试备份，记录校验和、创建时间和来源。
2. 恢复到隔离的临时数据库路径/实例，不覆盖生产库。
3. 使用匹配的 Node 版本运行 `initializeDatabase()` 或启动临时应用。
4. 检查反馈、WorkTask、管理员会话和设置表的数量及关键字段。
5. 访问 health、管理员列表和主页摘要，确认数据可读。
6. 记录恢复耗时、失败点、回滚动作和证据路径。

当前仓库已有备份脚本，但没有真实恢复演练证据；该项是 P0 发布门禁，不得用“脚本退出 0”替代恢复验证。

## 保留与保护

- `BACKUP_RETENTION_DAYS` 默认 30 天，按磁盘容量调整。
- 备份目录应限制文件权限，并复制到与应用主机不同的存储位置。
- 不在日志、工单、提交或公开文档中写入备份内容、数据库 URL 或恢复凭据。
