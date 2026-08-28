# Research: Node.js 24 LTS and production dependency remediation

- Query: Can KyanetWorkStation use Node.js 24 LTS, which `better-sqlite3` release is the smallest low-risk compatible upgrade, and what is the smallest safe upgrade path for the current Express/body-parser/qs/Nodemailer audit findings?
- Scope: mixed (repository, npm registry, Node.js release index, upstream release metadata)
- Date: 2026-08-27

## Findings

### Node.js 24 is a viable required runtime baseline

- The local runtime is Node.js `v24.19.0`, npm `12.0.2`, Windows x64, Node module ABI `137`, and N-API `10` (`process.versions.modules` / `process.versions.napi`). The existing native addon was compiled for ABI `127`, which explains the observed `ERR_DLOPEN_FAILED`.
- The official Node release index (`https://nodejs.org/dist/index.json`) identifies both `v24.19.0` and the newer `v24.20.0` (released 2026-08-26) as LTS `Krypton`. The project can therefore make Node `24.x` the first required release line while allowing patch updates within that major.
- Recommended root engine policy: `"node": "24.x"` (or the equivalent documented `>=24.0.0 <25.0.0`). Do not leave `>=20.0.0` as the only release declaration if Node 24 is the actual gate; optional Node 20/22 checks can remain separate and non-blocking.

### `better-sqlite3` compatibility and choice

| Candidate | Registry engines | Node 24 ABI evidence | Risk/choice |
|---|---|---|---|
| `11.10.0` (installed) | no Node engine declaration in queried metadata | upstream release assets stop at `node-v131`; no `node-v137` prebuild | Rebuild may require local toolchain; not a good Node 24 baseline |
| `12.6.2` | `20.x || 22.x || 23.x || 24.x || 25.x` | release `v12.6.2` publishes `node-v137-win32-x64` | First 12.x release with explicit Node 24 support; viable minimum |
| `12.11.1` | `20.x || 22.x || 23.x || 24.x || 25.x || 26.x` | release `v12.11.1` publishes `node-v137-win32-x64` | Recommended low-risk target: current 12.x bugfix release with the same prebuild model |
| `13.0.3` | `>=22` | ships N-API platform binaries rather than `node-v137` assets | Technically compatible, but major migration; defer unless 12.x is insufficient |

- Exact npm registry metadata observed for `better-sqlite3@12.11.1`: tarball `https://registry.npmjs.org/better-sqlite3/-/better-sqlite3-12.11.1.tgz`, integrity `sha512-dq9AtApgg5PGFtBzPFSBl3HZQjHok5gaQCM6zh2Yk0aSmDCs1CbnVI8/HgASQkNKsWFpseIO9beg5xxpYhbIfA==`, shasum `067846efabf7671957fc8a9e8df3be39c6cc0b84`.
- Exact upstream release evidence: `https://github.com/WiseLibs/better-sqlite3/releases/tag/v12.11.1` lists `better-sqlite3-v12.11.1-node-v137-win32-x64.tar.gz`; the release notes only describe an Electron v42 Windows build fix. `v12.6.2` also has the Node v137 Windows x64 prebuild and includes a node-abi build fix.
- `better-sqlite3` v12.0.0 dropped EOL Node 18 and added Node 24 to its build matrix. The repository already declares Node 20+, so the runtime floor change is not relevant to this application. The v13 line changes the native binding architecture to N-API and should be treated as a separate major upgrade.
- Recommended package change for the implementation phase: change the direct dependency from `better-sqlite3: ^11.9.1` to `better-sqlite3: ^12.11.1`, regenerate the lockfile under Node 24, and verify that `require("better-sqlite3")` loads and that `process.versions.modules` is `137`. Do not commit `node_modules` or a locally built binary.
- Clean-install acceptance must cover both `npm ci` (lockfile reproducibility) and a clean `npm install`/`npm rebuild` fallback. A matching prebuild is evidence for Windows x64 only; Linux/macOS deployment targets still need their own install smoke checks.

### Current audit and smallest safe remediation

The canonical registry audit (`npm audit --omit=dev --registry=https://registry.npmjs.org --json`, captured in `npm-audit-current.json`) reports four production vulnerabilities: three moderate and one high.

