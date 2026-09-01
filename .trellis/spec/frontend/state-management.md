# Frontend State Management

## Current model

There is no global state library, store, router, or server-state cache. State
is kept at the smallest useful scope:

- The home IIFE keeps locale, time zone, formatter, refresh interval, timer,
  and an in-flight flag in its state object (public/index/main.js:2-9).
- The admin IIFE keeps the active tab, each list's page/items/load status,
  status settings, and display formatter in its state object
  (public/admin/admin.js:21-34).
- Feedback and WorkTask form values remain in the DOM and are read on submit.
- The theme preference is the one cross-page setting and is stored under
  kyanet_theme by public/theme.js.

Do not add a store for values that are already represented by a form control,
URL, or a short page-local state object.

## Server state and refresh

Treat API responses as server state. Fetch them through the page helper,
normalize missing fields with safe defaults, render the response, and refresh
the relevant projection after a mutation. The admin list loaders reset the
page when a new search starts and recursively correct a page that is now past
totalPages (public/admin/admin.js:409-462).

The home MeowStatus loop retains its interval id and refuses overlapping
requests. Preserve this lifecycle when adding another periodic display:

1. load once with the initial page data;
2. store the timer id;
3. skip while a request is in flight;
4. clear the previous timer before starting a replacement.

## Local and transient state

Use DOM properties for transient form/input state and classList for visibility
or busy status. Use data-id, data-action, and data-status for event-delegation
metadata, then convert values at the boundary (Number for ids and explicit
booleans for switches). Keep server data out of localStorage; only user
presentation preference currently belongs there.

## Common mistakes

- Maintaining a second JavaScript copy of a text input that can become stale.
- Treating a cached list as authoritative after a status/delete operation.
- Starting duplicate intervals on every render.
- Persisting feedback, WorkTask, Account, or admin data in browser storage.
- Promoting a page-local flag to a global library without a second consumer.

Reference files: public/index/main.js, public/admin/admin.js, public/theme.js,
and the mutation listeners in public/admin/admin.js:706-807.

MeowStatus payloads are external server state. Treat a missing/non-boolean
`online` value as `未知`, keep the `disabled/unavailable/ok` envelope, and do
not let an invalid icon or widget field abort the refresh/render cycle.

The AI diagnostics map and metrics summary are also server state kept in the
admin page's local `state.ai` object. A diagnostic entry is keyed by profile ID
and may temporarily be `{ loading: true }`; after completion replace it with the
normalized result and leave `activeProfile` untouched. Metrics are refreshed on
explicit page load or button action for a bounded time window; do not persist
them in localStorage or start a duplicate timer. Clearing the session clears
both projections.
