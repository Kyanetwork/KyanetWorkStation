# Frontend Type and Boundary Safety

## Current status

The browser code is plain JavaScript. There is no TypeScript compiler, shared
type directory, generated client, or runtime schema library. Type safety is
provided by backend validation plus defensive checks at every fetch and
external-data boundary. Do not add TypeScript-only syntax to a page module.

The backend owns authoritative input validation in server/validation.js. The
frontend mirrors simple browser constraints for usability (required, maxlength,
and input types) but must still handle a 400 response.

## Payload handling

At an API boundary:

1. Parse JSON with a fallback (response.json().catch(() => ({}))) where a
   non-JSON error is possible.
2. Require both response.ok and data.ok.
3. Read data.data || {} and default optional fields before rendering.
4. Render untrusted strings through escapeHtml or textContent.

The admin api helper and the home fetchJson helper are the canonical patterns.
MeowStatus additionally normalizes external snake_case fields in
server/meowstatus.js; the browser consumes its camelCase projection rather than
parsing provider responses.

Convert values explicitly at boundaries: use Number for data-id/summary counts,
compare select values to "1" for booleans, and convert datetime-local values to
ISO with new Date(...).toISOString(). Date formatting is centralized in the
page formatter and falls back to - or the original text when parsing fails.

## Documentation and optional JSDoc

For a complex plain-JavaScript payload, document its fields near the fetch or
render function with a short comment or JSDoc object. Keep the API reference
and backend row maps as the authoritative contract; do not create duplicate
type definitions in each page.

## Forbidden patterns

- Assuming data.items, data.totalPages, or external widget fields exist without
  a fallback.
- Treating a truthy string ("false", "0") as a boolean.
- Passing raw API values into an HTML attribute or template.
- Using eval, dynamic script injection, or TypeScript assertions to silence an
  unknown shape.
- Reading database snake_case fields directly in a browser page.

Reference files: public/index/main.js:37-57,92-99,
public/admin/admin.js:82-113,164-176, server/validation.js, and
server/meowstatus.js:17-63.
