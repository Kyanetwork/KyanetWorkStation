# Backend Quality Guidelines

## Current toolchain

The project runs CommonJS JavaScript on Node.js 20+ and uses Node's built-in
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
- Preserve separate admin and legacy Account cookies/sessions; never use one
  cookie as the other authority.
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
temporary databases and cleanup hooks for persistence/session behavior, as in
`tests/account-session.test.js`. Use an isolated fake HTTP Account server for
the legacy integration tests in `tests/account-submission.test.js`.

The full suite is `npm test`. The current documented environment may fail
SQLite-backed tests when the installed `better-sqlite3` binary ABI does not
match the active Node runtime; record that as an environment blocker and do not
label the suite passing. See `docs/testing/release-checklist.md`.

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
