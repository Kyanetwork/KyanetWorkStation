# P0 project stability and security hardening

## Goal

Make the current KyanetWorkStation release safe to operate and reproducibly
test before adding the P1 unified workspace or AI Copilot. The outcome is a
small, self-hosted service whose public responses are privacy-minimized,
administrator boundaries are explicit, startup failures are actionable, and
recovery/notification behavior has evidence.

## Confirmed product and technical baseline

- The service is a Node.js + Express monolith with native static pages and
  SQLite/MySQL/PostgreSQL adapters. This task preserves that architecture.
- KyanetAccount integration is frozen. The old routes, sessions, policy
  lookup, snapshots, and submission gate remain only as cleanup targets; no
  new integration capability is wanted. Historical anonymous records must not
  be auto-assigned to a future account.
- Node.js 24.x LTS is the required release/runtime line for this P0 gate. The
  initial checkout ran `v24.19.0` with module ABI 137 while its installed
  `better-sqlite3` binary targeted ABI 127; the current clean-install evidence
  loads the rebuilt addon at ABI 137. Node 20/22 can remain optional
  compatibility checks but are not release blockers for the first gate.
- The low-risk dependency target is `better-sqlite3 ^12.11.1`, `express
  ^4.22.2`, and `nodemailer ^9.0.5`, subject to clean-install, API, and full
  test verification. Express 4 remains in scope; Express 5 and a second
  parser stack are not.
- Existing SQLite/MySQL/PostgreSQL support, the two business tables, native
  static frontend, and current API envelope remain the compatibility
  boundaries. No React, TypeScript, ORM, microservice, external queue, or
  general plugin platform is introduced.

## Confirmed defect evidence

- Public highlights select and return `content`: `server/db.js:1380-1421`;
  the response is exposed by `server/app.js:382-388`.
- Account lists reuse complete database row mappings: `server/db.js:1172-1301`;
  this can expose `adminNote`, contact data, and account snapshots.
- Forwarded headers participate in origin derivation:
  `server/security.js:17-23,37-65`; Express applies numeric `TRUST_PROXY` in
  `server/app.js:87-89`.
- WorkTask arrangement cannot clear an existing assignee or schedule:
  `server/validation.js:284-309` and `server/db.js:1338-1367` only persist
  truthy values.
- Configuration has no consolidated startup validation:
  `server/config.js:1-107` and `server/app.js:863-897`.
- MeowStatus settings default to enabled: `server/db.js:14-23,759-763`;
  its request path is `server/app.js:390-422`.
- Notification retries are process-local fire-and-forget:
  `server/app.js:247-269,483-520,753-764`.
- Backup scripts exist, but no isolated restore/readability evidence is
  recorded in `docs/operations/backup-restore.md`.

## Requirements

### R1. Remove the frozen legacy Account integration

- Remove or isolate old Account routes, middleware, configuration, session
  schema/helpers, client entry points, and tests so normal feedback/WorkTask
  flows no longer depend on KyanetAccount.
- Preserve existing data columns during the first migration unless a backup,
  inventory, and reversible migration prove removal is safe. Do not auto-claim
  historical anonymous rows.
- Leave a concise future integration boundary describing state/nonce binding,
  one-time callback consumption, DTO separation, and account-to-record
  ownership rules.

### R2. Enforce privacy and request boundaries

- Public highlights return only the minimum public fields: identifier, type,
  title, status, priority/source where applicable, public reply, and update
  time. Never return `content`, `contact`, `adminNote`, image links, account
  IDs/snapshots, or internal notification data.
- Any remaining user-facing list uses an explicit safe DTO and excludes
  administrator notes, contact details, account snapshots, and other users'
  data.
- Same-origin admin mutations must not trust spoofable forwarded headers when
  the request is not behind the configured proxy boundary; direct and proxied
  modes need regression tests.
- WorkTask arrangement supports explicit clear/unassign operations while
  retaining the current default status transition when an arrangement is
  added.

### R3. Establish a reproducible runtime and test baseline

- Declare and document the supported Node.js runtime strategy, and make a
  clean dependency install/rebuild produce a matching `better-sqlite3` ABI.
- Upgrade or constrain production dependencies to eliminate the current audit
  findings, or record a time-bounded risk acceptance with a concrete
  mitigation when an upgrade is incompatible.
- Add a repeatable API smoke path covering health, submission, administrator
  login, and list retrieval with an isolated temporary database/port. Ensure
  child processes and temporary files are cleaned up.
