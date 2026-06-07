# Verification

Required checks for Task 4:

- RED: Run `npm test` after adding failing tests and record expected failures.
- GREEN: Run `npm test` after implementation and confirm exit code 0.

Observed on 2026-06-07:

- RED after initial tests: `npm test` failed because `../server/account-auth` and `server/account-session.js` were missing; existing tests passed.
- RED after partial implementation review:
  - `tests/account-auth.test.js` failed because exchange used singular `/api/integration/workstation/login-ticket/exchange` instead of Account's `/api/integrations/workstation/login-ticket/exchange`.
  - `tests/account-auth.test.js` failed because KyanetAccount `user.profile.displayName` was not mapped.
  - `tests/account-session.test.js` failed because `db.createAccountSessionRecord` did not exist.
- Targeted Task 4 GREEN: `node --test tests/account-auth.test.js tests/account-session.test.js` passed with 9 tests.
- Full Task 4 GREEN: `npm test` passed with 33 tests.

Definition of done:

- Account auth policy cache fails closed.
- Ticket exchange uses bearer integration secret and validates account user response.
- Account session uses a cookie separate from admin session.
- Expired account sessions clear account cookie.
- DB has `account_session` schema and CRUD across supported adapters.
