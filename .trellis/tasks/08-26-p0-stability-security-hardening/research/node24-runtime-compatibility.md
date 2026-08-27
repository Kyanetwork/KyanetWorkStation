# Node.js 24 runtime compatibility research

## Evidence date

2026-08-26. Registry metadata was queried with `npm view`; the local checkout was inspected without changing dependencies.

## Current repository state

- Local runtime: Node.js `v24.19.0`, Node module ABI `137`.
- `package.json` declares only `node >=20.0.0` and depends on `better-sqlite3 ^11.9.1`.
- The installed package is `better-sqlite3 11.10.0`, but `node_modules/better-sqlite3/build/Release/better_sqlite3.node` was built for ABI `127`; SQLite startup therefore fails on this Node 24 process with `ERR_DLOPEN_FAILED`.
- The lockfile is present and must be updated together with `package.json` if the dependency version changes.

## Registry compatibility evidence

- `better-sqlite3 12.4.1` publishes engines `20.x || 22.x || 23.x || 24.x`.
- `better-sqlite3 13.0.3` is the current registry latest at research time and publishes engines `>=22`; it uses `node-addon-api ^8.0.0`.
- `better-sqlite3 11.10.0` does not publish a Node 24 engine declaration in the queried metadata and its already-installed native binary is not usable with ABI 137.
- `nodemailer 9.0.5` is available and supports Node `>=6`; the audit report identifies the currently installed `8.0.5` as vulnerable through `<=9.0.0`, so the exact fixed release/advisory status must be rechecked after upgrade. Do not assume a major upgrade is behavior-free.
- `qs 6.15.3` and `body-parser 2.3.0` are available, but Express 4.22.1 currently depends on the `1.x` body-parser line and `qs ~6.14.0`. Prefer the smallest compatible Express patch/minor or npm override only after running the complete test suite; do not add a second parser stack.

## Recommended P0 decision

Use Node.js 24 LTS as the single required release runtime. Prefer the smallest `better-sqlite3` version that explicitly supports Node 24 (start with the current supported 12.x line if API compatibility tests pass; evaluate 13.x only if needed), then perform a clean install or `npm rebuild` under Node 24 and verify the loaded native module ABI at runtime. Keep Node 20/22 as optional checks rather than release blockers.

The implementation must record:

1. the exact Node/npm versions used;
2. the exact `better-sqlite3` version and lockfile diff;
3. clean-install/rebuild output and a successful SQLite initialization;
4. full `npm test`, `npm audit --omit=dev`, and API smoke results;
5. rollback instructions to the prior lockfile/package pair if SQLite or database compatibility regresses.

## Constraints

- Do not replace SQLite, Express, or the database abstraction.
- Do not claim Node 24 support from `engines` alone; the native module must load and the project tests must pass.
- Do not commit `node_modules`, local databases, audit credentials, or runtime logs.
