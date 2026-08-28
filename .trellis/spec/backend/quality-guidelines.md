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

### SQLite child-process cleanup on Windows

When a test loads `better-sqlite3` in a child process to exercise legacy schema
initialization, keep the child alive after its readiness marker and terminate it
with an OS-level force path (`taskkill /T /F` on Windows, `SIGKILL` elsewhere).
On Node.js 24 for Windows, natural exit or explicit database close can trigger a
native environment-cleanup assertion after the migration has already passed.
The harness must still require the readiness marker and reject non-empty stderr;
this workaround is test isolation only and does not change production shutdown.

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

## Node 24 better-sqlite3 login compatibility contract

### 1. Scope / Trigger

This contract applies to the Node 24 release baseline and any dependency
change that can affect SQLite access during an Express JSON request. It was
added after `better-sqlite3@12.11.1` could trigger a native environment-cleanup
assertion on the administrator login path even though a simple ABI load passed.

### 2. Signatures

- `npm ci --foreground-scripts` — reproducible dependency installation.
- `node -e "require('better-sqlite3')(':memory:').close()"` — native load probe.
- `POST /api/admin/login` — authenticated request smoke path.
- `npm test` — full Node 24 regression suite.

### 3. Contracts

- The direct dependency is `better-sqlite3 ^13.0.3`; `package.json` and
  `package-lock.json` must be changed together.
- A release check must verify both native SQLite loading and an administrator
  JSON login/API smoke path; `process.versions.modules` alone is insufficient.
- The v13 N-API binding remains behind the existing `server/db.js` boundary; no
  route may call the native driver directly.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Node 24 + lockfile v13 install | `npm ci --foreground-scripts` exits 0 and the load probe succeeds |
| SQLite load succeeds but admin login crashes/exits | Release fails; inspect native dependency before changing routes |
| Package and lock ranges differ | Release fails; regenerate the lockfile |
| Node runtime is outside the declared 24.x gate | Treat as a separate compatibility check, not Node 24 release evidence |

### 5. Good / Base / Bad Cases

- Good: clean Node 24 install, SQLite memory probe, admin login and full tests
  all pass with `better-sqlite3 13.0.3`.
- Base: an existing deployment runs `npm ci`, restarts the single process, and
  confirms `/api/health` plus one admin login before serving traffic.
- Bad: a 12.x binary is accepted because ABI 137 loads, while the JSON login
  path is not exercised.

### 6. Tests Required

- `tests/runtime-compatibility.test.js` asserts the Node 24 dependency range,
  installed major version, and a real in-memory query.
- `tests/account-submission.test.js` must keep the child-process health →
  anonymous submission → admin login flow so a process exit cannot be hidden.
- The release gate runs `npm ci --foreground-scripts`, `npm test`, and the
  canonical-registry audit after any native dependency update.

### 7. Wrong vs Correct

#### Wrong

```bash
npm install --no-save better-sqlite3@13.0.3
node -e "require('better-sqlite3')(':memory:').close()"
```

This leaves the repository declaration on 12.x and does not prove a clean
deployment or login request.

#### Correct

```bash
npm install --save better-sqlite3@^13.0.3
npm ci --foreground-scripts
node -e "require('better-sqlite3')(':memory:').close()"
npm test
```

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

## Production process management contract

### 1. Scope / Trigger

适用于 Node.js 应用在 Linux 反向代理后的长期运行、Node 版本升级和发布重启；它约束
PM2/systemd 的选择，不改变应用代码的 Express/SQLite 架构。

### 2. Signatures

- PM2: `pm2 start ecosystem.config.cjs --only kyanet-workstation --update-env`、
  `pm2 save`、`pm2 startup`、`pm2 restart kyanet-workstation --update-env`
- PM2 evidence: `pm2 status`、`pm2 show kyanet-workstation`、
  `curl -fsS http://127.0.0.1:3000/api/health`
- systemd alternative: `systemctl enable --now kyanet-workstation` and
  `systemctl status kyanet-workstation --no-pager`

### 3. Contracts

- 同一个监听端口只能由一个进程管理器托管；PM2 与项目级 systemd unit 不得同时启用。
- `ecosystem.config.cjs` 使用 `cwd=__dirname`，保持部署目录可迁移；应用为单实例
  `fork`，并启用 `autorestart=true` 与 `max_memory_restart`。
- PM2 的 `autorestart` 处理进程退出/内存阈值；`pm2 startup` 只配置 PM2 守护进程的
  开机恢复，必须在 `pm2 save` 后验证。
- 生产 `.env`、数据库、备份、日志和 handoff journal 不得被 Git 同步或示例配置覆盖。

### 4. Validation & Error Matrix

| 条件 | 结果 |
|---|---|
| PM2 `status/show` 为 online 且 health 200 | 可继续发布，记录 PID/Node 路径摘要 |
| 3000 已被未知进程占用 | 暂停 PM2 启动，先确认 PID、所有者和回滚路径 |
| `pm2 save` 未执行或 startup 用户不一致 | 不宣称开机恢复，补齐同一用户的 startup/save |
| PM2 与项目级 systemd 同时配置 | 停止切换并只保留一个托管者，避免端口竞争 |
| health 失败或监听非预期地址 | 停止发布，查看 PM2/应用日志并按上一版本回滚 |

### 5. Good / Base / Bad Cases

- Good：从实际应用目录启动 PM2，`cwd=__dirname`，保存进程列表，重启服务器后
  `pm2 status` 和 health 均恢复。
- Base：仅在维护窗口执行 `pm2 restart`，确认依赖/ABI 和 health 后继续。
- Bad：用固定示例 `cwd`、覆盖已有 `.env`、直接强杀未知进程，或让 PM2/systemd
  同时绑定 3000。

### 6. Tests Required

- `node --check ecosystem.config.cjs`：配置语法和 `__dirname` 可加载。
- 部署环境记录 `pm2 status/show/save`、Node/npm/ABI、监听地址和 health。
- 服务器重启后再次断言 PM2 online、应用 PID/Node 路径和 health；失败不得以 Nginx
  301 单独视为应用已恢复。

### 7. Wrong vs Correct

#### Wrong

```bash
cp .env.example .env
pm2 start ecosystem.config.cjs
sudo systemctl enable --now kyanet-workstation
```

#### Correct

```bash
[ -f .env ] || cp .env.example .env
pm2 start ecosystem.config.cjs --only kyanet-workstation --update-env
pm2 save
pm2 startup
```
