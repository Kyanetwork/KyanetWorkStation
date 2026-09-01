#!/usr/bin/env node
"use strict";

require("dotenv").config();

const path = require("node:path");
const { reindexFromConfig } = require("../server/knowledge-base");

function safeErrorCode(error) {
  const code = error && typeof error.code === "string" ? error.code : "KNOWLEDGE_REINDEX_FAILED";
  return /^[A-Z0-9_]{1,64}$/u.test(code) ? code : "KNOWLEDGE_REINDEX_FAILED";
}

function safeErrorMessage(error) {
  const raw = String(error && error.message ? error.message : error || "知识库重建失败");
  return raw
    .replace(/[A-Z]:\\[^\r\n]*/giu, "[redacted-path]")
    .replace(/(?:^|\s)\/[^\s]*/gu, " [redacted-path]")
    .replace(/(?:https?|file):\/\/[^\s]*/giu, "[redacted-url]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 240) || "知识库重建失败";
}

function safeWarning(item) {
  const source = item && typeof item === "object" ? item : {};
  const relativePath = typeof source.relativePath === "string"
    ? source.relativePath.replace(/\\/gu, "/").slice(0, 512)
    : "";
  const safePath = relativePath &&
    !relativePath.startsWith("/") &&
    !path.win32.isAbsolute(relativePath) &&
    !relativePath.split("/").includes("..")
    ? relativePath
    : "";
  return {
    rootId: typeof source.rootId === "string" ? source.rootId.slice(0, 64) : "",
    reason: typeof source.reason === "string" ? source.reason.slice(0, 64) : "warning",
    ...(safePath
      ? { relativePath: safePath }
      : {})
  };
}

async function main() {
  const result = await reindexFromConfig();
  process.stdout.write(`${JSON.stringify({
    version: result.version,
    builtAt: result.builtAt,
    summary: result.summary,
    warnings: Array.isArray(result.warnings) ? result.warnings.map(safeWarning) : []
  })}\n`);
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      error: {
        code: safeErrorCode(error),
        message: safeErrorMessage(error)
      }
    })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  safeErrorCode,
  safeErrorMessage,
  safeWarning
};
