const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ADMIN_SCRIPT = path.resolve(__dirname, "..", "public", "admin", "admin.js");
const ADMIN_HTML = path.resolve(__dirname, "..", "public", "admin", "index.html");
const WORKSTATION_CSS = path.resolve(__dirname, "..", "public", "workstation.css");

test("admin export actions use one server POST download and do not fetch all pages", () => {
  const source = fs.readFileSync(ADMIN_SCRIPT, "utf8");
  assert.match(source, /\/api\/admin\/feedback\/export/);
  assert.match(source, /\/api\/admin\/worktask\/export/);
  assert.doesNotMatch(source, /fetchAllFeedbackForExport/);
  assert.doesNotMatch(source, /fetchAllWorktaskForExport/);
  assert.match(source, /EXPORT_LIMIT_EXCEEDED/);
});

test("admin page exposes the knowledge workspace and bounded profile controls", () => {
  const html = fs.readFileSync(ADMIN_HTML, "utf8");
  assert.match(html, /id="tabKnowledge"/u);
  assert.match(html, /id="moduleKnowledge"/u);
  for (const id of [
    "knowledgeStatusText",
    "knowledgeReindexBtn",
    "knowledgeRootFilter",
    "knowledgeQuestion",
    "knowledgeAskBtn",
    "knowledgeAnswer",
    "knowledgeBasis",
    "knowledgeSources",
    "knowledgeHistoryList",
    "knowledgeCleanupBtn",
    "knowledgeAutoCleanup",
    "knowledgeSettingsSaveBtn"
  ]) {
    assert.match(html, new RegExp(`id="${id}"`, "u"));
  }
  assert.match(html, /id="aiProfileReasoningEffort"/u);
  assert.match(html, /id="aiProfilePromptInstruction"/u);
});

test("static admin buttons declare their intended type", () => {
  const html = fs.readFileSync(ADMIN_HTML, "utf8");
  const buttons = [...html.matchAll(/<button\b[^>]*>/giu)].map((match) => match[0]);
  assert.ok(buttons.length > 20);
  for (const button of buttons) {
    assert.match(button, /\btype="(?:button|submit)"/u, button);
  }
});

test("admin script wires knowledge endpoints and profile fields", () => {
  const source = fs.readFileSync(ADMIN_SCRIPT, "utf8");
  for (const endpoint of [
    "/api/admin/ai/knowledge/status",
    "/api/admin/ai/knowledge/reindex",
    "/api/admin/ai/knowledge/ask",
    "/api/admin/ai/knowledge/history",
    "/api/admin/ai/knowledge/history/delete",
    "/api/admin/ai/knowledge/history/cleanup",
    "/api/admin/ai/knowledge/settings"
  ]) {
    assert.match(source, new RegExp(endpoint.replaceAll("/", "\\/"), "u"));
  }
  assert.match(source, /aiProfileReasoningEffort/u);
  assert.match(source, /aiProfilePromptInstruction/u);
  assert.match(source, /knowledgeAutoCleanup/u);
});

test("shared admin control contract covers pagebar and dynamic AI buttons", () => {
  const css = fs.readFileSync(WORKSTATION_CSS, "utf8");
  assert.match(css, /\.admin-page\s+button/u);
  assert.match(css, /\.admin-page\s+\.pagebar\s+button/u);
  assert.match(css, /\.admin-page\s+button:focus-visible/u);
  assert.match(css, /\.admin-page\s+button\.is-busy/u);
  assert.match(css, /\.admin-page\s+button\.primary/u);
  assert.match(css, /\.admin-page\s+button\.secondary/u);
  assert.match(css, /\.admin-page\s+button\.danger/u);
  assert.match(css, /\.admin-page\s+button[^{}]*\{[^}]*border-radius:\s*0/u);
});
