# Tray Apps

Tray apps are the small controls in the lower-right system tray: the windowed
footer's tray and the routed taskbar's corner show the same ones. Like
[mini-apps](../mini-apps/README.md), each is its own app in its own folder,
and the user can switch each one off:

- right-click it (or press the context-menu key, or hold a finger on it) and
  choose **Disable**, or
- use its switch in Display Properties' **System Tray** section, which also
  turns it back on. The tray's context menu opens Display Properties, and the
  routed launcher lists it, so the switches stay reachable in either layout.

The platform is `@tearleads/windowing`'s system tray (see its
[System tray guide](../../../windowing/docs/appearance.md#system-tray)):
`SystemTrayProvider` keeps which apps are off, `SystemTray` renders the rest
with their context menus, and `DisplayProperties` lists every app with a
switch. This folder supplies the apps:

- [`registry.ts`](registry.ts) — `TRAY_APPS`, each app's component, title, and
  icon, and the tray's order. The shell mounts it once in `Layout`, above every
  pane, so every tray and Display Properties share one choice.
- [`AppSystemTray.tsx`](AppSystemTray.tsx) — the tray the windowed footer and
  routed taskbar render, with a Display Properties item in each app's menu.
- One folder per tray app: [`screensaver/`](screensaver/),
  [`theme/`](theme/), [`navigation-mode/`](navigation-mode/), and
  [`sync-status/`](sync-status/).

## Layout standard

Each tray app's folder holds `<Name>TrayApp.tsx`, the component the registry
names, plus whatever else it needs, with tests beside the code. A building
block several tray apps share goes in `shared/`.

## Import rules

`bun run lint:architecture` enforces these:

- A tray app imports nothing from another tray app's folder; shared code
  goes in `tray-apps/shared/` (`app-tray-apps-do-not-cross-import`).
- Tray apps and mini-apps never import each other, in either direction, not
  even `mini-apps/types.ts` (`app-tray-apps-do-not-import-mini-apps`,
  `app-mini-apps-do-not-import-tray-apps`). Code both need lives in a lower
  layer they share: [`components/`](../components/) for UI (the Sync Status
  glyph is `components/shared/SyncGlyph`), [`stores/`](../stores/) for state
  machines (the write-queue watcher is `stores/write-queue/`),
  [`providers/`](../providers/), [`navigation/`](../navigation/), or
  [`utils/`](../utils/).
- A tray app opens a mini-app by id through
  [`navigation/AppNavigationProvider`](../navigation/AppNavigationProvider.tsx),
  as Sync Status opens the Explorer's Write Queue.
- Tray apps sit below the shell and do not import it
  (`app-tray-apps-stay-below-the-shell`); only the shell loads them
  (`app-only-the-shell-loads-tray-apps`), and only through `registry.ts` and
  `AppSystemTray.tsx`, the **Tray Apps** subsystem's surface
  ([docs/subsystems.md](../../../../docs/subsystems.md)).

## Adding a tray app

1. Create `tray-apps/<name>/<Name>TrayApp.tsx`. Style a button with
   `tearleads-action-button` so it matches the tray; render nothing where the
   app does not apply.
2. Add it to `TRAY_APPS` in [`registry.ts`](registry.ts) with a title and
   icon, and place it in the order.
