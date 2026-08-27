# Backend Logging Guidelines

## Logger setup

Use the Pino instance exported by `server/logger.js`; do not use
`console.log`. The logger is named `kyanet-workstation`, includes `service`
and `env` base fields, and emits ISO timestamps. It writes to stdout and can
also write `logs/app.log` when `LOG_TO_FILE=true`.

Use a child logger for a subsystem, as `notify.js` and `webhook.js` do:

```js
const { logger } = require("./logger");
const moduleLogger = logger.child({ module: "example" });
```

Within a request, prefer `req.log`, which already carries the bounded
`requestId` from `x-request-id` or a generated UUID. Include stable fields
(`event`, `route`, `statusCode`, or an external provider name) rather than
building an unsearchable sentence.

## Access-log behavior

`requestLoggerMiddleware` records `request.start` and `request.finish`
(or `request.close`) with method, redacted path, status, and duration. It
chooses levels as follows:

- `error` for HTTP 5xx.
- `warn` for HTTP 4xx or a request slower than `ACCESS_LOG_SLOW_MS`.
- `info` for ordinary completion.
- `warn` for a client connection that closes before completion.

Health access logs can be skipped with `ACCESS_LOG_SKIP_HEALTH`; do not add a
second ad-hoc request logger in a route.

## What to log

Log lifecycle and operational facts: startup/shutdown failures, session cleanup
failures, rejected provider configuration, notification success/failure counts,
request ids, status codes, and duration. Use event names already present in
`server/app.js` such as `bootstrap.error`, `session.cleanup.error`, and
`request.error` when extending an existing flow.

For partial or multi-target delivery, log counts and a bounded error message,
not the complete request body. Keep provider-specific diagnostics in the
provider child logger.

## Sensitive data and redaction

Never log passwords, bcrypt hashes, integration secrets, session cookies, login
tickets, webhook signatures, or full contact/submission contents. Access paths
must pass through `redactSensitiveUrl`, which redacts query keys named
`ticket`, `token`, `secret`, `password`, `pass`, or `key`; keep this
list in sync if a new credential-bearing query parameter is introduced.

Do not put an unredacted `req.originalUrl`, `req.headers`, or `req.body`
into a log object. User-agent and error strings are bounded in the existing
request logger; preserve similar bounds for new external values.

## Verification

Configuration parsing and URL redaction are covered by `tests/config.test.js`
and `tests/logger.test.js`. Add a focused regression whenever a new sensitive
field or log event is introduced.