- Keep SQLite as the default and retain MySQL/PostgreSQL compatibility checks
  without introducing an ORM or new service.

### R4. Make operations and external integrations fail-safe

- Add startup configuration validation with actionable errors for database
  selection/URL, port, base URL, proxy setting, external service URLs, and
  enabled notification providers.
- Make MeowStatus explicitly disabled by default unless configured/enabled,
  and return a clear non-blocking disabled/unavailable state to the public
  page.
- Verify SQLite/RDBMS backup output and restore into an isolated temporary
  database, recording checksum, schema/readability checks, and rollback/cleanup
  evidence.
- Make at least one SMTP or Webhook path observable and retryable beyond
  process lifetime, or explicitly document the durable handoff boundary and a
  safe manual retry path within the existing stack.

## Acceptance criteria

- [x] A fresh checkout starts with the documented Node/npm version and matching
      native dependencies; `npm test` passes, or every remaining blocker has a
      dated, owner-approved waiver.
- [x] Public highlights and any user-facing list have contract tests proving
      sensitive fields are absent.
- [x] Direct requests and correctly proxied requests have distinct
      same-origin/forwarded-header tests; spoofed forwarding headers cannot
      authorize an admin mutation.
- [x] An existing WorkTask can be assigned, scheduled, and then explicitly
      unassigned/cleared through the validated API and admin UI without
      changing unrelated fields.
- [x] Startup preflight rejects invalid combinations before listening and
      reports the offending configuration key without secrets.
- [x] MeowStatus disabled, unavailable, and successful states are represented
      without blocking feedback/WorkTask pages; focused boundary tests and the
      isolated API smoke cover the states. Real upstream observation remains an
      operational follow-up when the provider is enabled.
- [x] Automated temporary SQLite backup restore succeeds and verifies key
      tables/rows; its temporary artifacts are outside production data and
      excluded from Git.
- [x] Before release, one real sanitized SQLite backup from the configured local
      database was restored in an isolated environment with checksum, integrity,
      schema, key-table, startup, cleanup, and rollback-boundary evidence. A
      different release target must repeat the rehearsal.
- [x] At least one notification provider has a repeatable success/failure/
      retry test; failed delivery is visible to an operator and does not
      silently disappear.
- [x] The frozen KyanetAccount integration is removed from the active request
      path, and future integration requirements are documented without
      enabling a new protocol.
- [x] No React, TypeScript, ORM, microservice split, plugin platform, or
      unrelated UI redesign is introduced.

### 当前验收边界（2026-08-28）

代码、自动化回归、Node 24 干净安装和发布环境门禁已完成。D-004 的 PM2、回环监听、
源站端口阻断、Nginx Host/Proto、HTTP→HTTPS、HTTPS health 与 TLS 证据已记录在
被忽略的 `docs/internal/release-2026-08-27.md`；本机 V-002/V-003、D-007 和 R-004
也已有实现与隔离验证。若未来更换发布主机、数据库或通知目标，应按公开模板重演
对应门禁，不把本机证据自动外推到新目标。

## Out of scope

- New KyanetAccount integration, account-center redesign, historical anonymous
  record ownership, or account-based user history.
- Unified homepage, work inbox, Kanban/project management, AI Copilot, file
  uploads, chat, billing, multi-tenant/RBAC expansion, or broad
  personal-project automation.
- Replacing Express, changing the two business tables into one table, or
  introducing a queue/database service solely for this task.
- Production DNS, provider credentials, real SMTP/Webhook secrets, or live
  deployment changes.

## Risks and deferred items

- `better-sqlite3` 11.x → 12.x and Nodemailer 8.x → 9.x are compatibility
  changes. The package and lockfile must be upgraded together, then verified
  under Node 24 with native loading, SMTP behavior, API smoke, full tests, and
  audit output. Roll back the pair together if compatibility regresses.
- Node 20/22 support is optional after the Node 24 release gate. Optional
  MySQL/PostgreSQL driver checks remain deployment-matrix work, not a reason to
  replace the database abstraction.
- Durable notifications may require a small database-backed outbox or a
  clearly documented operator retry handoff. First confirm whether an existing
  table/setting can be reused; do not add a queue service solely for P0.
- Removing Account tables/columns is intentionally deferred until a backup,
  migration inventory, and restore evidence prove that the data can be
  retained or safely retired.
