# Frontend Quality Guidelines

## Available checks

The repository has no frontend build, linter, TypeScript check, or automated
browser test suite. For JavaScript-only changes, run node --check on every
changed .js file, run the relevant backend tests when an API contract is
involved, and run git diff --check. The full project baseline remains npm test;
report the documented better-sqlite3 ABI blocker instead of claiming success
when the active Node runtime cannot load SQLite.

When browser behavior changes, perform a manual smoke check in the affected
page: load the page, exercise success and error responses, verify loading
states and keyboard submission, and check both light and dark themes. Record
that browser evidence in the task or release notes; do not imply that a
browser check ran if it did not.

## Required patterns

- Use semantic HTML labels, buttons, forms, and visible status messages.
- Keep page scripts loaded after markup and initialize once.
- Check response.ok and data.ok for every fetch.
- Escape untrusted values before innerHTML; prefer textContent where templating
  is unnecessary.
- Disable/busy a mutation button during the request and restore it in finally
  (withButtonBusy is the admin helper).
- Refresh the server projection after a successful admin mutation.
- Preserve data-theme, responsive CSS variables, and the shared theme.js
  preference.

## Forbidden patterns

- Raw innerHTML interpolation of API/user/provider strings.
- Duplicate unsanitized linkification or ad-hoc date parsing in a new page.
- Storing submission data, session material, or secrets in localStorage.
- Removing labels, aria-live, focusable controls, or keyboard paths for a
  visual-only change.
- Adding a frontend framework or bundler without an explicit architecture
  decision.

## Test and review checklist

- [ ] The page loads directly from its static URL with the expected script path.
- [ ] Successful JSON and non-JSON/HTTP error responses show an understandable
      message and restore controls.
- [ ] All dynamic strings use escapeHtml/textContent; external links keep
      noopener noreferrer.
- [ ] Date, boolean, empty-list, and missing-field fallbacks were considered.
- [ ] node --check and git diff --check were run; API changes have focused Node
      tests or an explicit manual smoke result.
- [ ] Light/dark theme and narrow viewport behavior remain usable.

Reference files: public/admin/admin.js, public/index/main.js,
public/feedback/main.js, public/worktask/main.js, public/theme.js, and
tests/*.test.js.
