#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { pipeline } = require("node:stream/promises");

const REQUIRED_TABLES = [
  "feedback",
  "worktask",
  "admin_user",
  "admin_session",
  "account_session",
  "notification_delivery",
  "ai_copilot_suggestion",
  "ai_knowledge_answer",
  "ai_request_metric",
  "workstation_setting",
  "admin_audit"
];

function parseArgs(argv) {
  if (argv.length !== 2 || argv[0] !== "--backup" || !argv[1]) {
    throw new Error("用法：node scripts/verify-sqlite-backup.js --backup <file.db|file.db.gz>");
  }
  const backupPath = path.resolve(argv[1]);
  if (!/\.db(?:\.gz)?$/iu.test(backupPath)) {
    throw new Error("备份文件必须使用 .db 或 .db.gz 扩展名");
  }
  return backupPath;
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function materializeBackup(backupPath, tempDir) {
  const databasePath = path.join(tempDir, "restore.db");
  if (backupPath.toLowerCase().endsWith(".gz")) {
    await pipeline(
      fs.createReadStream(backupPath),
      zlib.createGunzip(),
      fs.createWriteStream(databasePath, { flags: "wx" })
    );
  } else {
    await fs.promises.copyFile(backupPath, databasePath, fs.constants.COPYFILE_EXCL);
  }
  return databasePath;
}

function safeFailureMessage(error) {
  const rawMessage = String(error && error.message ? error.message : error || "验证失败");
  if (/\b(?:ENOENT|EACCES|EPERM|EISDIR|ENOTDIR)\b/iu.test(rawMessage)) {
    return "无法读取备份文件";
  }
  const message = rawMessage
    .replace(/[A-Z]:\\[^\r\n]*/giu, "[redacted-path]")
    .replace(/(?:https?|mysql|postgres(?:ql)?):\/\/\S+/giu, "[redacted-url]")
    .replace(/(?:^|\s)\/[^\s]+/gu, " [redacted-path]")
    .replace(/\b(?:password|pass|token|secret|key)\s*[:=]\s*\S+/giu, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  return message.slice(0, 240) || "验证失败";
}

async function verifySqliteBackup(backupPath) {
  const startedAt = Date.now();
  const sourcePath = path.resolve(backupPath);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    throw new Error("备份文件不存在");
  }
  if (!/\.db(?:\.gz)?$/iu.test(sourcePath)) {
    throw new Error("备份文件必须使用 .db 或 .db.gz 扩展名");
  }

  const sha256 = await sha256File(sourcePath);
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "kws-sqlite-verify-"));
  let db = null;
  try {
    const databasePath = await materializeBackup(sourcePath, tempDir);
    const BetterSqlite3 = require("better-sqlite3");
    db = new BetterSqlite3(databasePath, { readonly: true, fileMustExist: true });
    db.pragma("query_only = ON");

    const integrityRows = db.prepare("PRAGMA integrity_check").all();
    const integrityCheck = integrityRows.length === 1 && String(integrityRows[0].integrity_check || "").toLowerCase() === "ok"
      ? "ok"
      : "failed";
    if (integrityCheck !== "ok") {
      throw new Error("SQLite integrity_check 未通过");
    }

    const tables = {};
    for (const tableName of REQUIRED_TABLES) {
      const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1").get(tableName);
      if (!table) {
        throw new Error(`关键表缺失：${tableName}`);
      }
      const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get();
      tables[tableName] = { exists: true, count: Number(row.count) || 0 };
    }

    return {
      ok: true,
      backupFile: path.basename(sourcePath),
      sha256,
      databaseType: "sqlite",
      integrityCheck,
      tables,
      elapsedMs: Date.now() - startedAt
    };
  } finally {
    if (db) db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main(argv = process.argv.slice(2)) {
  const backupPath = parseArgs(argv);
  const evidence = await verifySqliteBackup(backupPath);
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: safeFailureMessage(error) })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  parseArgs,
  safeFailureMessage,
  verifySqliteBackup,
  REQUIRED_TABLES
};
