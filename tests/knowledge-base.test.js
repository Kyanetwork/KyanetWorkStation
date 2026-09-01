const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  INDEX_VERSION,
  MAX_SEARCH_RESULTS,
  parseRoots,
  reindex,
  loadIndex,
  searchIndex,
  getConfigurationFingerprint
} = require("../server/knowledge-base");

function makeTempDir(prefix = "kws-knowledge-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function removeTempDir(directory) {
  fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
}

test("parseRoots keeps bounded valid roots and reports malformed entries safely", () => {
  const directory = makeTempDir();
  try {
    const parsed = parseRoots(JSON.stringify([
      { id: "docs", name: "Docs", path: directory },
      { id: "bad id", name: "Bad", path: directory },
      { id: "missing-path", name: "Missing", path: "relative/docs" },
      { id: "", name: "Empty", path: directory }
    ]));

    assert.deepEqual(parsed.roots, [{ id: "docs", name: "Docs", path: directory }]);
    assert.ok(parsed.warnings.length >= 2);
    assert.equal(parsed.warnings.some((warning) => String(warning).includes(directory)), false);
    const hostile = parseRoots(JSON.stringify([
      { id: "C:\\\\private\\\\secrets", name: "Hostile", path: directory }
    ]));
    assert.equal(JSON.stringify(hostile.warnings).includes("private"), false);
    assert.equal(parsed.error, undefined);
  } finally {
    removeTempDir(directory);
  }
});

test("parseRoots caps the number of configured roots", () => {
  const directory = makeTempDir();
  try {
    const parsed = parseRoots(JSON.stringify(Array.from({ length: 10 }, (_, index) => ({
      id: `root-${index}`,
      name: `Root ${index}`,
      path: directory
    }))));
    assert.equal(parsed.roots.length, 8);
    assert.ok(parsed.warnings.some((item) => item.reason === "root-count-limit"));
  } finally {
    removeTempDir(directory);
  }
});

test("parseRoots treats whitespace-only configuration as no configured roots", () => {
  const parsed = parseRoots("   \n  ");
  assert.deepEqual(parsed.roots, []);
  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.valid, true);
});

test("generated warning paths are relative, NUL-free, and bounded", async () => {
  const tempDir = makeTempDir();
  const root = path.join(tempDir, "root");
  const outside = path.join(tempDir, "outside.md");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(outside, "outside");
  try {
    let linkCreated = true;
    try {
      fs.symlinkSync(outside, path.join(root, `${"x".repeat(600)}.md`), "file");
    } catch (error) {
      if (error && ["EPERM", "EACCES", "ENOTSUP", "ENAMETOOLONG", "ENOENT"].includes(error.code)) linkCreated = false;
      else throw error;
    }
    if (!linkCreated) return;
    const result = await reindex({ roots: [{ id: "root", name: "Root", path: root }], cachePath: path.join(tempDir, "cache.json") });
    for (const item of result.warnings) {
      assert.ok(!path.isAbsolute(item.relativePath || ""));
      assert.ok(!String(item.relativePath || "").includes("\0"));
      assert.ok(Array.from(String(item.relativePath || "")).length <= 512);
    }
  } finally {
    removeTempDir(tempDir);
  }
});

test("reindex scans multiple roots using only Markdown and text files", async () => {
  const tempDir = makeTempDir();
  const rootA = path.join(tempDir, "root-a");
  const rootB = path.join(tempDir, "root-b");
  const cachePath = path.join(tempDir, "cache", "ai-knowledge-index.json");
  fs.mkdirSync(path.join(rootA, "logs"), { recursive: true });
  fs.mkdirSync(path.join(rootA, "data"), { recursive: true });
  fs.mkdirSync(path.join(rootA, ".hidden"), { recursive: true });
  fs.mkdirSync(rootB, { recursive: true });
  fs.writeFileSync(path.join(rootA, "guide.md"), "# 登录按钮\n\n登录按钮需要管理员权限。\n");
  fs.writeFileSync(path.join(rootA, "notes.TXT"), "普通文本资料\n");
  fs.writeFileSync(path.join(rootA, "skip.pdf"), "not indexed");
  fs.writeFileSync(path.join(rootA, "logs", "skip.md"), "runtime log");
  fs.writeFileSync(path.join(rootA, "data", "skip.txt"), "runtime data");
  fs.writeFileSync(path.join(rootA, ".hidden", "skip.md"), "hidden");
  fs.writeFileSync(path.join(rootB, "second.md"), "第二个资料库\n");

  try {
    const result = await reindex({
      roots: [
        { id: "a", name: "A", path: rootA },
        { id: "b", name: "B", path: rootB }
      ],
      cachePath,
      now: "2026-08-31T00:00:00.000Z"
    });

    assert.equal(result.version, INDEX_VERSION);
    assert.equal(result.summary.indexedFiles, 3);
    assert.ok(result.summary.chunkCount >= 3);
    assert.ok(result.chunks.every((item) => !path.isAbsolute(item.relativePath)));
    assert.ok(result.chunks.every((item) => item.rootId && item.sourceId && item.text));
    assert.equal(result.chunks.some((item) => item.relativePath.includes("skip")), false);
    assert.equal(JSON.stringify(result).includes(rootA), false);
    assert.equal(JSON.stringify(result).includes(rootB), false);

    const loaded = loadIndex(cachePath);
    assert.equal(loaded.available, true);
    assert.deepEqual(loaded.chunks, result.chunks);
  } finally {
    removeTempDir(tempDir);
  }
});

