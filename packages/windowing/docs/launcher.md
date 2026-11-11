# Start Menu And Launcher

Part of the [@tearleads/windowing](../README.md).

## Start menu

`StartMenu` is a taskbar's start button: place it at the bar's leading edge,
give it an `icon` to show (a logo or an icon element), and the menu opens above
the button's top-left corner. Its `items` each take an `id`, `label`, optional
`icon` and `disabled`, and `onSelect`, which runs after the menu closes and
receives where the menu opened, for placing a new window near it:

```tsx
<StartMenu
  icon={<Logo />}
  items={[
    {
      icon: NotePencilIcon,
      id: "notes",
      label: "Notes",
      onSelect: ({ x }) => create("Notes", x, 80, NotesApp),
    },
  ]}
/>
```

The button is named "Menu" unless `label` says otherwise, and announces its
menu with `aria-haspopup` and `aria-expanded`. By default it is a square,
borderless control the height of the bar's controls, lit while hovered,
focused, or open ([`StartMenu.css`][start-menu-styles]). A `className` replaces
that styling, so a
host's own button styles apply alone. A menu that needs more than a list passes
`renderMenu`, which renders the open menu itself and receives its `position`
and a `close` callback. Tearleads' footer does this in
[`packages/app/src/shell/pane/footer/PaneFooter.tsx`][pane-footer].

## Launching mini-apps

A launcher application is a set of mini-apps, defined once and shown either in
windows on a desktop or one at a time in the routed shell. A
`LauncherDefinition` lists the apps by id, the order the launchers show them in,
the windows the desktop opens on entry, and the app the routed shell shows at
the root route:

```tsx
import type { LauncherDefinition } from "@tearleads/windowing";

const LAUNCHER: LauncherDefinition<"notes" | "contacts"> = {
  apps: {
    contacts: {
      createComponent: () => ContactsApp,
      icon: AddressBookIcon,
      title: "Contacts",
    },
    notes: {
      createComponent: () => NotesApp,
      icon: NoteIcon,
      iconLabel: "Quick notes",
      initialShowSidebar: false,
      title: "Notes",
    },
  },
  defaultWindowAppIds: ["contacts", "notes"],
  homeAppId: "notes",
  order: ["notes", "contacts"],
};
```

Each app's optional `iconLabel` labels its desktop icon and routed launcher
entries (both the tablet rail and mobile sheet). Omit it to use `title`.
Window chrome and the routed content heading always keep `title`; app ids,
routes, and stored desktop positions do not change. Hosts building a start
menu from the definition should use `app.iconLabel ?? app.title` for each
item's `label`, as Tearleads' start and desktop context menus do.

`LauncherNavigationProvider` takes the definition and a `NavigationMode`, and
goes inside a `WindowStateProvider`. In `windowed` mode
`useLauncherNavigationActions().openMiniApp({ appId })` opens the app's window,
or raises the one already open; in `routed` mode it pushes the app's route,
`/app/<app id>/…`, onto browser history, and Back and Forward walk it. Render
each window with `MiniAppWindow`, whose `AppBoundary` slot wraps the app (for
example in an error boundary).

Optional `defaultWindowAppIds` open, in order, on entering an empty windowed
desktop, including mount, so the last opens in front. Minimized windows count
as open. Closing the last window leaves it empty until the next mode entry. The
provider's `defaultWindowEnabled` defers that entry while false (e.g. hidden
workspaces). Hiding and showing an already initialized desktop preserves it,
even if empty. Omit the list to manage startup yourself; `homeAppId` only sets
the routed home.

