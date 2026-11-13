# Mini-Apps

The mini-app layer owns app-local window composition and route-style messages
between mini-app windows.

[`bus.tsx`](bus.tsx) is intentionally SDK-independent infrastructure. It opens
or raises a
mini-app through the app's navigation actions
([`../navigation/AppNavigationProvider.tsx`][file-1], over the windowing
launcher) and
queues each message until a subscriber of the target app claims it; a message
sent while opening a window waits for that window. It must not import the SDK
or other `@tearleads/*` packages beyond `@tearleads/windowing`, app runtime
providers, app stores, document type registries, or concrete mini-app
implementations.

The window core (`@tearleads/windowing`) is app-agnostic: it stores a window's
`appId` as an opaque string and never imports mini-app code. Its launcher runs
the mini-apps from a definition: [`registry.ts`](registry.ts) gives it
`MINI_APP_LAUNCHER`,
every mini-app's definition (title, icon, component, sidebar default) with the
menu order and Explorer as both the routed shell's home and the empty
desktop's default window. The package opens them in windows (`MiniAppWindow`,
whose `AppBoundary` slot takes `LauncherMiniAppBoundary` from
[`../components/mini-app/MiniAppBoundary.tsx`][file-2]) or shows one at a time
in its
routed shell. Both the regular app and the demo run this one launcher; their
host profiles differ in the layout they prefer. `isMiniAppId` narrows a
window's `appId` back to a `MiniAppId`.

[`catalog.ts`](catalog.ts) holds each app's title, icon, and menu order without
importing
any app, so chrome that only labels or lists apps stays light;
[`registry.ts`](registry.ts)
pairs those titles with the components and is imported only by the shells that
render apps. Each app that accepts bus messages declares them in its own
`messages.ts`, an import-free type contract; [`types.ts`](types.ts) unions them
for the bus.

Mini-app implementations can use providers and stores at their own boundary.
Keep SDK-backed data dependencies behind
[`packages/app/src/providers`](../providers/) and
[`packages/app/src/stores`](../stores/); keep the bus a pure React/window
messaging adapter.

Org Manager group deletion opens a confirmation naming the selected group from
both the row menu and the group detail context menu. Cancel leaves the group
unchanged; only confirmation starts deletion. Built-in groups remain protected.

## Window content fitting

Every mini-app window offers **View → Fit to Content**. The shared windowing
package adds the rendered sidebar, chrome, and scrollbars and keeps the result
inside the desktop. Fitting is manual: opening an app, typing, receiving data,
or changing routes does not resize the window.

The app boundary registers bounded working sizes from
[`miniAppContentSizes.ts`](../components/mini-app/miniAppContentSizes.ts):
compact form views, larger document/list views, and wider diagnostics. These
are useful viewports, not an attempt to show every record or editor line.
[`DisplayPropertiesApp`](display-properties/DisplayPropertiesApp.tsx) instead
measures its fixed-width gallery and updates the fit target when its controls
change size. It opts out of the boundary's target so each window has one owner
of its content size. The routed layout stays responsive and has no fit action.

## Layout standard

Every mini-app directory keeps the same shape: a small root that holds only the
app's entry points and app-wide wiring, with everything else in feature
folders.

The root holds, where the app has them:

- `<Name>App.tsx` — the mini-app definition handed to the registry.
- `<Name>.tsx` / `<Name>.css` — the top-level component and stylesheet.
- `<Name>RoutedChrome.tsx` — the routed-shell integration.
- `<Name>Sidebar.tsx` — the sidebar frame.
- `routes.ts` — route codecs; `sections.ts` — the section/nav catalog.
- `labels.ts` and its catalogs — user-facing strings.
- `messages.ts` — the bus messages the app accepts from other mini-apps.
- `types.ts` — cross-feature types.
- Modules the host shell imports from outside the mini-app (for example
  system-monitor's provider, launcher button, and mode helpers) — these are the
  app's public surface and stay at the root.
- App-level integration tests that exercise the shell above.

Everything else lives in a feature folder. Recurring folder roles:

- `sidebar/` — tree/row models and views behind the sidebar frame.
- `toolbar/` — toolbar actions and visibility rules.
- `detail/` — detail panels, split further by subject when large.
- `context-menu/`, `modal/` — the corresponding UI surfaces.
- `hooks/` — view-model hooks plus their pure helpers and types.
- `model/` — framework-free domain rules (no React imports).
- `shared/` — presentation atoms used across several features of one app.
- Domain folders (`billing/`, `sessions/`, `report/`, …) for cohesive
  subject areas.

Tests sit beside the code they exercise, in the same folder.

[`.ls-lint.yml`](../../../../.ls-lint.yml) pins this shape for the larger
mini-apps with a directory
allowlist plus per-directory file-count budgets. Adding a folder or growing a
budget is fine — do it deliberately in
[`.ls-lint.yml`](../../../../.ls-lint.yml) rather than letting a
root accumulate loose files.

[file-1]: ../navigation/AppNavigationProvider.tsx
[file-2]: ../components/mini-app/MiniAppBoundary.tsx
