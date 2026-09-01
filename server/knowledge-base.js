"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_CACHE_PATH = path.join(ROOT_DIR, "data", "ai-knowledge-index.json");

// The limits are deliberately conservative.  They keep a mistaken directory
// configuration from turning an administrator request into an unbounded file
// read, while still allowing a personal Markdown collection to be indexed.
const MAX_ROOTS = 8;
const MAX_ROOT_ID_LENGTH = 64;
const MAX_ROOT_NAME_LENGTH = 120;
const MAX_ROOT_PATH_LENGTH = 4096;
const MAX_FILES_PER_ROOT = 5000;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_INDEX_BYTES = 48 * 1024 * 1024;
const MAX_WARNINGS = 1000;
const MAX_CHUNK_CHARS = 4000;
const MAX_SEARCH_RESULTS = 6;
const MAX_CONTEXT_BYTES = 24 * 1024;
const MAX_QUERY_CHARS = 4000;
const INDEX_VERSION = "knowledge-index-v1";

const SKIPPED_DIRECTORY_NAMES = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "data",
  "logs",
  "backups",
  "tmp",
  "temp",
  "secrets",
  "secret"
]);

function boundedString(value, maxLength) {
  if (typeof value !== "string") return "";
  return Array.from(value.replace(/\u0000/gu, "")).slice(0, maxLength).join("");
}

function warning(rootId, reason, relativePath = "") {
  const safeRootId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(String(rootId || ""))
    ? String(rootId)
    : "";
  const result = {
    rootId: safeRootId,
    reason: boundedString(reason, 64)
  };
  const safePath = toPosixRelative(relativePath);
  if (safePath && validRelativePath(safePath)) {
    result.relativePath = safePath.slice(0, 512);
  }
  return result;
}

function toPosixRelative(value) {
  return String(value || "").replace(/\u0000/gu, "").replace(/\\/gu, "/");
}

function isAbsolutePath(value) {
  // path.isAbsolute is platform-aware.  The win32 check makes parsing a
  // Windows configuration explicit when a test/tool is running on another
  // platform; scanning still uses the current platform's filesystem APIs.
  return path.isAbsolute(value) || path.win32.isAbsolute(value);
}

function parseRoots(value, options = {}) {
  const maxRoots = Number.isSafeInteger(options.maxRoots) && options.maxRoots > 0
    ? Math.min(options.maxRoots, MAX_ROOTS)
    : MAX_ROOTS;
  const warnings = [];
  let parsed = value;

  if (parsed === undefined || parsed === null || parsed === "") {
    return { roots: [], warnings, valid: true };
  }

  if (typeof parsed === "string") {
    const serialized = parsed.trim();
    if (!serialized) return { roots: [], warnings, valid: true };
    try {
      parsed = JSON.parse(serialized);
    } catch (_) {
      return {
        roots: [],
        warnings: [warning("", "invalid-config")],
        valid: false,
        error: "invalid-json"
      };
    }
  }

  if (!Array.isArray(parsed)) {
    return {
      roots: [],
      warnings: [warning("", "invalid-config")],
      valid: false,
      error: "invalid-format"
    };
  }

  if (parsed.length > maxRoots) {
    warnings.push(warning("", "root-count-limit"));
  }

  const roots = [];
  const seenIds = new Set();
  for (const candidate of parsed.slice(0, maxRoots)) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      warnings.push(warning("", "invalid-root"));
      continue;
    }

    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
    const rootPath = typeof candidate.path === "string" ? candidate.path.trim() : "";

    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(id) || id.length > MAX_ROOT_ID_LENGTH) {
      warnings.push(warning(id, "invalid-root-id"));
      continue;
    }
    if (!name || Array.from(name).length > MAX_ROOT_NAME_LENGTH || name.includes("\0")) {
      warnings.push(warning(id, "invalid-root-name"));
      continue;
    }
    if (
      !rootPath ||
      rootPath.includes("\0") ||
      Array.from(rootPath).length > MAX_ROOT_PATH_LENGTH ||
      !isAbsolutePath(rootPath)
    ) {
      warnings.push(warning(id, "invalid-root-path"));
      continue;
    }
    if (seenIds.has(id)) {
      warnings.push(warning(id, "duplicate-root-id"));
      continue;
    }

    seenIds.add(id);
    roots.push({
      id,
      name: boundedString(name, MAX_ROOT_NAME_LENGTH),
      // The absolute path is retained only in the server-side configuration;
      // it is deliberately omitted from every index/result projection.
      path: path.normalize(rootPath)
    });
  }

  return {
    roots,
    warnings,
    valid: warnings.length === 0
  };
}

