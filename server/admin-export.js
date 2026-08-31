const EXPORT_BATCH_SIZE = 250;

const FEEDBACK_STATUS_LABELS = {
  new: "新反馈",
  reviewed: "已查看",
  resolved: "已解决",
  notplanned: "暂不处理"
};
const WORKTASK_STATUS_LABELS = {
  new: "新工单",
  scheduled: "已安排",
  in_progress: "进行中",
  completed: "已完成",
  cancelled: "已取消"
};
const WORKTASK_PRIORITY_LABELS = {
  low: "低",
  medium: "中",
  high: "高",
  urgent: "紧急"
};

const FEEDBACK_EXPORT_COLUMNS = Object.freeze([
  { name: "id", get: (row) => row.id },
  { name: "type", get: (row) => row.type },
  { name: "title", get: (row) => row.title },
  { name: "content", get: (row) => row.content },
  { name: "contact", get: (row) => row.contact },
  { name: "status", get: (row) => FEEDBACK_STATUS_LABELS[row.status] || row.status },
  { name: "accountUserId", get: (row) => row.accountUserId },
  { name: "accountEmailSnapshot", get: (row) => row.accountEmailSnapshot },
  { name: "accountDisplayNameSnapshot", get: (row) => row.accountDisplayNameSnapshot },
  { name: "createdAt", get: (row) => row.createdAt },
  { name: "updatedAt", get: (row) => row.updatedAt }
]);

const WORKTASK_EXPORT_COLUMNS = Object.freeze([
  { name: "id", get: (row) => row.id },
  { name: "type", get: (row) => row.type },
  { name: "title", get: (row) => row.title },
  { name: "content", get: (row) => row.content },
  { name: "contact", get: (row) => row.contact },
  { name: "priority", get: (row) => WORKTASK_PRIORITY_LABELS[row.priority] || row.priority },
  { name: "status", get: (row) => WORKTASK_STATUS_LABELS[row.status] || row.status },
  { name: "accountUserId", get: (row) => row.accountUserId },
  { name: "accountEmailSnapshot", get: (row) => row.accountEmailSnapshot },
  { name: "accountDisplayNameSnapshot", get: (row) => row.accountDisplayNameSnapshot },
  { name: "expectedAt", get: (row) => row.expectedAt },
  { name: "scheduledAt", get: (row) => row.scheduledAt },
  { name: "assignee", get: (row) => row.assignee },
  { name: "tags", get: (row) => row.tags },
  { name: "createdAt", get: (row) => row.createdAt },
  { name: "updatedAt", get: (row) => row.updatedAt }
]);

function csvEscape(value) {
  const text = String(value == null ? "" : value);
  return `"${text.replace(/"/g, '""')}"`;
}

function exportLimitError(total, maxRows) {
  const error = new Error(`导出结果超过当前上限 ${maxRows} 条，请缩小筛选范围后重试`);
  error.code = "EXPORT_LIMIT_EXCEEDED";
  error.status = 413;
  error.rowCount = total;
  error.maxRows = maxRows;
  return error;
}

function safeFilename(filename) {
  const normalized = typeof filename === "string" ? filename.replace(/[\r\n"\\]/g, "_").trim() : "";
  return normalized || "export.csv";
}

function getColumnValue(column, row) {
  if (typeof column === "string") return row && row[column];
  if (!column || typeof column !== "object") return "";
  if (typeof column.get === "function") return column.get(row);
  return row && row[column.key || column.name];
}

async function reportProgress(recordProgress, event) {
  if (typeof recordProgress !== "function") return;
  try {
    await recordProgress(event);
  } catch (_) {
    // Audit persistence is deliberately best effort and must not abort export.
  }
}

function exportClientClosedError() {
  const error = new Error("导出连接已关闭");
  error.code = "EXPORT_CLIENT_CLOSED";
  return error;
}

async function writeChunk(res, chunk) {
  if (res.write(chunk)) return;
  if (typeof res.once !== "function") {
    throw new Error("导出响应不支持背压事件");
  }
  await new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      if (typeof res.removeListener !== "function") return;
      res.removeListener("drain", onDrain);
      res.removeListener("close", onClose);
      res.removeListener("error", onError);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onDrain = () => finish(resolve);
    const onClose = () => finish(reject, exportClientClosedError());
    const onError = (error) => finish(reject, error);
    res.once("drain", onDrain);
    res.once("close", onClose);
    res.once("error", onError);
  });
}

async function writeCsvExport({
  res,
  total,
  maxRows,
  filename,
  columns = [],
  fetchBatch,
  recordProgress
}) {
  const rowCount = Number(total);
  const configuredMaxRows = Number(maxRows);
  if (!Number.isSafeInteger(rowCount) || rowCount < 0) {
    throw new Error("导出总量不合法");
  }
  if (!Number.isSafeInteger(configuredMaxRows) || configuredMaxRows < 1) {
    throw new Error("导出上限不合法");
  }
  if (rowCount > configuredMaxRows) {
    throw exportLimitError(rowCount, configuredMaxRows);
  }
  if (typeof fetchBatch !== "function") {
    throw new Error("导出批次查询未配置");
  }

  const columnList = Array.isArray(columns) ? columns : [];
  const header = columnList.map((column) => typeof column === "string" ? column : column && (column.name || column.key) || "");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${safeFilename(filename)}"`);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Export-Count", String(rowCount));

  let writtenRows = 0;
  let responseEnding = false;
  let responseFinished = false;
  let responseClosed = false;
  const onResponseClose = () => {
    if (!responseEnding && !responseFinished) responseClosed = true;
  };
  const canObserveClose = res && typeof res.once === "function";
  if (canObserveClose) res.once("close", onResponseClose);
  try {
    await writeChunk(res, `\ufeff${header.join(",")}\n`);
    let offset = 0;
    while (writtenRows < rowCount) {
      if (responseClosed) throw exportClientClosedError();
      const batch = await fetchBatch(EXPORT_BATCH_SIZE, offset);
      if (!Array.isArray(batch) || batch.length === 0) break;
      const remaining = rowCount - writtenRows;
      const rows = batch.slice(0, remaining);
      const chunk = rows
        .map((row) => columnList.map((column) => csvEscape(getColumnValue(column, row))).join(","))
        .join("\n");
      if (chunk) {
        await writeChunk(res, `${chunk}\n`);
      }
      writtenRows += rows.length;
      offset += batch.length;
      await reportProgress(recordProgress, { result: "batch", rowCount: writtenRows, offset });
      if (rows.length === 0 || batch.length < EXPORT_BATCH_SIZE && writtenRows < rowCount) break;
    }
    if (responseClosed) throw exportClientClosedError();
    responseEnding = true;
    res.end();
    responseFinished = true;
    await reportProgress(recordProgress, { result: "success", rowCount: writtenRows });
    return { rowCount: writtenRows };
  } catch (error) {
    await reportProgress(recordProgress, { result: "failed", rowCount: writtenRows });
    if (!(res.writableEnded || res.destroyed)) {
      if (typeof res.destroy === "function") {
        res.destroy();
      } else if (typeof res.end === "function") {
        res.end();
      }
    }
    throw error;
  } finally {
    if (canObserveClose && typeof res.removeListener === "function") {
      res.removeListener("close", onResponseClose);
    }
  }
}

module.exports = {
  EXPORT_BATCH_SIZE,
  FEEDBACK_EXPORT_COLUMNS,
  WORKTASK_EXPORT_COLUMNS,
  csvEscape,
  exportLimitError,
  writeCsvExport
};
