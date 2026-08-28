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

## Legacy submission migration ordering

### 1. Scope / Trigger

This contract applies when `initializeDatabase()` must load a database created
before the current `account_*` submission columns existed.

### 2. Signatures

- `initializeDatabase() -> Promise<void>` creates base schema and runs ordered
  compatibility checks.
- `ensureSubmissionAccountColumns() -> Promise<void>` adds missing columns and
  then creates `idx_feedback_account_user_id` and
  `idx_worktask_account_user_id`.

### 3. Contracts

- Schema statements may create indexes only for columns guaranteed to exist in
  the same statement or in an earlier compatibility step.
- Legacy SQLite databases must retain existing rows while adding missing
  `account_user_id`, `account_email_snapshot`, and
  `account_display_name_snapshot` columns with empty-string defaults.
- SQLite, MySQL, and PostgreSQL schema definitions must keep the same ordering
  rule; the compatibility helper owns creation of the account indexes.
- Compatibility DDL must tolerate concurrent initializers: after an `ALTER TABLE`
  or `CREATE INDEX` error, re-check the expected column/index and suppress the
  error only when another initializer has already created that exact object.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Legacy feedback/worktask table lacks account columns | Add columns, then create both account indexes; initialization succeeds |
| Current table already has columns/indexes | Leave data and indexes intact; initialization remains idempotent |
| Two processes initialize the same legacy database concurrently | Both initializers may observe the object as missing; the loser re-checks after its DDL error and still succeeds |
| Schema statement references a compatibility-added column too early | Initialization fails with a driver column error; this is a defect to fix before release |

### 5. Good / Base / Bad Cases

- Good: old SQLite schema starts successfully and existing rows remain readable.
- Base: a new database creates columns and indexes through the same ordered path.
- Concurrent: two initializers converge on the same columns and indexes without
  treating a duplicate-object race as a startup failure.
- Bad: `CREATE INDEX ... (account_user_id)` runs before the compatibility column
  is added.

### 6. Tests Required

- `tests/backup-sqlite.test.js` must construct a legacy SQLite schema, call
  `initializeDatabase()`, assert success, assert all three account columns, and
  assert both account indexes.
- The test must also close the database and remove the temporary directory.

### 7. Wrong vs Correct

#### Wrong

```js
"CREATE INDEX IF NOT EXISTS idx_feedback_account_user_id ON feedback(account_user_id)",
// ensureSubmissionAccountColumns() adds account_user_id afterwards
```

#### Correct

```js
// ensureSubmissionAccountColumns() adds missing columns first and re-checks
// after a concurrent duplicate-object error.
if (!(await indexExists("feedback", "idx_feedback_account_user_id"))) {
  try {
    await execute("CREATE INDEX idx_feedback_account_user_id ON feedback(account_user_id)");
  } catch (error) {
    if (!(await indexExists("feedback", "idx_feedback_account_user_id"))) throw error;
  }
}
```

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