test("reindex rejects an escaping symbolic link while allowing an in-root file", async (t) => {
  const tempDir = makeTempDir();
  const root = path.join(tempDir, "root");
  const outside = path.join(tempDir, "outside.md");
  const cachePath = path.join(tempDir, "cache.json");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "inside.md"), "inside");
  fs.writeFileSync(outside, "outside secret");

  try {
    try {
      fs.symlinkSync(outside, path.join(root, "escape.md"), "file");
    } catch (error) {
      if (error && ["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
        t.skip("当前环境不允许创建 symbolic link");
        return;
      }
      throw error;
    }

    const result = await reindex({
      roots: [{ id: "root", name: "Root", path: root }],
      cachePath
    });
    assert.equal(result.summary.indexedFiles, 1);
    assert.ok(result.warnings.some((warning) => warning.reason === "outside-root"));
    assert.equal(result.chunks.some((item) => item.relativePath === "escape.md"), false);
    assert.equal(JSON.stringify(result).includes(outside), false);
  } finally {
    removeTempDir(tempDir);
  }
});

test("reindex reports file and count limits without reading an unbounded corpus", async () => {
  const tempDir = makeTempDir();
  const root = path.join(tempDir, "root");
  const cachePath = path.join(tempDir, "cache.json");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "large.md"), "x".repeat(100));
  fs.writeFileSync(path.join(root, "one.md"), "one");
  fs.writeFileSync(path.join(root, "two.md"), "two");

  try {
    const result = await reindex({
      roots: [{ id: "root", name: "Root", path: root }],
      cachePath,
      limits: { maxFileBytes: 16, maxFiles: 2 }
    });
    assert.ok(result.warnings.some((warning) => warning.reason === "file-too-large"));
    assert.ok(result.warnings.some((warning) => warning.reason === "file-count-limit"));
    assert.ok(result.summary.skippedFiles >= 2);
    assert.ok(result.summary.indexedFiles <= 1);
  } finally {
    removeTempDir(tempDir);
  }
});

test("chunking and search are deterministic and bounded", async () => {
  const tempDir = makeTempDir();
  const root = path.join(tempDir, "root");
  const cachePath = path.join(tempDir, "cache.json");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, "search.md"),
    "# 操作\n\n登录按钮需要管理员权限。\n\n# 其他\n\n登录失败时检查日志。\n"
  );

  try {
    const first = await reindex({
      roots: [{ id: "docs", name: "Docs", path: root }],
      cachePath,
      now: "2026-08-31T00:00:00.000Z",
      limits: { maxChunkChars: 8 }
    });
    const second = await reindex({
      roots: [{ id: "docs", name: "Docs", path: root }],
      cachePath,
      now: "2026-08-31T00:00:00.000Z",
      limits: { maxChunkChars: 8 }
    });
    assert.deepEqual(first.chunks, second.chunks);

    const matches = searchIndex(first, "登录按钮", {
      maxResults: MAX_SEARCH_RESULTS,
      maxContextBytes: 40
    });
    assert.ok(matches.length > 0);
    assert.ok(matches.length <= MAX_SEARCH_RESULTS);
    assert.ok(Buffer.byteLength(matches.map((item) => item.text).join(""), "utf8") <= 40);
    assert.equal(matches[0].relativePath, "search.md");
    assert.deepEqual(matches, searchIndex(first, "登录按钮", {
      maxResults: MAX_SEARCH_RESULTS,
      maxContextBytes: 40
    }));
    assert.deepEqual(searchIndex(first, "登录按钮", { maxResults: 0 }), []);
    assert.deepEqual(searchIndex(first, "登录按钮", { maxContextBytes: 0 }), []);
    assert.equal(JSON.stringify(matches).includes(root), false);
    assert.deepEqual(searchIndex(first, "登录按钮", { rootId: "missing" }), []);
  } finally {
    removeTempDir(tempDir);
  }
});

test("Markdown headings inside fenced code are kept as content, not section titles", () => {
  const chunks = require("../server/knowledge-base").chunkDocument(
    "# Real heading\n\n```md\n# Not a heading\n```\n",
    "example.md",
    "docs",
    0
  );
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].title, "Real heading");
  assert.match(chunks[0].text, /# Not a heading/u);
});