| Package/path | Current | Advisory/fixed range | Smallest compatible action |
|---|---:|---|---|
| `body-parser` via Express | `1.20.4` | `GHSA-v422-hmwv-36x6`, vulnerable `<1.20.6`; current package also falls under the `<=1.20.5` aggregate range | Upgrade Express to `4.22.2`; it requests `body-parser ~1.20.5`, and npm resolves fixed `1.20.6` |
| `qs` via Express/body-parser | `6.14.2` | `GHSA-q8mj-m7cp-5q26`, vulnerable `6.11.1` through `6.15.1`; fixed `>=6.15.2` | Express `4.22.2` requests `qs ~6.15.1`; npm audit's dry-run resolves `6.15.3` |
| `express` direct | `4.22.1` | Express advisory path through vulnerable `qs`; `4.22.1` is in the affected range | Change direct range to `^4.22.2` and regenerate the lockfile. `express-rate-limit@7.5.1` accepts Express `>=4.11`, so no peer conflict is expected |
| `nodemailer` direct | `8.0.5` | `GHSA-268h-hp4c-crq3`, `GHSA-wqvq-jvpq-h66f` affect `<=8.0.8`; `GHSA-r7g4-qg5f-qqm2` affects `<=8.0.7`; high `GHSA-p6gq-j5cr-w38f` affects `<=9.0.0` | A same-major `8.x` upgrade cannot clear the high advisory. Minimum fixed release is `9.0.1`; use the current `9.0.5` patch release (`^9.0.5`) after compatibility testing |

- `npm audit fix --dry-run` against the current lockfile proposes `express 4.22.1 -> 4.22.2`, `body-parser 1.20.4 -> 1.20.6`, `qs 6.14.2 -> 6.15.3`, and `nodemailer 8.0.5 -> 8.0.11`; however, an isolated audit of `nodemailer@8.0.11` still reports the high `GHSA-p6gq-j5cr-w38f`. Treat the dry-run's Nodemailer suggestion as insufficient. The same dry-run also updates transitive `side-channel 1.1.0 -> 1.1.1`, `hasown 2.0.3 -> 2.0.4`, and `es-object-atoms 1.1.1 -> 1.1.2`.
- Exact registry integrity observed for the direct fixed candidates: `express@4.22.2` integrity `sha512-IuL+Elrou2ZvCFHs18/CIzy2Nzvo25nZ1/D2eIZlz7c+QUayAcYoiM2BthCjs+EBHVpjYjcuLDAiCWgeIX3X1Q==`; `nodemailer@9.0.1` integrity `sha512-Gwv8SQewT616ZM/URn0H54b8PWo/Wum7md3EW2aWy1lO27+WZCX+Xyak3J+NlmHUjDh5ME+uesJUDRbR3Ye8Bw==`; `nodemailer@9.0.5` integrity `sha512-wvjiKvjczmsN7U/8006JOdXubgBk2XFAbioDMbT+sM7cPs0QrhJTa6KBRX7P5REGGkDcLUz/EarWidb8G8C1jQ==`. The lockfile should obtain these values from npm rather than hand-editing them. `nodemailer@8.0.11` was also queried (`sha512-nrO/pDAUKl+wXX+lx16tDLbnm0fW6sK/x8mgohaCpg+CdCEl482bD4tCuAZk2DyliruiNTIZxRCoWkDqJEnAiA==`) but remains vulnerable to the high advisory.
- Keep the existing Express 4 architecture in P0. Express 5.2.1 and `body-parser` 2.3.0 are available, but they introduce a broader major/parser change and are not needed to clear the current advisory set. Nodemailer is different: its high advisory remains through `9.0.0`, so the required `8.x -> 9.x` upgrade is security-driven rather than optional scope expansion.
- After the implementation upgrade, rerun the audit against the canonical registry. The mirror currently configured in npm (`https://registry.npmmirror.com`) returns `404 Not Implemented` for the security advisory endpoint, so a mirror failure must not be interpreted as a clean audit.

### Recommended implementation sequence

1. Set the documented release baseline to Node `24.x`; capture the exact Node/npm versions used.
2. Upgrade `better-sqlite3` to `^12.11.1`, run `npm ci` or a clean install under Node 24, and verify native loading/ABI before running integration tests.
3. Upgrade direct `express` to `^4.22.2` and `nodemailer` to `^9.0.5`; let the lockfile resolve `body-parser 1.20.6`, `qs 6.15.3`, and the required transitive patches.
4. Run the full test suite, API smoke path, `npm audit --omit=dev --registry=https://registry.npmjs.org`, and a lockfile-only reproducibility check. Roll back the package/lock pair together if native loading or endpoint behavior regresses.

## Files found

- `package.json:18-32` — Node engine and direct `better-sqlite3`, Express, and Nodemailer ranges.
- `package-lock.json:7-24,106-155,452-510,946-953` — resolved package versions and dependency ranges.
- `server/db.js:57-156,429-442,1426` — the only database driver boundary and SQLite lifecycle.
- `server/app.js:87-111,843-897` — Express initialization, middleware, and startup order.
- `server/notify.js:55-112` — Nodemailer is loaded lazily and uses standard SMTP `createTransport`/`sendMail`; the audit upgrade should not require a route architecture change.
- `docs/testing/release-checklist.md:5-20,32-45` — existing Node/ABI and audit release gates that need the final versions/results.
- `docs/operations/deployment.md:3-8,28-37` — deployment instructions currently say Node 20+ and need the agreed Node 24 baseline.
- `docs/plans/known-defects.md:13-14` — D-005/D-006 record the ABI and audit blockers.
- `.trellis/spec/backend/database-guidelines.md` — database driver boundary and migration/test constraints.
- `.trellis/spec/backend/quality-guidelines.md` — focused tests, syntax checks, and honest reporting of environment blockers.

