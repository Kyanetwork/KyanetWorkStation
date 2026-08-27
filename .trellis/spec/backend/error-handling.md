# Backend Error Handling

## Response contract

Use `sendError(res, status, code, message)` from `server/errors.js` for API
failures. It always produces:

```json
{
  "ok": false,
  "error": { "code": "INVALID_PAYLOAD", "message": "..." }
}
```

Successful endpoints normally return `{ ok: true, data: ... }`. Keep error
codes stable and keep user-facing messages actionable without exposing stack
traces, SQL, credentials, or upstream secrets.

## Validation failures

`server/validation.js` normalizes and validates input without sending a
response. A route must check the result and return a 400 error immediately:

```js
const validation = validateWorktaskPayload(req.body || {});
if (!validation.valid) {
  return sendError(res, 400, "INVALID_PAYLOAD", validation.message);
}
```

Do not throw for ordinary user input errors, and do not duplicate field rules
in `app.js`. The feedback, WorkTask, admin list, status, and settings routes
are the reference callers.

## Async propagation and middleware

Wrap async route handlers with the local `asyncHandler`, which forwards
rejected promises to Express. Authentication middleware catches its own database
errors and calls `next(error)`. On expected auth/session failures it clears an
invalid cookie when appropriate and sends 401 (`UNAUTHORIZED`).

For mutations that affect a missing row, inspect the `changes` count and return
404 (`NOT_FOUND`), as the feedback and WorkTask status/delete handlers do. Use
415 for a non-JSON admin mutation and 403 (`CSRF_BLOCKED`) for a failed source
check. External SMTP/Webhook test failures are mapped to 400 when configuration
is incomplete and 502 when the configured provider cannot send.

## Final Express boundary

The final handlers in `server/app.js:843-861` distinguish an unknown API route
from a static-page 404. The error middleware logs `request.error`, returns a
generic 500 (`INTERNAL_ERROR`), and delegates to Express if headers were
already sent. Preserve this order: static files and the 404 handler precede
the error handler.

Notification delivery after a successful submission is intentionally
fire-and-forget (`server/app.js:247-269`); notification errors are logged and
must not turn an already-created feedback or WorkTask response into a second
HTTP response.

## Common mistakes

- Sending `{ error: "..." }` or a raw exception instead of the shared shape.
- Continuing after `sendError`, causing a double response.
- Returning `err.message` or a stack trace from the final 500 handler.
- Treating a database error as `NOT_FOUND`; reserve 404 for zero affected rows.
- Awaiting a background notification inside the submission response path.
- Logging a ticket, session token, password, or full sensitive submission while
  diagnosing an error.

Reference files: `server/errors.js`, `server/app.js:156-160`,
`server/app.js:670-860`, `server/auth.js`, `server/account-session.js`, and
`tests/security.test.js`.