A new window opens at the request's `position`, or `DEFAULT_MINI_APP_POSITION`,
at the app's `windowSize`. A host that places its apps itself passes the
provider a `placeWindow` callback. It receives each request that opens a new
window and returns a `MiniAppWindowPlacement`: the window's `position`, in
viewport pixels like the request's, its `size`, and `fitToContent` to open it
fitted (see [Geometry and input](./windows.md#geometry-and-input)). A field it
leaves out keeps the default. Default windows, desktop icons, and every other
`openMiniApp` call open through it:

```tsx
<LauncherNavigationProvider
  definition={LAUNCHER}
  mode={mode}
  placeWindow={({ appId }) =>
    appId === "notes"
      ? { fitToContent: true, position: { x: 120, y: 40 } }
      : {}
  }
>
```

A mini-app reads and sets its own route with `useMiniAppRouteSegments(appId)`,
or `useMiniAppRouteState` for a parsed route: the browser route in the routed
shell, its window's own route and Back stack in a window. It registers its
sidebar and toolbar actions with the window hooks, and both shells show them.

`useNavigationMode` picks the mode: the user's choice from
`NavigationModeOverrideProvider` (which persists it under a `storageKey`)
first, while that choice suits the screen; then a host's `forcedMode`; then
`preferredMode`, which defaults to `routed`.
`NavigationModeSwitch`, for a taskbar's corner, records that choice: given the
layout showing it, it offers the other ("Switch to iPad / mobile layout"). Windowed
applies only where windows suit the screen: at least 1024px wide, with a fine
pointer, and not an iPad. Pass the mode to
`useNavigationModeDocumentAttribute`, which stamps
`<html data-navigation-mode>`; the routed touch sizes key off it (see
[Styles](./appearance.md#styles)), and `useRoutedLayoutActive` reads it back.

## Desktop icons

`DesktopIcons` shows launcher apps as icons on the windowed desktop, beneath
its windows. Render it inside `LauncherNavigationProvider`, as the first child
of the positioned surface the windows lay out on, and name the apps it shows:

```tsx
const storage = createOpfsDesktopStateStorage({ fileName: "desktop.json" });

<div className="desktop-surface">
  <DesktopIcons appIds={["notes", "contacts"]} storage={storage} />
  {windows.map((entry) => (
    <MiniAppWindow key={entry.id} windowId={entry.id} />
  ))}
</div>;
```

The icons are options of a listbox named "Desktop" (`label` renames it). A
press selects an icon and a drag moves it; double-click or Enter opens its app
with `openMiniApp`, or with `onOpen` when given; arrow keys, Home, and End move
the selection. Right-click or the context-menu key offers Open, then any items
`menuItems(appId)` returns. Icons without a saved position fill the free cells
of a grid from the top-left corner, down then across.

Positions persist through a `DesktopStateStorage` adapter, which reads and
writes one JSON string, so the host chooses where it lives:
`createOpfsDesktopStateStorage` keeps a file in the origin private file system,
`createMemoryDesktopStateStorage` keeps it in memory (the default), and a host
can wrap its own store, as Tearleads wraps each identity's encrypted blob store
in
[`packages/app/src/shell/pane/shell/usePaneDesktopStateStorage.ts`][desktop-storage].
Keep the
adapter stable: a new adapter reloads the layout from what it holds. Moves made
before the load finishes win and are saved with the stored layout; when the
read fails, moves stay in memory and nothing is written.

## Routed shell

`RoutedPane` is the routed shell, the iPad / phone layout: one mini-app at a
time, chosen by the route, under an app bar with Back, Forward, the app's
sidebar toggle, its title, and its toolbar actions, above a taskbar. Below 760px
(`ROUTED_TABLET_BREAKPOINT_PX`) it is a phone layout whose launcher is a bottom
sheet of app tiles; at or above it, a tablet layout whose launcher is a left
rail or, at the user's choice, the same sheet. Mini-apps put their actions in
the toolbar: the routed shell has no menu bar.

```tsx
<WindowStateProvider>
  <LauncherNavigationProvider definition={LAUNCHER} mode="routed">
    <RoutedPane
      AppBoundary={AppErrorBoundary}
      menuIcon={<Logo />}
      taskbarTray={<ModeSwitch />}
    />
  </LauncherNavigationProvider>
</WindowStateProvider>
```

The host fills its chrome: `menuIcon` is the taskbar's centered launcher
button, `taskbarTray` its end-aligned tray, `contentTop` rides above the active
app, and `renderAboveTaskbar` draws a strip above the taskbar, told whether the
phone's software keyboard is open. `appIds` narrows the apps the launcher
offers, such as to those the session may see, and
`subscribeKeyboardVisibility` reports a native keyboard a WebView hides.
Overlays that should fill the content pane rather than the screen portal into
`useRoutedPaneOverlayHost().host`. The shell sizes to the box its host gives
`.routed-pane`, as a grid item or a block with a height. Tearleads dresses it in
[`packages/app/src/shell/layout/routed/AppRoutedPane.tsx`][app-routed-pane].

[start-menu-styles]: https://github.com/a2f0/tearleads/blob/main/packages/windowing/src/menu/StartMenu.css
[pane-footer]: https://github.com/a2f0/tearleads/blob/main/packages/app/src/shell/pane/footer/PaneFooter.tsx
[desktop-storage]: https://github.com/a2f0/tearleads/blob/main/packages/app/src/shell/pane/shell/usePaneDesktopStateStorage.ts
[app-routed-pane]: https://github.com/a2f0/tearleads/blob/main/packages/app/src/shell/layout/routed/AppRoutedPane.tsx
