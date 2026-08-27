# Frontend Development Guidelines

These rules describe the current static HTML/CSS/JavaScript frontend. They
intentionally do not prescribe React, hooks, TypeScript, a component library,
or a build step that the project does not use.

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Static pages, page modules, and shared theme | Current |
| [Component Guidelines](./component-guidelines.md) | Semantic sections, render functions, DOM contracts, and accessibility | Current |
| [Hook Guidelines](./hook-guidelines.md) | Native event/fetch patterns; no React hooks | Current |
| [State Management](./state-management.md) | Page-local state, DOM form state, server refresh, and theme preference | Current |
| [Quality Guidelines](./quality-guidelines.md) | Syntax checks, manual browser smoke, safety, and review | Current |
| [Type Safety](./type-safety.md) | Plain-JavaScript runtime checks and payload boundaries | Current |

## Pre-development checklist

1. Read this index and the guideline matching the page or behavior being
   changed.
2. Confirm the affected HTML IDs, form names, data-action values, and API
   envelope before editing.
3. Keep untrusted values escaped and keep server validation authoritative.
4. Run node --check, focused API tests, and a manual page smoke check when the
   change affects browser behavior.

## Quality check

- Run `node --check` for changed page scripts and `git diff --check`.
- For API-affecting work, run the relevant Node tests and record any runtime
  dependency blocker from the full `npm test` baseline.
- For browser behavior, manually verify success/error states, keyboard use,
  light/dark themes, and a narrow viewport.
