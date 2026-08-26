# Workstation Documentation And Roadmap Implementation Plan

> **For agentic workers:** This is a documentation-only task. Follow the ordered steps, validate every artifact, and do not change application code.

**Goal:** 将 KyanetWorkStation 的项目入口、长期知识、历史归档和未来路线图整理为可公开维护且可转化为 Trellis 任务的文档体系。

**Architecture:** 根目录 README 作为导航入口；`docs/` 按产品、架构、API、运维、测试和计划分层；历史迁移资料进入 `docs/archive/`；Trellis 任务工件保留代码证据和后续执行计划。业务实现文件不在本任务修改范围内。

**Tech Stack:** Markdown、PowerShell、Trellis CLI、Git；验证使用 `rg`、`git diff --check`、Node `npm test` 基线命令。

---

### Task 1: Establish the reviewed planning artifacts

**Files:**
- Modify: `.trellis/tasks/08-26-workstation-docs-and-roadmap/prd.md`
- Create: `.trellis/tasks/08-26-workstation-docs-and-roadmap/research/current-state-audit.md`
- Create: `.trellis/tasks/08-26-workstation-docs-and-roadmap/design.md`
- Create: `.trellis/tasks/08-26-workstation-docs-and-roadmap/implement.md`

- [x] Confirm the PRD contains only resolved requirements, scope, evidence anchors, and observable acceptance criteria.
- [x] Confirm the design separates public docs, archive docs, and Trellis execution state without changing application architecture.
- [x] Confirm the implementation plan contains no unresolved placeholders or code changes outside documentation.
- [x] Run `python ./.trellis/scripts/task.py validate .trellis/tasks/08-26-workstation-docs-and-roadmap` and resolve artifact errors before activation.

### Task 2: Create the public documentation structure

**Files:**
- Modify: `README.md`
- Create: `docs/product/vision-scope.md`
- Create: `docs/product/feature-status.md`
- Create: `docs/architecture/current.md`
- Create: `docs/architecture/integration-boundaries.md`
- Create: `docs/api/reference.md`
- Create: `docs/operations/configuration.md`
- Create: `docs/operations/deployment.md`
- Create: `docs/operations/backup-restore.md`
- Create: `docs/operations/security.md`
- Create: `docs/operations/observability.md`
- Create: `docs/testing/release-checklist.md`

- [x] Copy only verified current behavior from `server/`, `public/`, `scripts/`, `deploy/`, `package.json`, and `.env.example` into the relevant authority file.
- [x] Document all current routes, including MeowStatus and status-settings routes, with authentication and error boundaries.
- [x] Document configuration from `server/config.js` and `.env.example`; mark any source/config mismatch as a defect instead of inventing a default.
- [x] Keep README to positioning, capability summary, local quick start, supported runtimes, and links to the authority files.
- [x] Add a visible “current limitations” section covering anonymous mode, no native file upload, single-admin model, and Account integration status.

### Task 3: Write the product and execution plans

**Files:**
- Create: `docs/plans/roadmap.md`
- Create: `docs/plans/known-defects.md`
- Create: `docs/plans/ai-assistant.md`
- Create: `docs/plans/account-refactor.md`

- [x] Split roadmap into P0, P1, and P2 with dependencies, exit criteria, risks, and future Trellis task names.
- [x] Record each confirmed defect with severity, evidence path/line, user impact, proposed fix boundary, and validation method.
- [x] Record AI provider isolation, default-off behavior, redaction, human confirmation, and staged capabilities.
- [x] Record old Account removal, future re-entry boundary, anonymous-history policy, and rollback prerequisites.
- [x] Keep future ideas explicitly labeled as planned or deferred rather than implemented.

### Task 4: Archive superseded documents and update ignore rules

**Files:**
- Move: `Feedback_CloudbaseVer.md` → `docs/archive/cloudbase-migration/Feedback_CloudbaseVer.md`
- Move: `migration2localweb_reference_guide.md` → `docs/archive/cloudbase-migration/migration2localweb_reference_guide.md`
- Move: `memory/agents.md` → `docs/archive/agent-notes/agents.md`
- Move: `memory/gotchas.md` → `docs/archive/agent-notes/gotchas.md`
- Move: `memory/progress.md` → `docs/archive/agent-notes/progress.md`
- Move: `memory/verify.md` → `docs/archive/agent-notes/verify.md`
- Move: `PLAN.md` → `docs/archive/legacy-plans/PLAN-2026-04.md` after its current facts are represented in `docs/plans/`
- Modify: `.gitignore`

- [x] Verify each source file exists and is tracked before moving it.
- [x] Prepend a historical disclaimer to every archived Markdown file without changing its historical body.
- [x] Remove ignore rules that hide current planning documents; retain secret, runtime, backup, log, and temporary-file rules.
- [x] Ensure no archive file contains newly introduced production secrets or data; preserve historical text unless it is a secret introduced by this task.

### Task 5: Validate documentation consistency and current baseline

**Files:**
- Review: all files under `docs/`, `README.md`, `.gitignore`, `.trellis/tasks/08-26-workstation-docs-and-roadmap/`

- [x] Run the documented planning-placeholder scan over `README.md`, `docs/`, and this task directory; ensure it returns no unresolved placeholders.
- [x] Run `git diff --check` and fix whitespace errors.
- [x] Run a link/path audit with `rg -n "\]\(" README.md docs` and verify every local target exists.
- [x] Run a secret-pattern audit that excludes `.env` contents and checks only tracked Markdown for private-key, bearer-token, webhook, and production-host patterns.
- [x] Run `npm test` once as a baseline; if the Node/better-sqlite3 ABI failure remains, record the exact failure in `docs/testing/release-checklist.md` and do not claim green.
- [x] Run `python ./.trellis/scripts/task.py validate .trellis/tasks/08-26-workstation-docs-and-roadmap` after all edits.
- [x] Review `git status --short` and keep business source files untouched.

### Task 6: Prepare follow-up implementation tasks

**Files:**
- Modify: `docs/plans/roadmap.md`
- Optional create: `.trellis/tasks/<future-task>/prd.md` only when a future task is explicitly started

- [x] Map each P0 item to a future independently verifiable Trellis task without starting implementation in this documentation task.
- [x] Keep P1/P2 task names stable so later tasks can refer to them without duplicating requirements.
- [x] Record that old Account removal and future Account integration are separate tasks with separate acceptance criteria.
