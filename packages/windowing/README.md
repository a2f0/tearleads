# @tearleads/windowing

App-agnostic window management for React: window state (open, focus order,
minimize/maximize, a per-window route and Back stack), window chrome (title
bar, menu bar, toolbar, sidebar, status bar, resize handles), and the menu and
sidebar primitives that chrome renders with.

The package knows nothing about the applications that run inside its windows.
It depends only on React, react-dom, Phosphor icons, and `@tearleads/ui`.

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

The stylesheets read design tokens they do not define:

- the shared tokens in `@tearleads/ui`'s `styles.css` (colors, spacing, and the
  `--window-bar-*` and `--tearleads-window-titlebar-*` chrome tokens);
- `--app-radius-control`, `--app-radius-surface`, `--app-hover-surface`,
  `--app-shadow-surface`, and `--app-shadow-window`, which the host defines.
  Tearleads sets them in `packages/app/src/shell/layout/AppChrome.css`.

## Status

The package is private to this workspace and exports TypeScript source. It is a
step toward publishing the windowing layer for use outside Tearleads.
