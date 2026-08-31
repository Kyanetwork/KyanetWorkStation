const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ADMIN_SCRIPT = path.resolve(__dirname, "..", "public", "admin", "admin.js");

test("admin export actions use one server POST download and do not fetch all pages", () => {
  const source = fs.readFileSync(ADMIN_SCRIPT, "utf8");
  assert.match(source, /\/api\/admin\/feedback\/export/);
  assert.match(source, /\/api\/admin\/worktask\/export/);
  assert.doesNotMatch(source, /fetchAllFeedbackForExport/);
  assert.doesNotMatch(source, /fetchAllWorktaskForExport/);
  assert.match(source, /EXPORT_LIMIT_EXCEEDED/);
});
