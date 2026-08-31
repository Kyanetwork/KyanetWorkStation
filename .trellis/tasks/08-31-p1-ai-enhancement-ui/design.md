# Technical Design: AI Copilot parameters, knowledge assistant, and sharp UI

## Status and scope

This design reflects the user-approved P1-A scope on 2026-08-31. It covers:

- profile-level `reasoning_effort` and a bounded prompt instruction;
- a read-only, locally indexed Markdown/plain-text knowledge base available on the
  cloud deployment;
- an administrator-only knowledge Q&A surface with citations and persisted history;
- bounded history retention, an administrator-controlled automatic cleanup switch,
  and a manual cleanup path;
- a shared, square-corner button and layout system.

Provider diagnostics, usage dashboards, prompt comparison, batch operations,
automatic routing/fallback, and Account integration remain a follow-up P1-B task.

## Boundaries

The existing Node.js 24 + Express + static HTML/CSS/JavaScript architecture stays
in place. The implementation adds focused modules rather than a framework or SDK:

- `server/ai-profiles.js` keeps profile normalization, encryption, and DTO rules;
- `server/ai-provider.js` owns normalized provider requests and protocol mapping;
- `server/knowledge-base.js` owns root validation, scanning, chunking, cache IO, and
  deterministic retrieval;
- `server/ai-knowledge.js` owns Q&A orchestration, answer parsing, and history;
- `server/db.js` adds one cross-driver history table and one settings JSON key;
- `server/validation.js` and `server/app.js` expose bounded admin contracts;
- `public/admin/index.html`, `admin.js`, and `ai-model.js` add the knowledge panel;
- `public/workstation.css` becomes the shared visual contract for all buttons.

No knowledge-base path is accepted from a browser request. The process reads only
the configured roots, and the indexer never writes to them.

## Profile, prompt, and provider contract

Profile state remains backward-compatible. Existing profiles missing new fields are
treated as having empty values:

```json
{
  "reasoningEffort": "",
  "promptInstruction": ""
}
```

`reasoningEffort` is empty or one of `low`, `medium`, `high`, `xhigh`, `max`. For
`openai-responses`, the adapter maps it to `reasoning: { "effort": "..." }`.
The field is omitted when empty and is omitted for `openai-chat` and
`anthropic-messages`, with an explicit UI status that it is not applied for that
protocol. Arbitrary provider JSON is not accepted.

`promptInstruction` is a bounded profile field. A fixed server prompt always comes
first and retains the data allow-list, untrusted-data delimiters, output schema,
and no-tool/no-secret rules. The optional instruction is inserted in a separate
`<admin-instruction>` block and cannot replace or weaken those rules. A clear/reset
operation restores the default. Audit metadata contains only configured/length/hash
information, never the instruction text.

The provider adapter exposes one normalized response shape:

```text
{ text, usage: { inputTokens, outputTokens }, providerRequestId }
```

The existing Copilot parser continues to own suggestion JSON. The knowledge
assistant uses a separate bounded parser for:

```json
{
  "answer": "...",
  "basis": "document | mixed | general",
  "citedSourceIds": ["s1"],
  "caveats": "..."
}
```

Source IDs are server-generated for the current request and are mapped back to
retrieved chunks; model-supplied paths are ignored. Invalid JSON is an
`AI_INVALID_RESPONSE` and is not persisted.

## Knowledge roots and indexing

Roots are configured outside the application UI with a JSON environment variable:

```dotenv
AI_KNOWLEDGE_BASE_DIRS=[{"id":"tyutland","name":"TYUTland","path":"E:\\Workplace\\Projects\\@Knowledge-Base\\Minecraft\\TYUTland"}]
```

The production value uses the corresponding Linux path. The parser limits root
count, ID/name/path length, and rejects malformed entries without taking down the
core application; the status API reports the knowledge feature as unavailable with
a safe reason. Only `.md` and `.txt` files are considered. Hidden folders and
known runtime/secret directories are skipped. Each candidate is checked with
`realpath`; symlinks escaping a configured root are rejected.