function normalizeLimits(options = {}) {
  options = options && typeof options === "object" ? options : {};
  const readPositiveInteger = (value, fallback, maximum) => {
    if (!Number.isSafeInteger(value) || value <= 0) return fallback;
    return Math.min(value, maximum);
  };

  return {
    maxFiles: readPositiveInteger(options.maxFiles, MAX_FILES_PER_ROOT, MAX_FILES_PER_ROOT),
    maxFileBytes: readPositiveInteger(options.maxFileBytes ?? options.maxFileSizeBytes, MAX_FILE_BYTES, MAX_FILE_BYTES),
    maxTotalBytes: readPositiveInteger(options.maxTotalBytes ?? options.maxTotalSizeBytes, MAX_TOTAL_BYTES, MAX_TOTAL_BYTES),
    maxChunkChars: readPositiveInteger(options.maxChunkChars ?? options.maxChunkLength, MAX_CHUNK_CHARS, MAX_CHUNK_CHARS),
    maxIndexBytes: readPositiveInteger(options.maxIndexBytes, MAX_INDEX_BYTES, MAX_INDEX_BYTES)
  };
}

function relativePathWithin(rootPath, candidatePath) {
  const relativePath = path.relative(rootPath, candidatePath);
  if (
    !relativePath ||
    path.isAbsolute(relativePath) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`)
  ) {
    return "";
  }
  return relativePath;
}

function safeRelativePath(rootPath, candidatePath) {
  const relativePath = relativePathWithin(rootPath, candidatePath);
  return relativePath ? toPosixRelative(relativePath) : "";
}

function isHiddenOrSkippedPath(relativePath) {
  const segments = toPosixRelative(relativePath).split("/").filter(Boolean);
  return segments.some((segment) => segment.startsWith(".")) || segments.some((segment) => (
    SKIPPED_DIRECTORY_NAMES.has(segment.toLowerCase())
  ));
}

function hashText(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function getConfigurationFingerprint(roots = []) {
  const normalized = (Array.isArray(roots) ? roots : [])
    .map((root) => ({
      id: typeof root?.id === "string" ? root.id.trim() : "",
      path: typeof root?.path === "string" ? path.normalize(root.path.trim()) : ""
    }))
    .filter((root) => root.id && root.path)
    .sort((left, right) => left.id.localeCompare(right.id));
  return hashText(JSON.stringify(normalized));
}

function normalizeHeading(value) {
  return boundedString(String(value || "").replace(/\s+#+\s*$/u, "").trim(), 240);
}

function splitDocumentIntoBlocks(content, relativePath) {
  const normalized = String(content || "").replace(/\u0000/gu, "").replace(/\r\n?/gu, "\n");
  const isMarkdown = path.extname(relativePath).toLowerCase() === ".md";
  const fallbackTitle = boundedString(path.basename(relativePath, path.extname(relativePath)), 240) || "未命名文档";
  const blocks = [];
  let heading = fallbackTitle;
  let lines = [];
  let fenced = false;

  const flush = () => {
    const text = lines.join("\n").trim();
    lines = [];
    if (text) blocks.push({ title: heading, text });
  };

  for (const line of normalized.split("\n")) {
    if (isMarkdown && /^\s{0,3}(```|~~~)/u.test(line)) {
      fenced = !fenced;
      lines.push(line.replace(/[ \t]+$/gu, ""));
      continue;
    }
    const headingMatch = isMarkdown && !fenced ? line.match(/^\s{0,3}(#{1,6})[ \t]+(.+?)\s*$/u) : null;
    if (headingMatch) {
      flush();
      heading = normalizeHeading(headingMatch[2]) || fallbackTitle;
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    lines.push(line.replace(/[ \t]+$/gu, ""));
  }
  flush();
  return blocks;
}

function splitUnicodeText(text, maxChars) {
  const chars = Array.from(String(text || ""));
  const parts = [];
  for (let offset = 0; offset < chars.length; offset += maxChars) {
    parts.push(chars.slice(offset, offset + maxChars).join(""));
  }
  return parts;
}

function chunkDocument(content, relativePath, rootId, mtimeMs, limits = {}) {
  const normalizedLimits = normalizeLimits(limits);
  const blocks = splitDocumentIntoBlocks(content, relativePath);
  const chunks = [];
  let chunkIndex = 0;
  for (const block of blocks) {
    for (const text of splitUnicodeText(block.text, normalizedLimits.maxChunkChars)) {
      const contentHash = hashText(text);
      const stableId = hashText(`${rootId}\n${relativePath}\n${chunkIndex}`);
      chunks.push({
        sourceId: `s-${stableId.slice(0, 24)}`,
        rootId,
        relativePath: toPosixRelative(relativePath),
        title: boundedString(block.title, 240),
        text,
        contentHash,
        mtimeMs: Number.isFinite(mtimeMs) ? mtimeMs : 0,
        chunkIndex
      });
      chunkIndex += 1;
    }
  }
  return chunks;
}

function statFile(filePath) {
  try {
    return fs.statSync(filePath);
  } catch (_) {
    return null;
  }
}

function readFileBounded(filePath, maxBytes) {
  const descriptor = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const count = fs.readSync(descriptor, buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (!count) break;
      bytesRead += count;
    }
    if (bytesRead > maxBytes) return null;
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    fs.closeSync(descriptor);
  }
}

