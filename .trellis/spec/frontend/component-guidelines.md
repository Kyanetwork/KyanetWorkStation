# Frontend Component Guidelines

## What a component means here

This project has no React/Vue component model or component library. A
“component” is a semantic HTML section plus the page-local render or event
functions that operate on its DOM nodes. Do not add a framework component just
to reuse one card or form.

Use stable IDs and data-action attributes as the local contracts. For example,
public/admin/index.html defines feedbackList and worktaskList, while
public/admin/admin.js attaches one click listener to each list and dispatches
by data-action.

## Rendering pattern

Keep render functions pure with respect to their input and write only to the
target node. The existing patterns are:

- renderList in public/index/main.js for public showcase items.
- renderFeedbackList and renderWorktaskList in public/admin/admin.js for
  repeated admin records.
- showMessage/showToast for status feedback.

When a template uses innerHTML, escape every API or user value first with
escapeHtml (or linkifySafeText, which escapes before adding safe links).
Prefer textContent, classList, and createElement for one-off text or state
updates. Keep external links target="_blank" only with
rel="noopener noreferrer".

~~~js
container.innerHTML = items.map(renderItem).join("");
~~~

The renderItem function must escape every dynamic field before it is inserted.

## Inputs and composition

HTML forms define the field names and browser constraints (required, maxlength,
and type="datetime-local"). The submit handler trims values, converts local
date-time to ISO when needed, sends JSON, and restores the button in finally.
Keep the DOM field name, payload key, and backend validator key aligned.

Use small page-local functions rather than a prop system. If two pages really
share behavior, first extract a narrow function with an explicit argument
shape; do not create a speculative component framework.

## Styling and accessibility

Use `public/workstation.css` as the shared base for cold-color tokens, square
geometry, focus rings, status messages, and responsive behavior. Keep only
page-specific layout rules in each page's style block, and load the shared
stylesheet after those blocks so the square-control contract cannot be
reintroduced accidentally. Preserve the existing CSS variables, responsive
breakpoints, light/dark `data-theme` selector, and reduced visual complexity.
Every `<button>` must declare an explicit `type`: `submit` only for the form's
primary submission, `button` for tabs, pagination, reset, cleanup, and other
actions. Dynamic buttons rendered through `innerHTML` must include the same
attribute and a semantic class (`primary`, `secondary`, or `danger`) when the
action needs a hierarchy. Under `.admin-page`, the shared stylesheet enforces
`border-radius: 0`, hover/active/disabled/busy states, and a visible
`focus-visible` outline; do not add page-local rounded overrides.
Every form control should retain its associated label, visible validation/status
text should use `textContent`, and notifications should keep
`aria-live="polite"` as in the admin toast region. Images need meaningful `alt`
text or an intentionally empty alt for decorative icons.

## Common mistakes

- Inserting raw feedback content, contact details, or provider payloads into
  innerHTML.
- Reading a DOM node before the page script is loaded.
- Mutating a list item without reloading the server projection after a write.
- Replacing the established theme variables with a page-specific palette.
- Leaving a button without `type`, which makes it an accidental form submit and
  causes browser default styling to leak into the HUD contract.
- Rendering knowledge citations or history with unescaped API values; use
  `escapeHtml` for templates and `textContent` for answer/status text.
- Adding React props/hooks or a component package to a static page.

Reference files: public/index/main.js:101-185,
public/admin/admin.js:281-364, public/admin/index.html:118-217, and
public/theme.js.

## External icon boundary

The MeowStatus adapter is the authoritative validator for Minecraft favicon
data URLs. The static page must retain a second lightweight check before
building an `<img>` attribute: allow only `data:image/png|jpeg|jpg|gif|webp`
base64 URLs and reject values longer than 256 KiB. Always pass accepted values
through `escapeHtml`; never render an external URL or SVG returned by an
upstream service. Invalid icons render as the existing hidden placeholder and
must not prevent the status card from showing its text state.
