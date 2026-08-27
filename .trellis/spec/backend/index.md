# Backend Development Guidelines

These rules describe the current Node.js + Express backend. They are source-
backed constraints for future work, not a proposal to replace the existing
stack.

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | `server/` modules, scripts, and tests | Current |
| [Database Guidelines](./database-guidelines.md) | Multi-driver SQL, schema compatibility, and row mapping | Current |
| [Error Handling](./error-handling.md) | API envelope, async propagation, and HTTP error mapping | Current |
| [Quality Guidelines](./quality-guidelines.md) | JavaScript tests, security boundaries, and review checks | Current |
| [Logging Guidelines](./logging-guidelines.md) | Pino fields, request ids, levels, and redaction | Current |

## Pre-development checklist

1. Read this index and the guideline matching the layer you will change.
2. Trace input through `validation.js`, `app.js`, and `db.js` before
   changing a response or schema.
3. Preserve the API envelope, security middleware, and public/admin DTO
   boundaries.
4. Run focused tests first, then the appropriate full checks from
   `quality-guidelines.md`.

## Quality check

- Run `node --check` for changed JavaScript and the relevant `node:test` files.
- Run `npm test` for the full baseline; record the known native SQLite ABI
  blocker when it occurs.
- Run `git diff --check` and confirm only the task's spec/task files changed.