async function scanRoot(root, options = {}) {
  const limits = normalizeLimits(options.limits || options);
  const warnings = [];
  const chunks = [];
  const summary = {
    indexedFiles: 0,
    indexedBytes: 0,
    chunkCount: 0,
    skippedFiles: 0
  };
  const rootId = root && typeof root.id === "string" ? root.id : "";
  const configuredPath = root && typeof root.path === "string" ? root.path : "";
  let realRoot;

  try {
    realRoot = fs.realpathSync(configuredPath);
    const rootStat = fs.statSync(realRoot);
    if (!rootStat.isDirectory()) throw new Error("not-directory");
  } catch (_) {
    warnings.push(warning(rootId, "root-unavailable"));
    return { chunks, warnings, summary };
  }

  const visitedDirectories = new Set();
  let candidateFiles = 0;
  let totalBytes = 0;

  const addWarning = (reason, relativePath) => {
    if (warnings.length < MAX_WARNINGS) warnings.push(warning(rootId, reason, relativePath));
    summary.skippedFiles += 1;
  };

  const processFile = (filePath, realFilePath, relativePath) => {
    if (!relativePath || isHiddenOrSkippedPath(relativePath)) return;
    const extension = path.extname(filePath).toLowerCase();
    if (extension !== ".md" && extension !== ".txt") return;

    candidateFiles += 1;
    if (candidateFiles > limits.maxFiles) {
      addWarning("file-count-limit", relativePath);
      return;
    }

    const fileStat = statFile(realFilePath);
    if (!fileStat || !fileStat.isFile()) {
      addWarning("file-unreadable", relativePath);
      return;
    }
    if (fileStat.size > limits.maxFileBytes) {
      addWarning("file-too-large", relativePath);
      return;
    }
    if (totalBytes + fileStat.size > limits.maxTotalBytes) {
      addWarning("total-size-limit", relativePath);
      return;
    }

    let content;
    try {
      content = readFileBounded(realFilePath, limits.maxFileBytes);
    } catch (_) {
      addWarning("file-unreadable", relativePath);
      return;
    }
    if (content === null) {
      addWarning("file-too-large", relativePath);
      return;
    }
    const contentBytes = Buffer.byteLength(content, "utf8");
    if (contentBytes > limits.maxFileBytes) {
      addWarning("file-too-large", relativePath);
      return;
    }
    if (totalBytes + contentBytes > limits.maxTotalBytes) {
      addWarning("total-size-limit", relativePath);
      return;
    }

    const fileChunks = chunkDocument(content, relativePath, rootId, fileStat.mtimeMs, limits);
    if (fileChunks.length === 0) {
      addWarning("empty-file", relativePath);
      return;
    }
    totalBytes += contentBytes;
    summary.indexedFiles += 1;
    summary.indexedBytes += contentBytes;
    summary.chunkCount += fileChunks.length;
    chunks.push(...fileChunks);
  };

  const walk = (directoryPath, knownRealPath = "") => {
    let realDirectoryPath = knownRealPath;
    try {
      realDirectoryPath = realDirectoryPath || fs.realpathSync(directoryPath);
    } catch (_) {
      return;
    }
    const relativeDirectory = relativePathWithin(realRoot, realDirectoryPath);
    if (!relativeDirectory && realDirectoryPath !== realRoot) {
      if (warnings.length < MAX_WARNINGS) warnings.push(warning(rootId, "outside-root"));
      return;
    }
    if (visitedDirectories.has(realDirectoryPath)) return;
    visitedDirectories.add(realDirectoryPath);

    let entries;
    try {
      entries = fs.readdirSync(directoryPath, { withFileTypes: true })
        .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    } catch (_) {
      if (relativeDirectory) addWarning("directory-unreadable", relativeDirectory);
      return;
    }

    for (const entry of entries) {
      const childPath = path.join(directoryPath, entry.name);
      const childRelativeHint = relativePathWithin(realRoot, path.resolve(realDirectoryPath, entry.name));
      if (entry.name.startsWith(".") || SKIPPED_DIRECTORY_NAMES.has(entry.name.toLowerCase())) {
        continue;
      }

      let childRealPath;
      try {
        childRealPath = fs.realpathSync(childPath);
      } catch (_) {
        if (!entry.isDirectory()) addWarning("file-unreadable", childRelativeHint);
        continue;
      }
    const relativePath = safeRelativePath(realRoot, childRealPath);
      if (!relativePath) {
        if (warnings.length < MAX_WARNINGS) warnings.push(warning(rootId, "outside-root", childRelativeHint));
        if (!entry.isDirectory()) summary.skippedFiles += 1;
        continue;
      }
      if (isHiddenOrSkippedPath(relativePath)) continue;

      let childStat;
      try {
        childStat = fs.statSync(childRealPath);
      } catch (_) {
        if (!entry.isDirectory()) addWarning("file-unreadable", relativePath);
        continue;
      }

      if (childStat.isDirectory()) {
        walk(childRealPath, childRealPath);
      } else if (childStat.isFile()) {
        processFile(childPath, childRealPath, relativePath);
      }
    }
  };

  walk(realRoot, realRoot);
  return { chunks, warnings, summary };
}

