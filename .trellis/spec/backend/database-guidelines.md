# Backend Database Guidelines

## Data-access boundary

`server/db.js` is the only database access module. It selects one of
`sqlite`, `mysql`, or `postgres` from `DB_CLIENT`, lazily initializes the
driver, and keeps a small internal async facade:

- `queryOne(sql, params)` for one row or `null`.
- `queryAll(sql, params)` for a row array.
- `execute(sql, params)` for `{ changes, lastInsertId }`.
- `executeMany(statements)` for ordered schema statements.

There is no ORM, query builder, or external migration package. Do not open a
second pool or call `better-sqlite3`, `mysql2`, or `pg` from a route module.

## SQL and parameters

All values must be bound parameters. Use the local parameter-marker helper
(`server/db.js:33-35`) when a query has more than one parameter so PostgreSQL
receives `$1`, `$2`, … while SQLite/MySQL receive `?`. `buildFeedbackFilter` and
`buildWorktaskFilter` (`server/db.js:1022-1076`) show the approved pattern
for optional filters: build only trusted SQL fragments and append values to the
same parameter array.

Never concatenate user input into a WHERE clause, ORDER BY clause, or URL-like
SQL value. Dynamic table and column names are allowed only for internal,
hard-coded schema compatibility helpers such as
`ensureSubmissionAccountColumns`.

## Schema and compatibility changes

`initializeDatabase()` creates the schema on startup and then runs the
`ensure*` compatibility checks (`server/db.js:429-442`). When adding or
changing a column or index:

1. Update the SQLite, MySQL, and PostgreSQL schema statement sets.
2. Add an idempotent compatibility step for databases created by an older
   version, using `columnExists`, `tableExists`, or `indexExists`.
3. Preserve existing data and defaults; never require a destructive reset.
4. Add a test for the new mapping or migration behavior where the database can
   be loaded.

Use snake_case table/column/index names (`worktask`, `admin_session`,
`idx_worktask_status`). Application objects are camelCase through
`mapFeedbackRow` and `mapWorktaskRow`. Timestamps are ISO strings from
`nowIso()`. Boolean columns are converted with `toDbBoolean` on write and
`toBoolean` on read because SQLite/MySQL and PostgreSQL represent them
 differently.

## Writes, reads, and transactions

Create/update/delete functions should return a useful primitive from
`execute`: a new id or the affected-row count. PostgreSQL inserts that need an
id use `RETURNING id`; the other drivers use `lastInsertId`.

The current data layer executes statements individually. `executeMany` is
ordered execution, not a transaction, and there is no shared transaction
helper. Do not claim atomicity for a multi-write operation. If a future feature
needs a transaction, design an explicit per-driver transaction boundary and
tests before adding it.

JSON-like settings are stored as JSON text in `workstation_setting` and read
through `getSettingJson`/`setSettingJson`. The `images` feedback field
follows the same JSON-text storage and is parsed only in `mapFeedbackRow`.

## Common mistakes

- Updating only one of the three schema definitions.
- Returning a raw database row instead of a mapped projection.
- Using a JavaScript `Date` or driver-specific boolean directly in SQL.
- Forgetting an index for a repeated status, creation-time, or account-user
  filter.
- Treating `executeMany` as an all-or-nothing migration.
- Reading an internal column such as `admin_note` into a public DTO; public
  projections must be deliberately selected (see `getHomeHighlights`).

Reference files: `server/db.js:57-156`, `server/db.js:158-470`,
`server/db.js:1078-1663`, `tests/backup-sqlite.test.js`, and
`tests/notification-outbox.test.js`.