test("loadIndex fails closed for missing or incompatible cache versions", () => {
  const tempDir = makeTempDir();
  const missingPath = path.join(tempDir, "missing.json");
  const incompatiblePath = path.join(tempDir, "incompatible.json");
  try {
    fs.writeFileSync(incompatiblePath, JSON.stringify({
      version: "old-version",
      builtAt: "2026-08-31T00:00:00.000Z",
      roots: [],
      chunks: []
    }));
    const missing = loadIndex(missingPath);
    const incompatible = loadIndex(incompatiblePath);
    assert.equal(missing.available, false);
    assert.equal(incompatible.available, false);
    assert.deepEqual(missing.chunks, []);
    assert.deepEqual(incompatible.chunks, []);
  } finally {
    removeTempDir(tempDir);
  }
});

test("loadIndex rejects an oversized cache before parsing it", () => {
  const tempDir = makeTempDir();
  const oversizedPath = path.join(tempDir, "oversized.json");
  try {
    fs.writeFileSync(oversizedPath, "{}");
    fs.truncateSync(oversizedPath, 48 * 1024 * 1024 + 1);
    const result = loadIndex(oversizedPath);
    assert.equal(result.available, false);
    assert.equal(result.reason, "too-large");
  } finally {
    removeTempDir(tempDir);
  }
});

test("a failed atomic cache replacement leaves the previous valid cache untouched", async () => {
  const tempDir = makeTempDir();
  const root = path.join(tempDir, "root");
  const cachePath = path.join(tempDir, "cache.json");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "doc.md"), "new content");
  const previous = JSON.stringify({
    version: INDEX_VERSION,
    builtAt: "2026-08-30T00:00:00.000Z",
    roots: [{ id: "old", name: "Old" }],
    chunks: [],
    warnings: []
  });
  fs.writeFileSync(cachePath, previous);
  const originalRename = fs.renameSync;
  try {
    fs.renameSync = () => {
      throw new Error("simulated atomic rename failure");
    };
    await assert.rejects(
      reindex({ roots: [{ id: "docs", name: "Docs", path: root }], cachePath }),
      /rename failure/iu
    );
    assert.equal(fs.readFileSync(cachePath, "utf8"), previous);
    assert.equal(loadIndex(cachePath).roots[0].id, "old");
  } finally {
    fs.renameSync = originalRename;
    removeTempDir(tempDir);
  }
});

test("loadIndex fails closed when the configured root path changes", async () => {
  const tempDir = makeTempDir("kws-knowledge-fingerprint-");
  const rootA = path.join(tempDir, "a");
  const rootB = path.join(tempDir, "b");
  const cachePath = path.join(tempDir, "cache.json");
  fs.mkdirSync(rootA, { recursive: true });
  fs.mkdirSync(rootB, { recursive: true });
  fs.writeFileSync(path.join(rootA, "a.md"), "A");
  try {
    const built = await reindex({ roots: [{ id: "docs", name: "Docs", path: rootA }], cachePath });
    assert.equal(loadIndex(cachePath, { expectedFingerprint: built.configurationFingerprint }).available, true);
    const changed = loadIndex(cachePath, {
      expectedFingerprint: getConfigurationFingerprint([{ id: "docs", name: "Docs", path: rootB }])
    });
    assert.equal(changed.available, false);
    assert.equal(changed.reason, "config-changed");
  } finally {
    removeTempDir(tempDir);
  }
});

test("an index size limit fails before replacement and preserves the old cache", async () => {
  const tempDir = makeTempDir();
  const root = path.join(tempDir, "root");
  const cachePath = path.join(tempDir, "cache.json");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "doc.md"), "index content that is larger than the configured cache limit");
  const previous = JSON.stringify({ version: INDEX_VERSION, builtAt: "old", roots: [], chunks: [], warnings: [] });
  fs.writeFileSync(cachePath, previous);
  try {
    await assert.rejects(
      reindex({
        roots: [{ id: "docs", name: "Docs", path: root }],
        cachePath,
        limits: { maxIndexBytes: 32 }
      }),
      (error) => error && error.code === "KNOWLEDGE_INDEX_TOO_LARGE"
    );
    assert.equal(fs.readFileSync(cachePath, "utf8"), previous);
  } finally {
    removeTempDir(tempDir);
  }
});

test("reindex carries only safe configuration warning metadata into the cache", async () => {
  const tempDir = makeTempDir();
  const cachePath = path.join(tempDir, "cache.json");
  try {
    const result = await reindex({
      roots: [],
      warnings: [
        { rootId: "docs", reason: "invalid-root-path", relativePath: "C:\\\\private\\\\secret" }
      ],
      cachePath
    });
    assert.deepEqual(result.warnings, [{ rootId: "docs", reason: "invalid-root-path" }]);
    assert.equal(JSON.stringify(result).includes("private"), false);
  } finally {
    removeTempDir(tempDir);
  }
});
