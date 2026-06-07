# Verification

Required checks for Task 5:

- RED: Run the new account submission route test before implementation and record the expected failures.
- GREEN: Run the targeted account submission route test after implementation.
- FINAL: Run full `npm test` and confirm exit code 0 before committing.

Observed on 2026-06-07:

- RED: `node --test tests/account-submission.test.js` exited 1 with 4 tests, 1 pass, 3 fail.
  - Failures were expected feature gaps: anonymous submission still returned 201, and `/auth/account/start` returned 404.
- GREEN: `node --test tests/account-submission.test.js` passed with 4 tests.
- FINAL: `npm test` passed with 37 tests.
- FINAL re-run after status request: `npm test` passed with 37 tests.
- Visual evidence could not be captured because the repo has no `.agent-md/.bin` helper and local `playwright` is not installed.

Definition of done:

- Feedback submission rejects anonymous requests by default and when Account policy requires login.
- WorkTask submission rejects anonymous requests by default and when Account policy requires login.
- Anonymous submission still works only when KyanetAccount policy explicitly allows it.
- Account-authenticated feedback and WorkTask submissions persist account user id, email snapshot, and display name snapshot.
- Account list routes return only the current Account user's own feedback and WorkTask.
- Account login start/callback/me/logout routes work with the existing ticket exchange/session helpers.
- KWS admin routes still require admin session and reject account-only sessions.
- Frontend tells unauthenticated users: `提交前请先登录 KyanetAccount`.
- Admin list UI displays linked account snapshot when present.
