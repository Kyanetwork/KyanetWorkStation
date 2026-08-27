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

Notification delivery after a successful submission is handed to the
database-backed `notification_delivery` outbox (`server/app.js:154-255`). The
submission route may wait for the small local outbox write, but it must never
wait for SMTP/Webhook network delivery or turn a provider failure into a second
HTTP response. The worker applies bounded retries; operators use the admin
notification list/retry endpoints for records in `failed` or `retrying` state.

## Common mistakes

- Sending `{ error: "..." }` or a raw exception instead of the shared shape.
- Continuing after `sendError`, causing a double response.
- Returning `err.message` or a stack trace from the final 500 handler.
- Treating a database error as `NOT_FOUND`; reserve 404 for zero affected rows.
- Awaiting SMTP/Webhook network delivery inside the submission response path;
  only the bounded local outbox write may be awaited.
- Logging a ticket, session token, password, or full sensitive submission while
  diagnosing an error.

Reference files: `server/errors.js`, `server/app.js:156-160`,
`server/app.js:670-860`, `server/auth.js`, `server/account-session.js`, and
`tests/security.test.js`.

## P0 stability contracts

### 1. Scope / Trigger

This contract applies when changing runtime preflight, same-origin admin
mutations, public projections, or notification delivery. These paths cross
configuration, HTTP, database, and external-provider boundaries.

### 2. Signatures

- `validateRuntimeConfig(candidate) -> { valid, errors[] }`
- `createRequireSameOriginForAdminMutation({ appBaseUrl, trustProxy, allowHeaderlessAdminMutation, sendError })`
- `enqueueNotificationDeliveries({ entityType, entityId, providers }) -> Promise<number[]>`
- `retryNotificationDelivery(id) -> Promise<number>`

### 3. Contracts

- Startup validates `DB_CLIENT`, database path/URL, port, proxy count, base URL,
  enabled external providers, and bounded timeout/limit values before opening a
  database or listening socket.
- Public projections use an allow-list and never include submission content,
  contact data, administrator notes, account snapshots, or provider payloads.
- A notification row records only event/entity identity, provider, a redacted
  target label, status, attempt count, next attempt, and bounded error text.
- Manual retry only resets `failed`/`retrying` rows; `delivered` rows are
  immutable through that endpoint.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Invalid runtime combination | Bootstrap error naming configuration keys; no listener/database initialization |
| Direct mutation with spoofed forwarded headers | `403 CSRF_BLOCKED` |
| Missing/invalid admin JSON | `415 UNSUPPORTED_MEDIA_TYPE` or `400 INVALID_PAYLOAD` |
| Provider timeout/failure | Durable `retrying`/`failed` row; business write remains successful |
| Retry of missing or delivered row | `404 NOT_FOUND` from the admin route |

### 5. Good / Base / Bad Cases

- Good: Node 24 starts with matching native dependencies; the worker retries a
  failed provider after restart and the operator can inspect its redacted row.
- Base: SMTP/Webhook are disabled, submissions succeed, and no outbox row is
  created.
- Bad: A route trusts raw forwarded headers, returns a complete database row,
  or logs a URL/password/provider response body.

### 6. Tests Required

- Config tests assert invalid combinations fail without secret text.
- Security tests cover direct, correctly proxied, cross-origin, and headerless
  mutations.
- API tests assert public DTO field absence and anonymous submission without
  Account service.
- Outbox tests assert persistence, bounded failure state, targeted retry, and
  rejection of delivered-row retry.

### 7. Wrong vs Correct

#### Wrong

```js
fireAndForget(() => sendWebhook(payload));
```

#### Correct

```js
await enqueueNotificationDeliveries({ entityType: "feedback", entityId, providers: ["webhook"] });
// A separate bounded worker performs network delivery and records the result.
```