## Code patterns

- `server/db.js:65-69` constructs the SQLite driver and sets pragmas; a loaded-binary check can be placed at the existing database boundary or in a startup preflight without adding another database abstraction.
- `server/notify.js:55-71` lazily requires Nodemailer and creates a transport; the same public API is present in the fixed 8.x target, but SMTP behavior still needs focused tests after the lockfile update.
- `server/app.js:87-89` exposes the Express `trust proxy` setting; retaining Express 4 avoids combining the dependency remediation with the separate proxy-boundary fix.

## External references

- Node.js official release index: `https://nodejs.org/dist/index.json` (LTS label and `v24.19.0`/`v24.20.0` dates, queried 2026-08-26).
- better-sqlite3 npm metadata: `https://registry.npmjs.org/better-sqlite3` (`12.6.2`, `12.11.1`, and `13.0.3` engines, dependencies, and integrity values).
- better-sqlite3 releases: `https://github.com/WiseLibs/better-sqlite3/releases/tag/v12.6.2`, `https://github.com/WiseLibs/better-sqlite3/releases/tag/v12.11.1`, and `https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.3` (Node v137 prebuild and major-version notes).
- Express npm metadata: `https://registry.npmjs.org/express` (`4.22.1` versus `4.22.2` dependency ranges and integrity).
- body-parser npm metadata: `https://registry.npmjs.org/body-parser` (`1.20.4` versus `1.20.6`).
- qs npm metadata: `https://registry.npmjs.org/qs` (`6.14.2`, `6.15.2`, and `6.15.3`).
- Nodemailer npm metadata: `https://registry.npmjs.org/nodemailer` (`8.0.5`, `8.0.11`, minimum fixed `9.0.1`, and current `9.0.5`).
- Nodemailer upstream releases: `https://github.com/nodemailer/nodemailer/releases/tag/v9.0.0` (TLS certificate validation is a documented breaking change), `.../v9.0.1` (enforces file/URL access restrictions for raw messages), and `.../v9.0.5` (additional header/control-character hardening).
- npm audit advisory URLs are preserved in `npm-audit-current.json`, including `GHSA-v422-hmwv-36x6`, `GHSA-q8mj-m7cp-5q26`, `GHSA-268h-hp4c-crq3`, `GHSA-wqvq-jvpq-h66f`, `GHSA-r7g4-qg5f-qqm2`, and `GHSA-p6gq-j5cr-w38f`.

## Related specs

- `.trellis/spec/backend/database-guidelines.md`
- `.trellis/spec/backend/quality-guidelines.md`
- `.trellis/spec/backend/error-handling.md`
- `.trellis/tasks/08-26-p0-stability-security-hardening/prd.md` (R3 and D-005/D-006 acceptance scope)

## Caveats / Not Found

- This research did not change `package.json`, `package-lock.json`, source code, or installed dependencies. The downloaded package tarballs and raw audit JSON are research evidence only; they must not be treated as the production lockfile.
- The current npm audit was run against the canonical npm registry. The configured mirror cannot serve npm's advisory endpoint, so audit results from that mirror are unavailable.
- Registry and GitHub release evidence proves published metadata and available prebuilds, not that this repository's complete test suite passes after the upgrade. The implementation must perform the clean install, native load, startup, full tests, and API smoke verification.
- `better-sqlite3` 12.x is still a major-version upgrade from 11.x. The upstream release notes show the Node 24 build-matrix change and no application-specific migration, but the project's SQL/backup/integration tests remain the compatibility authority.
- The high Nodemailer advisory's fixed boundary is `>9.0.0`; an isolated canonical-registry audit reports `8.0.11` and `9.0.0` still vulnerable, while `9.0.1` and `9.0.5` report zero vulnerabilities. Nodemailer 9.0.0 changes HTTPS remote-content behavior to validate TLS certificates by default; audit the current SMTP configuration and any remote-content/OAuth usage before accepting the major upgrade. `server/notify.js` currently sends ordinary SMTP text mail and does not pass remote attachments or raw message options, but this must be verified by tests.
- No claim is made here about Node 24 support for optional MySQL/PostgreSQL native modules on every deployment image; those drivers require separate matrix checks.
