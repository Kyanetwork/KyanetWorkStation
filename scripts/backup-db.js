#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { spawnSync } = require("child_process");
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

async function gzipFile(inputPath, outputPath) {
  await pipeline(
    fs.createReadStream(inputPath),
    zlib.createGzip({ level: zlib.constants.Z_BEST_COMPRESSION }),
    fs.createWriteStream(outputPath)
  );
}

async function createSnapshotWithBetterSqlite3(sourcePath, snapshotPath) {
  const BetterSqlite3 = require("better-sqlite3");
  const db = new BetterSqlite3(sourcePath, { readonly: true, fileMustExist: true });
  try {
    await db.backup(snapshotPath);
  } finally {
    db.close();
  }
}

function createSnapshotWithSqliteCli(sourcePath, snapshotPath) {
  const normalizedSnapshotPath = snapshotPath.replace(/\\/g, "/");
  const backupCommand = `.backup "${normalizedSnapshotPath.replace(/"/g, '""')}"`;
  const result = spawnSync("sqlite3", [sourcePath, backupCommand], {
    encoding: "utf8",
    windowsHide: true
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const stderr = String(result.stderr || "").trim();
    const stdout = String(result.stdout || "").trim();
    throw new Error(stderr || stdout || `sqlite3 exited with code ${result.status}`);
  }
}

async function createConsistentSnapshot(sourcePath, snapshotPath) {
  let betterSqliteError = null;
  try {
    await createSnapshotWithBetterSqlite3(sourcePath, snapshotPath);
    return;
  } catch (error) {
    betterSqliteError = error;
  }

  try {
    createSnapshotWithSqliteCli(sourcePath, snapshotPath);
    return;
  } catch (sqliteCliError) {
    const reasonA = betterSqliteError && betterSqliteError.message ? betterSqliteError.message : String(betterSqliteError);
    const reasonB = sqliteCliError && sqliteCliError.message ? sqliteCliError.message : String(sqliteCliError);
    throw new Error(
      `Failed to create SQLite consistent snapshot. better-sqlite3 error: ${reasonA}; sqlite3 CLI error: ${reasonB}. ` +
      "Please run backup in the same runtime as the service (or reinstall dependencies / install sqlite3 CLI)."
    );
  }
}

function cleanupExpiredBackups(backupDir, retentionDays) {
  const files = fs.readdirSync(backupDir, { withFileTypes: true });
  const deadline = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  for (const entry of files) {
    if (!entry.isFile()) continue;
    if (!/^feedback_\d{8}_\d{6}\.db\.gz$/.test(entry.name)) continue;
    const fullPath = path.join(backupDir, entry.name);
    const stat = fs.statSync(fullPath);
    if (stat.mtimeMs < deadline) {
      fs.unlinkSync(fullPath);
    }
  }
}

async function main() {
  if ((config.dbClient || "sqlite").toLowerCase() !== "sqlite") {
    throw new Error(`backup-db.js only supports SQLite. Current DB_CLIENT=${config.dbClient}`);
  }

  const dbPath = config.dbPath;
  const backupDir = config.backupDir;
  const retentionDays = parseRetentionDays(config.backupRetentionDays);

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database file not found: ${dbPath}`);
  }

  fs.mkdirSync(backupDir, { recursive: true });

  const ts = nowTimestamp();
  const tempSnapshotPath = path.join(backupDir, `feedback_${ts}.db`);
  const outputPath = `${tempSnapshotPath}.gz`;

  await createConsistentSnapshot(dbPath, tempSnapshotPath);

  try {
    await gzipFile(tempSnapshotPath, outputPath);
  } finally {
    if (fs.existsSync(tempSnapshotPath)) {
      fs.unlinkSync(tempSnapshotPath);
    }
  }

  cleanupExpiredBackups(backupDir, retentionDays);
  console.log(`Backup created: ${outputPath}`);
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
