# @tearleads/windowing

App-agnostic window management for React: window state (open, focus order,
minimize/maximize, a per-window route and Back stack), window chrome (title
bar, menu bar, toolbar, sidebar, status bar, resize handles), and the menu and
sidebar primitives that chrome renders with.

The package knows nothing about the applications that run inside its windows.
It depends only on React, react-dom, and Phosphor icons.

## Composing a desktop

```tsx
import {
  useWindowActions,
  useWindowStateData,
  Window,
  WindowStateProvider,
} from "@tearleads/windowing";

function Desktop() {
  const { windows } = useWindowStateData();
  return (
    <div style={{ position: "relative", height: "100%" }}>
      {windows.map((entry) => (
        <Window key={entry.id} windowId={entry.id} />
      ))}
    </div>
  );
}

function OpenNotes() {
  const { create } = useWindowActions();
  return (
    <button
      type="button"
      onClick={() => create("Notes", 200, 160, NotesApp, { appId: "notes" })}
    >
      Notes
    </button>
  );
}

<WindowStateProvider>
  <OpenNotes />
  <Desktop />
</WindowStateProvider>;
```

Windows are absolutely positioned and clamp to their parent element, so the
desktop surface must be a positioned container.

## Geometry and input

Windows move by their title bar and resize by their corners with pointer
events, so mouse, touch, and pen all work. While a gesture runs the geometry
stays local to that window; when it ends, the window commits its `position` and
`size` (surface-relative) to its `WindowEntry`. The first layout commits too,
so `position` always reflects where the window sits. Without `size` a window
takes its stylesheet's default size.

To save a layout, read `position` and `size` from `useWindowStateData()`. To
restore one, pass them back as `create` options, which take precedence over
`create`'s viewport `x`/`y`. `setGeometry(id, { position, size })` moves or
resizes a window programmatically.

## Slots

- **`ContentBoundary`** — `Window` renders a window's component inside this
  optional wrapper, which receives the `WindowEntry`. Hosts use it to give
  content app-specific context (a route provider, an error boundary) without the
  window layer knowing about apps. Tearleads fills it in
  `packages/app/src/mini-apps/MiniAppWindow.tsx`.
- **`appId`** — an opaque string a host attaches when creating a window. The
  window layer only stores and compares it; the host interprets it.

Windows register their own menu items, title-bar actions, a Back action, and a
sidebar through the `useWindow*` hooks, from inside the window's content.

## Styles

Each component imports its own stylesheet, so a bundler that handles CSS imports
picks them up. Stylesheets are also exported by path (for example
`@tearleads/windowing/window/WindowTitleBar.css`) for surfaces that reuse the
chrome's look without rendering a window.

The stylesheets read design tokens (colors, spacing, radii, shadows, and the
`--window-bar-*` and `--tearleads-window-titlebar-*` chrome tokens). The package
entry imports `tokens.css`, which defines every one of them under
`:where(:root)`, so a page that defines none still renders a complete light
window. That rule has zero specificity: any `:root` rule, theme, or scoped block
the host writes overrides it. Tearleads overrides them with its own themes in
`packages/ui/src/styles.css` and `packages/app/src/shell/layout/AppChrome.css`.

Windows and menus lay out `border-box`, the box model their sizes assume. Since
`box-sizing` does not inherit, a zero-specificity rule sets it on the window or
menu and everything inside, including window content; any host rule overrides
it.

## Publishing

Inside this workspace the package exports its TypeScript source. The npm
package is built separately, into `dist/`, with its own generated manifest:

```sh
bun run --cwd packages/windowing package        # build dist/
bun run --cwd packages/windowing package:smoke  # pack, install, render, typecheck, and bundle outside the workspace
```

The built package is ES modules with declarations and source maps, plus every
stylesheet. React and react-dom are peer dependencies from 19.2, the first
release with `useEffectEvent`; Phosphor icons is its one dependency. The
stylesheets and the entry module (which imports `tokens.css`) are declared side
effects, so bundlers that trust `sideEffects` keep the token defaults.
`src/publishedPackage.test.ts` checks the built manifest and that no module
reaches outside the package, so a new workspace import fails the package's tests
rather than the publish. The declarations drop the stylesheet imports tsc keeps
in them, which a consumer's typecheck could not resolve. The smoke script
installs the lowest React the peer range admits, typechecks against the
declarations with TypeScript's defaults, and bundles a named import with webpack.

Publishing is manual, from the built directory, by an account that owns the
`@tearleads` npm scope:

```sh
npm login
bun run --cwd packages/windowing package
cd packages/windowing/dist && npm publish --access public
```

Bump `version` in `package.json` first; the generated manifest copies it. The
manifest declares `"license": "UNLICENSED"` until a license is chosen.
