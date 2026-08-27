# Frontend Hook Guidelines

## Current status

There are no React hooks, custom hooks, or hook runner in this repository.
This file records the non-applicable concept so future work does not
accidentally introduce React for a small page behavior.

Stateful browser behavior is expressed with named functions, an explicit page
state object where needed, and DOM event listeners. The home and admin IIFEs
are the reference initialization boundaries; the feedback and WorkTask modules
attach listeners directly after their forms are declared.

## Data fetching

Use the browser's native fetch and check both the HTTP status and the
application envelope. public/index/main.js:92-99 has the page-local fetchJson
helper; public/admin/admin.js:164-176 has the admin api wrapper that defaults
mutations to JSON POST and supports explicit GET.

~~~js
const response = await fetch("/api/feedback", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload)
});
const data = await response.json();
if (!response.ok || !data.ok) {
  throw new Error(data.error && data.error.message || "提交失败");
}
~~~

Catch at the UI boundary, show a user-facing message, and restore busy
controls in finally. Do not hide a failed request by updating only local state.

## Naming and alternatives

Do not name ordinary helpers useSomething; the use* convention has no meaning
in this codebase. Prefer names such as loadFeedback, refreshMeowStatus,
renderWorktaskList, withButtonBusy, and switchModule. If a future feature needs
reusable stateful logic, keep it as an explicit module function with arguments
and a cleanup path, or revisit the architecture as a deliberate decision.

## Common mistakes

- Introducing React Query, SWR, or a hook library for one native fetch.
- Starting an interval without retaining and clearing its timer.
- Allowing overlapping refreshes; refreshMeowStatus uses a
  meowStatusLoading guard and stores its interval in state.
- Assuming a successful HTTP response has a successful ok=true payload.

Reference files: public/index/main.js:1-9,188-215,
public/admin/admin.js:21-34,164-176, and public/feedback/main.js:39-88.