function createSummary(rootCount = 0) {
  return {
    configuredRoots: rootCount,
    indexedRoots: 0,
    indexedFiles: 0,
    indexedBytes: 0,
    chunkCount: 0,
    skippedFiles: 0,
    warningCount: 0
  };
}

function normalizedNow(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "string" && !Number.isNaN(new Date(value).getTime())) return new Date(value).toISOString();
  return new Date().toISOString();
}

async function writeIndexAtomically(index, cachePath = DEFAULT_CACHE_PATH, maxIndexBytes = MAX_INDEX_BYTES) {
  const targetPath = path.resolve(cachePath);
  const temporaryPath = `${targetPath}.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const serialized = JSON.stringify(index);
  if (Buffer.byteLength(serialized, "utf8") > maxIndexBytes) {
    const error = new Error("知识库索引超过大小上限");
    error.code = "KNOWLEDGE_INDEX_TOO_LARGE";
    throw error;
  }
  try {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(temporaryPath, serialized, { encoding: "utf8", mode: 0o600, flag: "w" });
    fs.renameSync(temporaryPath, targetPath);
  } catch (error) {
    try {
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    } catch (_) {
      // The original cache remains the source of truth if cleanup also fails.
    }
    throw error;
  }
  return targetPath;
}

async function reindex(options = {}) {
  const parsedRoots = parseRoots(options.roots);
  if (parsedRoots.error) {
    const error = new Error("知识库目录配置无效");
    error.code = "KNOWLEDGE_CONFIG_INVALID";
    throw error;
  }
  const roots = parsedRoots.roots;
  const index = {
    version: INDEX_VERSION,
    configurationFingerprint: getConfigurationFingerprint(roots),
    builtAt: normalizedNow(options.now),
    roots: roots.map(({ id, name }) => ({ id, name })),
    chunks: [],
    warnings: [
      ...parsedRoots.warnings,
      ...(Array.isArray(options.warnings) ? options.warnings.map((item) => {
        const source = item && typeof item === "object" ? item : {};
        return warning(source.rootId, source.reason || "warning", source.relativePath || "");
      }) : [])
    ]
  };
  const summary = createSummary(roots.length);
  const limits = normalizeLimits(options.limits || options);

  for (const root of roots) {
    const result = await scanRoot(root, { limits });
    index.chunks.push(...result.chunks);
    index.warnings.push(...result.warnings);
    if (result.summary.indexedFiles > 0) summary.indexedRoots += 1;
    summary.indexedFiles += result.summary.indexedFiles;
    summary.indexedBytes += result.summary.indexedBytes;
    summary.chunkCount += result.summary.chunkCount;
    summary.skippedFiles += result.summary.skippedFiles;
  }
  summary.warningCount = index.warnings.length;
  index.summary = summary;

  await writeIndexAtomically(index, options.cachePath || DEFAULT_CACHE_PATH, limits.maxIndexBytes);
  return { ...index, summary };
}

function emptyIndex(reason) {
  return {
    available: false,
    version: INDEX_VERSION,
    configurationFingerprint: "",
    builtAt: "",
    roots: [],
    chunks: [],
    warnings: [],
    reason
  };
}

function validRelativePath(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  const normalized = toPosixRelative(value);
  if (
    normalized.startsWith("/") ||
    path.win32.isAbsolute(normalized) ||
    /^[A-Za-z]:[\\/]/u.test(normalized) ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) return false;
  return !normalized.split("/").includes("..");
}

function normalizeSummary(value) {
  const source = value && typeof value === "object" ? value : {};
  const fields = [
    "configuredRoots",
    "indexedRoots",
    "indexedFiles",
    "indexedBytes",
    "chunkCount",
    "skippedFiles",
    "warningCount"
  ];
  return Object.fromEntries(fields.map((field) => [
    field,
    Number.isSafeInteger(source[field]) && source[field] >= 0 ? source[field] : 0
  ]));
}

function normalizeLoadedIndex(candidate) {
  if (!candidate || typeof candidate !== "object" || candidate.version !== INDEX_VERSION) return null;
  const roots = Array.isArray(candidate.roots)
    ? candidate.roots
      .filter((root) => (
        root &&
        typeof root.id === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(root.id) &&
        typeof root.name === "string" &&
        !root.name.includes("\0")
      ))
      .slice(0, MAX_ROOTS)
      .map((root) => ({
        id: boundedString(root.id, MAX_ROOT_ID_LENGTH),
        name: boundedString(root.name, MAX_ROOT_NAME_LENGTH)
      }))
    : [];
  const rootIds = new Set(roots.map((root) => root.id));
  const chunks = Array.isArray(candidate.chunks)
    ? candidate.chunks.filter((chunk) => (
      chunk &&
      typeof chunk.sourceId === "string" &&
      rootIds.has(chunk.rootId) &&
      validRelativePath(chunk.relativePath) &&
      typeof chunk.text === "string"
    )).map((chunk) => ({
      sourceId: boundedString(chunk.sourceId, 80),
      rootId: boundedString(chunk.rootId, MAX_ROOT_ID_LENGTH),
      relativePath: toPosixRelative(chunk.relativePath).slice(0, 512),
      title: boundedString(chunk.title, 240),
      text: boundedString(chunk.text, MAX_CHUNK_CHARS),
      contentHash: boundedString(chunk.contentHash, 128),
      mtimeMs: Number.isFinite(chunk.mtimeMs) ? chunk.mtimeMs : 0,
      chunkIndex: Number.isSafeInteger(chunk.chunkIndex) && chunk.chunkIndex >= 0 ? chunk.chunkIndex : 0
    }))
    : [];
  return {
    available: true,
    version: INDEX_VERSION,
    configurationFingerprint: typeof candidate.configurationFingerprint === "string" && /^[a-f0-9]{64}$/iu.test(candidate.configurationFingerprint)
      ? candidate.configurationFingerprint.toLowerCase()
      : "",
    builtAt: typeof candidate.builtAt === "string" ? boundedString(candidate.builtAt, 40) : "",
    roots,
    chunks,
    warnings: Array.isArray(candidate.warnings) ? candidate.warnings.slice(0, MAX_WARNINGS).map((item) => ({
      rootId: /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(String(item && item.rootId || ""))
        ? String(item.rootId)
        : "",
      reason: boundedString(item && item.reason, 64),
      ...(item && validRelativePath(item.relativePath)
        ? { relativePath: toPosixRelative(item.relativePath).slice(0, 512) }
        : {})
    })) : [],
    summary: normalizeSummary(candidate.summary)
  };
}

function loadIndex(cachePath = DEFAULT_CACHE_PATH, options = {}) {
  let parsed;
  try {
    const resolvedPath = path.resolve(cachePath);
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile() || stat.size > MAX_INDEX_BYTES) return emptyIndex("too-large");
    const serialized = readFileBounded(resolvedPath, MAX_INDEX_BYTES);
    if (serialized === null) return emptyIndex("too-large");
    parsed = JSON.parse(serialized);
  } catch (error) {
    return emptyIndex(error && error.code === "ENOENT" ? "missing" : "unreadable");
  }
  const normalized = normalizeLoadedIndex(parsed);
  if (!normalized) return emptyIndex("incompatible");
  const expectedFingerprint = typeof options.expectedFingerprint === "string" ? options.expectedFingerprint.trim().toLowerCase() : "";
  if (expectedFingerprint && normalized.configurationFingerprint !== expectedFingerprint) {
    return emptyIndex("config-changed");
  }
  return normalized;
}

function tokenSet(value) {
  const text = typeof value === "string" ? value.toLocaleLowerCase() : "";
  const tokens = new Set(text.match(/[\p{L}\p{N}]+/gu) || []);
  const chars = Array.from(text).filter((char) => /[\p{L}\p{N}]/u.test(char));
  for (let index = 0; index < chars.length - 1; index += 1) {
    tokens.add(`${chars[index]}${chars[index + 1]}`);
  }
  return tokens;
}

function scoreChunk(chunk, query, queryTokens) {
  const title = typeof chunk.title === "string" ? chunk.title.toLocaleLowerCase() : "";
  const text = typeof chunk.text === "string" ? chunk.text.toLocaleLowerCase() : "";
  const candidateTokens = tokenSet(`${title}\n${text}`);
  let score = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) score += 1;
  }
  const normalizedQuery = query.toLocaleLowerCase().trim();
  if (normalizedQuery && title.includes(normalizedQuery)) score += 2;
  if (normalizedQuery && text.includes(normalizedQuery)) score += 1;
  return score;
}

function sliceUtf8(value, maxBytes) {
  if (maxBytes <= 0) return "";
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let output = "";
  for (const character of Array.from(value)) {
    const next = output + character;
    if (Buffer.byteLength(next, "utf8") > maxBytes) break;
    output = next;
  }
  return output;
}

function searchIndex(index, query, options = {}) {
  const textQuery = boundedString(query, MAX_QUERY_CHARS).trim();
  if (!textQuery) return [];
  const source = index && Array.isArray(index.chunks) ? index : null;
  if (!source || source.available === false) return [];
  const rootId = typeof options.rootId === "string" ? options.rootId.trim() : "";
  const maxResults = Number.isSafeInteger(options.maxResults)
    ? Math.max(0, Math.min(options.maxResults, MAX_SEARCH_RESULTS))
    : MAX_SEARCH_RESULTS;
  const maxContextBytes = Number.isSafeInteger(options.maxContextBytes ?? options.contextBytes)
    ? Math.max(0, Math.min(options.maxContextBytes ?? options.contextBytes, MAX_CONTEXT_BYTES))
    : MAX_CONTEXT_BYTES;
  if (maxResults === 0 || maxContextBytes === 0) return [];
  const queryTokens = tokenSet(textQuery);

  const ranked = source.chunks.map((chunk) => ({
    chunk,
    score: scoreChunk(chunk, textQuery, queryTokens)
  })).filter((item) => (
    item.score > 0 && (!rootId || item.chunk.rootId === rootId)
  )).sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    const leftChunk = left.chunk;
    const rightChunk = right.chunk;
    if (leftChunk.rootId !== rightChunk.rootId) return leftChunk.rootId < rightChunk.rootId ? -1 : 1;
    if (leftChunk.relativePath !== rightChunk.relativePath) return leftChunk.relativePath < rightChunk.relativePath ? -1 : 1;
    return (leftChunk.chunkIndex || 0) - (rightChunk.chunkIndex || 0);
  });

  const results = [];
  let contextBytes = 0;
  for (const item of ranked) {
    if (results.length >= maxResults || contextBytes >= maxContextBytes) break;
    const chunk = item.chunk;
    const remainingBytes = maxContextBytes - contextBytes;
    const boundedText = sliceUtf8(String(chunk.text || ""), remainingBytes);
    if (!boundedText) continue;
    contextBytes += Buffer.byteLength(boundedText, "utf8");
    results.push({
      sourceId: boundedString(chunk.sourceId, 80),
      rootId: boundedString(chunk.rootId, MAX_ROOT_ID_LENGTH),
      relativePath: toPosixRelative(chunk.relativePath).slice(0, 512),
      title: boundedString(chunk.title, 240),
      text: boundedText,
      chunkIndex: Number.isSafeInteger(chunk.chunkIndex) ? chunk.chunkIndex : 0,
      score: item.score
    });
  }
  return results;
}

async function reindexFromConfig() {
  // Lazy loading avoids a config ↔ knowledge-base module cycle and also makes
  // the pure scanner convenient to use in tests.
  const config = require("./config");
  const knowledgeConfig = config.aiKnowledge || config.knowledgeBase || {};
  if (knowledgeConfig.parseError) {
    const error = new Error("知识库目录配置无效");
    error.code = "KNOWLEDGE_CONFIG_INVALID";
    throw error;
  }
  return reindex({
    roots: knowledgeConfig.roots || [],
    warnings: knowledgeConfig.warnings,
    cachePath: knowledgeConfig.cachePath || DEFAULT_CACHE_PATH,
    limits: knowledgeConfig.limits
  });
}

module.exports = {
  ROOT_DIR,
  DEFAULT_CACHE_PATH,
  INDEX_VERSION,
  MAX_ROOTS,
  MAX_ROOT_ID_LENGTH,
  MAX_ROOT_NAME_LENGTH,
  MAX_ROOT_PATH_LENGTH,
  MAX_FILES_PER_ROOT,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  MAX_INDEX_BYTES,
  MAX_WARNINGS,
  MAX_CHUNK_CHARS,
  MAX_SEARCH_RESULTS,
  MAX_CONTEXT_BYTES,
  MAX_QUERY_CHARS,
  getConfigurationFingerprint,
  parseRoots,
  splitDocumentIntoBlocks,
  chunkDocument,
  scanRoot,
  writeIndexAtomically,
  reindex,
  loadIndex,
  searchIndex,
  reindexFromConfig
};
