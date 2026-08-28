# P0 code evidence and implementation boundaries

## Privacy and DTOs

- `server/db.js:1380-1421` selects `content` for public highlights and maps it into both public arrays. The public read path should select/map only the approved fields instead of relying on a post-response delete.
- `server/db.js:1172-1301` uses `mapFeedbackRow`/`mapWorktaskRow`, which are admin-oriented full-row mappers, for Account lists. A safe user mapper must be separate from admin DTOs.

## Proxy trust

- `server/security.js:17-23` combines `X-Forwarded-*` with `req.protocol`/`Host`; `server/security.js:37-65` compares that derived origin with `Origin`/`Referer`.
- `server/app.js:87-89` configures Express with numeric `TRUST_PROXY`. Tests need to model direct mode (`0`) and one explicitly trusted proxy hop, and to prove a client-supplied forwarded host/proto cannot authorize a direct request.

## WorkTask arrangement

- `server/validation.js:284-309` normalizes blank values to null-ish empty strings and rejects an all-empty request.
- `server/db.js:1338-1367` conditionally writes only truthy `assignee`/`scheduledAt`, so existing values cannot be cleared.
- `public/admin/admin.js:352-356` renders editable assignee/time inputs but has no explicit clear action. The API contract should distinguish omitted fields (leave unchanged) from explicit `null`/empty clear values.

## MeowStatus and startup

- `server/db.js:14-23,759-763` defaults both status settings to enabled.
- `server/app.js:390-422` already returns an `{ok,data}` status object and does not block submission routes; the P0 change should preserve this failure isolation while making disabled the default unless explicitly enabled/configured.
- `server/config.js:36-105` has no validation pass; `server/app.js:863-897` initializes the DB before listening. A preflight should run before database side effects where possible and never log secret values.

## Notifications and recovery

- `server/app.js:247-269,483-520,753-764` runs retry logic in a fire-and-forget promise. A durable handoff needs a small persisted status/outbox boundary or a documented operator-visible retry mechanism; it must not turn into a new queue service.
- `scripts/backup-db.js` and `scripts/backup-db-rdbms.js` produce backups and prune by retention, but tests do not restore and read a backup in an isolated database.

## Legacy Account cleanup

- Active Account dependencies include `server/account-auth.js`, `server/account-session.js`, `server/app.js:277-352,424-470`, account snapshot columns/migrations in `server/db.js`, account UI checks in `public/feedback/main.js` and `public/worktask/main.js`, and Account-focused tests.
- The first cleanup should remove active routes and submission gating without destructive column/table deletion. Preserve schema/data until a separate migration inventory and backup evidence authorize retirement.