Reindexing is explicit (admin endpoint and CLI). The scanner reads files read-only,
uses headings and paragraph boundaries, and splits large sections into bounded
chunks. Each chunk keeps only root ID, relative POSIX path, title/heading, hash,
mtime, and text. Search uses Unicode word tokens plus Chinese bigrams, scores
overlap deterministically, supports all roots or one root, and returns a small
top set under a total context-byte limit.

The cache is versioned JSON at `data/ai-knowledge-index.json`. A completed scan is
written to a temporary sibling and atomically renamed. A failed scan leaves the
last valid cache in place. Startup loads an existing cache but does not scan; the
status reports the last build time, counts, root names, and warnings. The cache is
ignored by Git and must not be returned by any API.

## Q&A, history, and lifecycle

The knowledge orchestrator validates the question, selects the active profile,
retrieves context, builds the fixed knowledge prompt plus bounded profile
instruction, calls the provider, validates the answer, maps citations, and saves
one history record. With no matches, the server forces `basis=general`; with
matches, the UI separates document citations from model inference and caveats.

History is stored in a new `ai_knowledge_answer` table compatible with all current
database drivers. It contains bounded question/answer text, basis, citation JSON,
caveats, selected root ID (empty for all roots), profile/protocol/model, usage,
prompt version, `created_at`, and `expires_at`, with indexes on creation and expiry.
The existing setting JSON store receives `ai_knowledge_settings` with
`autoCleanup` (default `true`) and an update timestamp. Retention comes from
`AI_KNOWLEDGE_HISTORY_RETENTION_DAYS` (default 30, bounded by runtime validation).

Admin routes follow the existing envelope, session, CSRF, rate-limit, and audit
patterns:

- `GET /api/admin/ai/knowledge/status`
- `POST /api/admin/ai/knowledge/reindex`
- `POST /api/admin/ai/knowledge/ask`
- `GET /api/admin/ai/knowledge/history`
- `POST /api/admin/ai/knowledge/history/delete`
- `POST /api/admin/ai/knowledge/history/cleanup`
- `POST /api/admin/ai/knowledge/settings`

Startup and hourly workers delete expired rows only when `autoCleanup` is enabled.
When disabled, expiration still prevents records from being used as active context;
manual cleanup remains available. All cleanup and reindex mutations are audited
with counts and safe IDs, not document or answer content.

## UI and accessibility

The admin page adds a knowledge tab with four ordered regions: index status and
rebuild, question/scope form, answer/citations, and bounded history. Root filters
show configured names only. Answer cards distinguish `document`, `mixed`, and
`general`; history rows support deletion and cleanup.

Shared CSS tokens define square-corner controls, cold-blue HUD accents, primary/
secondary/danger states, hover, disabled, busy, and focus-visible behavior for all
buttons. `.pagebar` and dynamically generated AI buttons receive the same contract
as toolbar and form buttons. Inline rules are reduced where they conflict with the
shared token layer. The layout remains single-column on narrow screens, preserves
keyboard order and readable Chinese text, and does not change event semantics.

## Failure, privacy, and rollback

- Missing roots, invalid files, stale cache, provider timeout, malformed answer, and
  database write failures return stable bounded errors and leave ordinary feedback,
  WorkTask, and notification flows unaffected.
- Prompts send only retrieved bounded chunks and allow-listed questions; no `.env`,
  database, logs, API keys, absolute paths, or full unselected documents are sent.
- API responses expose only root names/relative paths, never machine paths or key
  material. History is administrator-only and is included in database backups.
- Existing profiles and suggestions continue to work without migration input. New
  tables/settings are additive; rollback to the prior release leaves them unused.
  If the cache format changes, the version check ignores incompatible files and a
  manual reindex recreates it.

## Verification

Focused tests cover profile normalization/encryption compatibility, Responses
mapping, prompt boundaries, index root/symlink/extension/size checks, chunk and
search determinism, answer parsing/citation mapping, history pagination/deletion/
cleanup, and the admin API. Full verification runs `node --check` on changed JS,
`npm test`, `npm audit`, and `git diff --check`, followed by browser smoke for both
themes, keyboard focus, narrow layout, all button states, reindex, Q&A, citations,
history, and cleanup toggle.
