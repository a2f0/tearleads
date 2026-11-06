# @tearleads/windowing

App-agnostic window management for React: window state (open, focus order,
minimize/maximize, a per-window route and Back stack), window chrome (title
bar, menu bar, toolbar, sidebar, status bar, resize handles), the menu and
sidebar primitives that chrome renders with, a taskbar's start menu and theme
switch, and a launcher that runs a set of mini-apps in windows or in the routed
(iPad / phone) shell.

The package knows nothing about the applications that run inside its windows.
It depends only on React, react-dom, and Phosphor icons, which draw the
chrome's own icons unless a host passes its own (see [Icons](./docs/windows.md#icons)).

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

## Guides

- [Windows and chrome](./docs/windows.md)
  - [Geometry and input](./docs/windows.md#geometry-and-input)
  - [Slots](./docs/windows.md#slots)
  - [Toolbar](./docs/windows.md#toolbar)
  - [Icons](./docs/windows.md#icons)
- [Start menu and launcher](./docs/launcher.md)
  - [Start menu](./docs/launcher.md#start-menu)
  - [Launching mini-apps](./docs/launcher.md#launching-mini-apps)
  - [Desktop icons](./docs/launcher.md#desktop-icons)
  - [Routed shell](./docs/launcher.md#routed-shell)
- [Themes, wallpapers, and styles](./docs/appearance.md)
  - [Themes](./docs/appearance.md#themes)
  - [Wallpapers and Display Properties](./docs/appearance.md#wallpapers-and-display-properties)
  - [Styles](./docs/appearance.md#styles)
- [Publishing](./docs/publishing.md)

## Dependency compatibility

React and react-dom are host peers with the range `^19.2.0`. Workspace tests
use React 19.3; the tarball smoke test installs the minimum React 19.2, renders
a window, typechecks a consumer, and bundles its JavaScript and CSS.
