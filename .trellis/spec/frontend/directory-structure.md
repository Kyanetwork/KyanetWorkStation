# Frontend Directory Structure

## Runtime shape

The frontend is served as static files by Express. It uses native HTML, a
shared `workstation.css` base plus small page-specific style blocks, and browser
JavaScript; there is no bundler, source tree, framework, component library, or
TypeScript build.

~~~text
public/
├── index.html             # Workstation entry and public showcase markup
├── index/main.js          # home fetch/render loop (IIFE)
├── feedback/index.html    # feedback form and inline styles
├── feedback/main.js       # feedback form submission
├── worktask/index.html    # WorkTask form and inline styles
├── worktask/main.js       # WorkTask form submission
├── admin/index.html       # admin panel markup and inline styles
├── admin/admin.js         # admin state, API calls, rendering, event delegation
├── workstation.css         # shared cold-color tokens, geometry, focus, and responsive base
├── theme.js               # shared light/dark preference
└── images/                # checked-in favicon assets
~~~

Express mounts this directory with express.static in server/app.js; page
scripts are loaded after their markup. Keep each page's behavior in its
matching directory and use theme.js only for the cross-page theme concern.

## Adding a page or feature

- Add a page folder and index.html when the feature has a distinct URL and
  form/view.
- Put page behavior in that folder's main.js; keep the script small and
  initialize it after the DOM exists.
- Reuse existing page functions, `theme.js`, or `workstation.css` before
  creating a shared helper. There is currently no shared component directory.
- Keep API paths and field names aligned with docs/api/reference.md and the
  backend validators. Do not make the browser depend on database column names.

The home page (public/index/main.js:1-251) is an IIFE with one explicit state
object. The feedback and WorkTask pages use top-level DOM references and form
listeners (public/feedback/main.js and public/worktask/main.js). The admin page
keeps its larger state and render functions inside an IIFE
(public/admin/admin.js).

## Naming and style

Use lower-case directory/file names, main.js for a page module, camelCase
JavaScript functions, and stable semantic IDs for DOM contracts
(feedbackForm, worktaskList, themeToggle). Keep CSS variables and
data-theme="dark" conventions consistent with the existing pages. Do not
introduce a build-only naming convention or generated source directory.

## Boundaries to preserve

- HTML owns structure and labels; page JavaScript owns interaction and fetches.
- The browser owns presentation formatting, not authorization or validation
  decisions.
- escapeHtml must run before untrusted values enter an innerHTML template.
- API responses are consumed through a small page-local fetch helper; no page
  talks to the database or to an external provider directly.

Reference files: server/app.js, public/index.html, public/index/main.js,
public/admin/admin.js, and public/theme.js.
