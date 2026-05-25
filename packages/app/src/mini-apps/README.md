# Mini-Apps

The mini-app layer owns app-local window composition and route-style messages
between mini-app windows.

`bus.tsx` is intentionally SDK-independent infrastructure. It coordinates
window open, restore, focus, and message delivery through `WindowStateProvider`,
and it receives concrete mini-app definitions from its caller. It should not
import `@tearleads/*` packages, app runtime providers, app stores, document type
registries, or concrete mini-app implementations.

Mini-app implementations can use providers and stores at their own boundary.
Keep SDK-backed data dependencies behind `packages/app/src/providers` and
`packages/app/src/stores`; keep the bus a pure React/window messaging adapter.
