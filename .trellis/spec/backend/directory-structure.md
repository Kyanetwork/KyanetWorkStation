# Backend Directory Structure

## Runtime shape

This is a single Node.js CommonJS application. There is no controller/service
tree: HTTP composition and route handlers live in `server/app.js`, while
focused modules at the `server/` root own persistence, validation, security,
authentication, logging, and external integrations.

```text
server/
├── app.js             # Express composition, middleware, routes, startup
├── db.js              # database drivers, schema compatibility, queries, row maps
├── validation.js       # input normalization and allow-list validation
├── auth.js             # administrator session middleware
├── account-auth.js     # frozen legacy Account ticket exchange
├── account-session.js  # frozen legacy Account session middleware
├── security.js         # same-origin and JSON request guards
├── errors.js           # API error response helper
├── logger.js           # Pino logger and access logging
├── notify.js           # SMTP notification adapter
├── webhook.js          # webhook provider adapter
├── meowstatus.js       # MeowStatus HTTP adapter and response normalization
└── config.js           # environment parsing and runtime configuration
scripts/               # operational CLIs (admin bootstrap and backups)
tests/                 # Node built-in node:test tests
public/                # static HTML/CSS/JavaScript pages
```

The layout is intentionally small and should remain so while the Workstation
features grow. Do not introduce a new framework or a generic service layer for
a single endpoint.

## Adding backend behavior

- Add the route, middleware ordering, and response projection in
  `server/app.js`.
- Put request normalization and allow-lists in `server/validation.js`.
- Put SQL and database-to-API row mapping in `server/db.js`; callers should not
  import a database driver directly.
- Put reusable protocol or boundary logic in the existing focused adapter
  (`security.js`, `auth.js`, `notify.js`, `webhook.js`, or
  `meowstatus.js`).
- Keep operational one-shot commands under `scripts/` and tests under
  `tests/`.

The normal request path is visible in `app.js`: validate with a
`validate*Payload` function, call a `db.js` operation, then return either
`{ ok: true, data: ... }` or `sendError(...)`. The feedback and WorkTask
routes at `server/app.js:472-530` are the reference examples.

## Naming and module style

Use lower-case hyphenated filenames (`account-session.js`,
`meowstatus.js`), CommonJS `require`/`module.exports`, and camelCase
JavaScript functions and properties. Keep SQL names snake_case and convert them
at the `map*Row` boundary. Prefer a named function over an anonymous inline
abstraction when a pattern is reused by more than one route.

## Boundaries to preserve

- `app.js` owns orchestration, not SQL details.
- `db.js` owns persistence and row conversion, not HTML or HTTP status codes.
- `validation.js` returns validation results; it does not send responses.
- The legacy Account modules are maintenance-frozen. New Workstation features
  must not depend on them; a future Account integration needs a separate design.

Reference files: `server/app.js`, `server/db.js`, `server/validation.js`,
`server/auth.js`, `scripts/init-admin.js`, and
`tests/account-submission.test.js`.
