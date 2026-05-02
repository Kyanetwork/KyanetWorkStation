#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { spawn } = require("child_process");
const { pipeline } = require("stream/promises");
const config = require("../server/config");

function parseRetentionDays(rawValue) {
  const parsed = Number.parseInt(String(rawValue == null ? "" : rawValue), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 30;
  }
  return parsed;
}

function nowTimestamp() {
  const date = new Date();
  const pad = (v) => String(v).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "_",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
}

function cleanupExpiredBackups(backupDir, retentionDays, matcher) {
  const files = fs.readdirSync(backupDir, { withFileTypes: true });
  const deadline = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  for (const entry of files) {
    if (!entry.isFile()) continue;
    if (!matcher.test(entry.name)) continue;
    const fullPath = path.join(backupDir, entry.name);
    const stat = fs.statSync(fullPath);
    if (stat.mtimeMs < deadline) {
      fs.unlinkSync(fullPath);
    }
  }
}

function parseDatabaseConnection() {
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required for MySQL/PostgreSQL backup.");
  }
  let parsed;
  try {
    parsed = new URL(config.databaseUrl);
  } catch (_) {
    throw new Error("DATABASE_URL is invalid.");
  }

  const dbName = parsed.pathname.replace(/^\/+/, "");
  if (!dbName) {
    throw new Error("DATABASE_URL is missing database name.");
  }

  return {
    host: parsed.hostname || "127.0.0.1",
    port: parsed.port || "",
    user: decodeURIComponent(parsed.username || ""),
    password: decodeURIComponent(parsed.password || ""),
    dbName
  };
}

function waitChildExit(child, command, stderrChunks) {
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      reject(new Error(`${command} exited with code ${code}${stderr ? `: ${stderr}` : ""}`));
    });
  });
}

async function backupMySql(connection, outputPath) {
  const args = [
    "--single-transaction",
    "--quick",
    "--routines",
    "--triggers",
    "-h", connection.host,
    "-P", connection.port || "3306"
  ];

  if (connection.user) {
    args.push("-u", connection.user);
  }
  args.push(connection.dbName);

  const env = { ...process.env };
  if (connection.password) {
    env.MYSQL_PWD = connection.password;
  }

  const stderrChunks = [];
  const child = spawn("mysqldump", args, {
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));

  const gzip = zlib.createGzip({ level: zlib.constants.Z_BEST_COMPRESSION });
  await Promise.all([
    pipeline(child.stdout, gzip, fs.createWriteStream(outputPath)),
    waitChildExit(child, "mysqldump", stderrChunks)
  ]);
}

async function backupPostgres(connection, outputPath) {
  const args = [
    "-h", connection.host,
    "-p", connection.port || "5432",
    "-d", connection.dbName,
    "-F", "c",
    "-f", outputPath
  ];
  if (connection.user) {
    args.push("-U", connection.user);
  }

  const env = { ...process.env };
  if (connection.password) {
    env.PGPASSWORD = connection.password;
  }

  const stderrChunks = [];
  const child = spawn("pg_dump", args, {
    env,
    windowsHide: true,
    stdio: ["ignore", "ignore", "pipe"]
  });
  child.stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));
  await waitChildExit(child, "pg_dump", stderrChunks);
}

async function main() {
  const dbClient = (config.dbClient || "").toLowerCase();
  if (dbClient !== "mysql" && dbClient !== "postgres") {
    throw new Error(`backup-db-rdbms.js only supports mysql/postgres. Current DB_CLIENT=${config.dbClient}`);
  }

  const connection = parseDatabaseConnection();
  const backupDir = config.backupDir;
  const retentionDays = parseRetentionDays(config.backupRetentionDays);
  fs.mkdirSync(backupDir, { recursive: true });

  const safeDbName = connection.dbName.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const ts = nowTimestamp();

  if (dbClient === "mysql") {
    const outputPath = path.join(backupDir, `mysql_${safeDbName}_${ts}.sql.gz`);
    await backupMySql(connection, outputPath);
    cleanupExpiredBackups(backupDir, retentionDays, /^mysql_[a-zA-Z0-9_.-]+_\d{8}_\d{6}\.sql\.gz$/);
    console.log(`Backup created: ${outputPath}`);
    return;
  }

  const outputPath = path.join(backupDir, `postgres_${safeDbName}_${ts}.dump`);
  await backupPostgres(connection, outputPath);
  cleanupExpiredBackups(backupDir, retentionDays, /^postgres_[a-zA-Z0-9_.-]+_\d{8}_\d{6}\.dump$/);
  console.log(`Backup created: ${outputPath}`);
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
