# Backend Quality Guidelines

## Current toolchain

The project runs CommonJS JavaScript on Node.js 24.x LTS and uses Node's built-in
`node:test` plus `node:assert/strict`. `package.json` currently defines
`npm test` but no ESLint, TypeScript, or separate type-check script. Do not
claim a lint/type-check pass that the repository cannot run; use syntax checks,
focused tests, `npm test`, and `git diff --check` as applicable.

## Required implementation shape

- Validate every external payload at the route boundary with a `validate*`
  function before writing or querying.
- Use parameterized SQL through `server/db.js` and map rows into explicit
  camelCase objects.
- Return the shared API envelope and use `sendError` for failures.
- Keep the admin cookie/session as the only active request authority. Legacy
  Account helpers/tables are migration-only and must not be imported by active
  routes or authorize mutations.
- Keep admin mutations behind the same-origin and JSON middleware.
- Use bounded, structured Pino logs and redact credential-bearing URLs.
- Add a focused test when introducing a validator, adapter contract, security
  rule, or cross-layer response shape.

## Forbidden patterns

- Raw driver calls or SQL string interpolation in `app.js` or a new route.
- Returning `SELECT *` rows from a public or user-scoped endpoint.
- Logging credentials, session tokens, or unbounded user input.
- Silently accepting unknown enum values, malformed IDs, or invalid booleans.
- Making new functionality depend on the frozen KyanetAccount integration.
- Introducing a frontend framework, ORM, or broad abstraction without a
  separate architecture decision.

## Testing examples

Use small deterministic tests like `tests/validation.test.js`,
`tests/security.test.js`, and `tests/logger.test.js` for pure functions. Use
temporary databases and cleanup hooks for persistence/restore behavior, as in
`tests/backup-sqlite.test.js` and `tests/notification-outbox.test.js`.
Historical Account helper tests may remain only to protect migration behavior;
they are not active request-path coverage.

The full suite is `npm test`. It is a Node 24 release gate; if the installed
`better-sqlite3` binary ABI does not match the active runtime, rebuild it in
that same Node version and record the failure rather than labeling the suite
passing. See `docs/testing/release-checklist.md`.

## Node 24 native-install policy

npm 12 can block dependency install scripts that are not explicitly approved.
The repository therefore keeps a narrow `package.json#allowScripts` allow-list
containing only `better-sqlite3`. The reproducibility check uses
`npm ci --foreground-scripts` so the native install result is visible; use
`npm rebuild better-sqlite3` only as the documented fallback when a matching
prebuild is unavailable. Do not replace the allow-list with a global
`--dangerously-allow-all-scripts` bypass or commit `node_modules`.

## Review checklist

- [ ] The changed route has validation, auth/source guards, and the expected
      status/error codes.
- [ ] Every database value is parameterized and all supported drivers remain
      compatible.
- [ ] Public, account-scoped, and admin DTOs expose only the intended fields.
- [ ] Async failures reach the Express error boundary exactly once.
- [ ] New behavior has a focused `node:test` regression or an explicit reason
      why an existing test is sufficient.
- [ ] Tests, `git diff --check`, and any relevant runtime smoke check were run;
      results and environment blockers are recorded.

Reference files: `package.json`, `server/app.js`, `server/db.js`,
`server/validation.js`, `server/security.js`, and `tests/*.test.js`.
